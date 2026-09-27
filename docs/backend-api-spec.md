# HomeSync Backend API Specification

> Source of truth for building the Laravel REST API HomeSync's frontend already
> expects. Derived directly from the current frontend implementation
> (`src/lib/store.tsx`, `src/lib/api/client.ts`, `src/lib/api/types.ts`,
> `src/lib/seed.ts`) — not aspirational, this is what the client actually sends
> today, plus the gaps flagged in **Section 6** that a real backend needs to close.

## 1. Context

HomeSync is an **offline-first PWA**. All state lives in `localStorage`
(`homesync.state.v1`) and every mutation applies to local state immediately —
the UI never blocks on the network. In parallel, each mutation is pushed onto a
durable request queue (`homesync.request-queue`) that is flushed against the
backend whenever the device is online.

**There is currently no backend.** `API_BASE` defaults to
`https://api.homesync.local/api` (overridable via `VITE_API_URL`), and every
request against it is expected to fail in dev, which is fine — the queue just
keeps the request and retries later. This doc specifies what that backend needs
to implement for real.

**No authentication exists today.** The store is single-device, single-user.
See §6.1 before building anything multi-device.

## 2. Sync Model (read this before building anything)

`src/lib/api/client.ts` implements the queue. Understand this before designing
endpoint behavior — it dictates several hard requirements on the backend:

| Behavior | Detail |
|---|---|
| **IDs are client-generated** | Every entity gets `crypto.randomUUID()` **on the client**, before any network call. The backend must accept and persist client-supplied UUIDs as primary keys — it must never generate its own IDs for these entities, or foreign keys (e.g. `MaintenanceLog.task_id`) break. |
| **Fire-and-forget** | The client does not parse response bodies for any mutation endpoint (only status code is checked). Response body content is not currently load-bearing, but should still be sensible JSON per REST convention for future use. |
| **Retry on 5xx / network failure** | `flushQueue()` breaks out of the loop (keeps the request queued) on a `5xx` response or a thrown/network error. It retries on the next flush (triggered by `enqueue()`, the browser `online` event, or app hydration). |
| **Dead-letter on 4xx** | A `4xx` response now removes the request from the retry queue and appends it to a separate dead-letter list (`homesync.request-queue.failed`) instead of retrying forever or discarding silently. **Backend implication: a `4xx` response is final — the client will never retry it.** Return `5xx` only for conditions you want retried; return `4xx` only for conditions that will never succeed on retry (validation errors, not-found, etc). |
| **10s timeout per request** | Requests abort after 10s (`AbortSignal.timeout`) and are treated as a network failure (retried). |
| **Sequential, FIFO** | The queue is drained one request at a time, in order. A stuck/erroring request blocks everything queued behind it (until it either succeeds, gets dead-lettered, or the app is closed). |
| **No idempotency key today** | A request that succeeds on the backend but whose response is lost (e.g. timeout) will be retried by the client. **Backend should treat POST creates as idempotent upserts keyed by the client-supplied `id`**, not as "always insert a new row." |

## 3. Data Model

Types are defined in `src/lib/api/types.ts`. Suggested Laravel migration shapes
follow each entity.

### MaintenanceTask
```ts
interface MaintenanceTask {
  id: string;            // client UUID, PK
  name: string;
  icon: string;           // lucide-react icon key, e.g. "Coffee" — free text, not an enum on the client
  color: AccentColor;     // "green"|"amber"|"red"|"blue"|"violet"|"teal"
  frequency_days: number;
  last_done_at: string;   // ISO 8601
  note?: string;
}
```
`id`, `name`, `icon`, `color`, `frequency_days` — required, not nullable. `note` nullable.
Suggested table: `maintenance_tasks(id uuid pk, name string, icon string, color string, frequency_days integer, last_done_at timestamp, note text nullable, timestamps)`.

*Not synced by the backend at all today*: task **status** (`good`/`warning`/`overdue`) is computed client-side on the fly from `last_done_at` + `frequency_days` (`src/lib/store.tsx:38-43`, ratio-based). Do not add a `status` column unless you also move that computation server-side.

### MaintenanceLog
```ts
interface MaintenanceLog {
  id: string;
  task_id: string;   // FK -> maintenance_tasks.id
  logged_at: string; // ISO 8601
  note?: string;
}
```
**Known client bug to flag, not silently "fix" server-side**: `logTask()` generates a log `id` client-side (`crypto.randomUUID()`) but the `POST /maintenance-logs` body only sends `{ task_id, logged_at }` — the generated `id` is never transmitted (`src/lib/store.tsx:96-98`). The backend will need to generate its own `id` for this table, or the frontend needs a small fix to include it. Flag this to the frontend owner rather than working around it silently.
Suggested table: `maintenance_logs(id uuid pk, task_id uuid fk, logged_at timestamp, note text nullable, timestamps)`.

### Recipe
```ts
interface RecipeIngredient { name: string; amount: string; }
interface Recipe {
  id: string;
  title: string;
  tags: string[];
  prep_minutes: number;
  servings: number;
  emoji: string;
  ingredients: RecipeIngredient[];
  steps: string[];
}
```
`ingredients`, `steps`, `tags` are arrays of primitives/simple objects — store as JSON columns unless you want a normalized `recipe_ingredients` table (reasonable if search/filter-by-ingredient becomes a requirement later; not needed for current scope).
Suggested table: `recipes(id uuid pk, title string, tags json, prep_minutes integer, servings integer, emoji string, ingredients json, steps json, timestamps)`.

### ShoppingItem
```ts
interface ShoppingItem {
  id: string;
  name: string;
  amount?: string;
  recipe_title?: string;        // denormalized recipe title, not a recipe_id FK — client stores the string directly
  done: boolean;
  recent_purchase_days?: number; // computed client-side at add-time, a snapshot not a live value
  warning_dismissed: boolean;
  created_at: string;
}
```
Note `recipe_title` is a denormalized string snapshot, **not** a foreign key — if the source recipe is later renamed or deleted, this field does not update. Preserve that behavior; don't "fix" it into a real FK relationship without a product conversation.
Suggested table: `shopping_items(id uuid pk, name string, amount string nullable, recipe_title string nullable, done boolean default false, recent_purchase_days integer nullable, warning_dismissed boolean default false, created_at timestamp)`.

### Purchase
```ts
interface PurchaseLine { name: string; price: number; }
interface Purchase {
  id: string;
  store: string;
  category: string;   // free text, not an enum client-side (UI defaults to "Spożywcze")
  total: number;
  purchased_at: string;
  lines: PurchaseLine[];
}
```
`lines` — per-item price is a **naive even split** of `total` across bought items (`total / bought.length`, rounded to 2dp — see `completePurchase` in `store.tsx:143-165`), not real per-item receipt data. This is expected given there's no real OCR yet (see §6.3).
Suggested table: `purchases(id uuid pk, store string, category string, total decimal(10,2), purchased_at timestamp, timestamps)` + `purchase_lines(id uuid pk, purchase_id uuid fk, name string, price decimal(10,2))`.

### dismissed_suggestions
`string[]` of product names the user dismissed from the shopping suggestion banner. **This is never synced to the backend at all today** — it's pure client-local state (see §6.4).

## 4. Endpoints (what the client actually calls today)

All paths are relative to `API_BASE`. All request/response bodies are JSON.
Every mutating call already includes a client-generated `id` in its body where
the entity has one — see §2 on idempotent-upsert behavior.

| Method | Path | Called from | Request body | Expected response |
|---|---|---|---|---|
| `POST` | `/maintenance-tasks` | `addTask()` | Full `MaintenanceTask` (incl. `id`, `last_done_at`) | `2xx` on upsert |
| `DELETE` | `/maintenance-tasks/{id}` | `removeTask()` | — | `2xx`, idempotent (deleting an already-gone id should not be a `4xx`) |
| `POST` | `/maintenance-logs` | `logTask()` | `{ task_id: string, logged_at: string }` — **no `id`**, see §3 note | `2xx` |
| `POST` | `/shopping-items/batch` | `addShoppingItems()` | `{ items: ShoppingItem[] }` — full objects, batch of 1+ | `2xx` on upsert of all items |
| `PATCH` | `/shopping-items/{id}/toggle` | `toggleShoppingItem()` | *(none)* | `2xx` — toggles `done` server-side; **note the client already flipped its own local `done` state before this call, so this is a fire-and-forget sync, not a read-modify-write the client waits on** |
| `DELETE` | `/shopping-items/{id}` | `removeShoppingItem()` | — | `2xx`, idempotent |
| `PATCH` | `/shopping-items/{id}` | `dismissWarning()` | `{ warning_dismissed: true }` | `2xx` — this is a generic partial-update endpoint, currently only ever called with this one field, but should accept any subset of `ShoppingItem` fields |
| `POST` | `/receipts/process` | `completePurchase()` | Full `Purchase` object (incl. `id`, computed `lines`) | `2xx` on upsert. Name implies OCR — see §6.3, currently this just persists the already-computed purchase, no image is ever sent |
| `POST` | `/recipes` | `addRecipe()` | Full `Recipe` object (incl. `id`) | `2xx` on upsert |

**`apiGet<T>(path, fallback)` exists in `client.ts` but is never called anywhere
in the app.** No `GET` endpoint is currently exercised by the frontend at all —
see §6.2, this is the biggest gap for a real backend.

## 5. Error Handling Contract (backend must honor this)

Per §2:
- **Return `5xx`** for anything transient/retryable (DB connection hiccup, temporary unavailability). The client queue keeps retrying.
- **Return `4xx`** for anything that will never succeed on retry (validation failure, referenced task/recipe not found, malformed body). The client dead-letters it — **no further attempts, no user notification exists yet either** (dead-letter is currently just a `localStorage` list with no UI, see §6.5).
- **Make `DELETE` idempotent** — deleting a resource that's already gone should return `2xx`/`204`, not `404`, or a delete retried after a dropped response will dead-letter permanently even though the delete already succeeded.
- **Make `POST` creates idempotent** on the client-supplied `id` — upsert, don't insert-or-fail-on-duplicate-key.

## 6. Gaps a Real Backend Build Needs to Resolve

These aren't implementation details the client already answers — they're open
decisions the plan explicitly deferred. Flag to product/whoever owns the
backend scope before treating this spec as complete.

### 6.1 No authentication / no multi-device story
The store is single-device `localStorage`. There is no user/session concept
anywhere in the client. Before this can be a real multi-device backend, decide:
device pairing? Simple auth (email/password, magic link)? A shared household
token? This has zero precedent in the current codebase to reverse-engineer from.

### 6.2 No bootstrap/hydration endpoint
The app never fetches initial state from the backend — it seeds from
`createSeedState()` (`src/lib/seed.ts`) or restores from `localStorage`. A real
backend needs a way for a fresh device to pull the current state, e.g.:
```
GET /sync   → { tasks, logs, recipes, shopping, purchases, dismissed_suggestions }
```
matching the `HomeSyncState` shape in `types.ts`, or individual `GET
/maintenance-tasks`, `GET /recipes`, etc. **This is not implemented on the
client at all today** — building the endpoint alone doesn't make it work; the
frontend also needs a hydration call added, which is out of this doc's scope
(it's a frontend change, flag it back).

### 6.3 Receipt OCR doesn't exist
`POST /receipts/process`'s name implies OCR processing, but the client-side
mock (`ReceiptCheckoutModal.tsx`) never uploads the selected image anywhere —
it only drives a UI "processing…" delay, then sends the already-user-edited
`Purchase` object. If real OCR is in scope, that's a materially different
endpoint (multipart image upload, async processing, a way to push corrected
line-items back down) — not a small addition to the current contract.

### 6.4 `dismissed_suggestions` never syncs
Dismissing a re-purchase suggestion (`dismissSuggestion(name)`) only updates
local state — no `enqueue()` call exists for it anywhere in `store.tsx`. On a
fresh device / cleared `localStorage`, all dismissals are lost. If that matters
for the product, this needs both a new endpoint and a frontend change to call it.

### 6.5 Dead-letter queue has no UI
`readFailedQueue()` (`client.ts`) now exists and 4xx failures land there, but
nothing surfaces it to the user — a permanently-rejected mutation is currently
invisible. Worth deciding whether backend error responses need to carry
user-facing messages once a UI is built for this.

## 7. Non-Functional Requirements

- **CORS**: the frontend runs on a different origin than `API_BASE` — enable CORS for the frontend's deployed origin(s).
- **No secrets in the client**: `VITE_API_URL` is the only backend-related env var the frontend reads; it's a public base URL, not a credential. Any auth token scheme (§6.1) needs its own storage/transmission design — don't assume it slots into the current `enqueue()` call shape without changes.
- **Timeouts**: client aborts at 10s per request (§2) — backend responses slower than that are functionally failures from the client's perspective and get retried, potentially compounding load. Keep endpoint P99 well under 10s.
