# Receipt Parse and Categorize Implementation Plan

## Overview

Wires two AI-backed backend endpoints into the shopping list: real receipt
parsing (replacing today's mock OCR flow) and an AI aisle-order sort
button. Both endpoints are already live backend-side.

## Current State Analysis

- `src/components/ReceiptCheckoutModal.tsx` is entirely mocked: file
  selection (or "Pomiń zdjęcie") triggers a fake 1200ms `setTimeout`
  ("processing"), then shows a 3-field form (store/total/category) with
  no real upload and no per-line detail.
- `src/lib/store.tsx`'s `completePurchase({store, total, category})`
  computes each `PurchaseLine.price` via a naive even split of `total`
  across checked items (`store.tsx:257-260`) — there is no path for
  real per-item prices today.
- `src/lib/api/client.ts` has no multipart/FormData request anywhere —
  every existing call (`apiAuth`, `apiProfile`, etc.) sends JSON.
  `authHeaders()` (`client.ts`, used throughout) only adds the bearer
  token, never sets `Content-Type` itself — the JSON calls set it
  explicitly per-call, which is exactly what a multipart call must NOT
  do (the browser needs to set its own `multipart/form-data; boundary=…`).
- `src/lib/api/types.ts`'s `PurchaseLine` has no `shopping_item_id` field.
- No UI anywhere calls or references `/shopping-items/categorize` — this
  is entirely new surface. `src/routes/shopping.tsx`'s `<PageHeader>` for
  `/shopping` has no `action` prop today (unlike Dom's edit/+ buttons or
  Cookbook's tin/+ buttons, which use that prop).

## Desired End State

- Adding a photo (camera or library) to checkout uploads it, shows a
  real AI-parsed draft (store/category/total/date + editable per-line
  name/price, removable), and saves exactly what the user confirms.
- A parse failure (422) or "Pomiń zdjęcie" falls back to today's
  existing manual store/total/category form, unchanged.
- A "Kategoryzuj" button next to the Zakupy header (disabled when there
  are 0 pending items) reorders the list into aisle order via one tap,
  with a toast on success or failure; the button shows a loading state
  while the request is in flight.

### Key Discoveries:

- `store.tsx:257-260`'s naive-split logic must stay as the fallback for
  the manual-entry path (422/skip) — only the AI-success path gets real
  per-line prices.
- `client.ts:60-63`'s `authHeaders()` is reused unchanged for the new
  multipart call; only the per-call header object changes (no explicit
  `Content-Type`).
- `apiRegenerateShareCode` (`client.ts:220-231`) is the closest existing
  pattern for the categorize call: a synchronous (non-queued) POST whose
  caller needs the parsed response body immediately, not fire-and-forget.

## What We're NOT Doing

- Any client-side behavior driven by `shopping_item_id` beyond passing it
  through to `POST /receipts/process` untouched (confirmed decision —
  no auto-checking matched items).
- A retry-the-photo loop on parse failure — 422 goes straight to the
  existing manual form (confirmed decision).
- A confirmation dialog before running categorize (confirmed decision —
  it's a reorder, not a delete, matches this app's instant-action
  convention elsewhere).
- Any change to how `sort_order` itself is computed/persisted for manual
  drag-reorder (`shopping-drag-reorder-fix`) — categorize is a separate,
  independent trigger that happens to write the same field.

## Implementation Approach

Three phases. Phase 1 adds the client-layer plumbing (multipart upload,
types, categorize call) with no UI changes yet — independently
verifiable via typecheck/build since there's no test harness to exercise
a real network call in isolation. Phase 2 rebuilds the receipt modal on
top of that plumbing. Phase 3 adds the categorize button, independent of
Phase 2's changes (touches a different part of `shopping.tsx`).

## Phase 1: Client API layer

### Overview

Adds the multipart upload capability, receipt-parse response types, the
categorize API call, and the `shopping_item_id` field — no UI changes.

### Changes Required:

#### 1. Receipt-parse and categorize types

**File**: `src/lib/api/types.ts`

**Intent**: Mirror the backend's response shapes for both new endpoints,
and add the optional linking field the backend added to `PurchaseLine`.

**Contract**: Add `shopping_item_id?: string | null` to the existing
`PurchaseLine` interface (already has `name`, `price`) — optional so the
manual-entry path (no AI match data at all) can omit it entirely, and
nullable so the AI path can pass through the backend's explicit `null`
("no good match") without a lossy conversion. Add two new interfaces:
```ts
export interface ReceiptParseLine {
  name: string;
  price: number;
  shopping_item_id: string | null;
}

export interface ReceiptParseResult {
  store: string;
  category: string;
  total: number;
  purchased_at: string;
  lines: ReceiptParseLine[];
}
```

#### 2. Multipart upload call

**File**: `src/lib/api/client.ts`

**Intent**: `POST /receipts/parse` with a real image file. This is the
first multipart request in the codebase — the request must NOT set
`Content-Type` itself (only `Accept` + the auth header), so the browser
can generate the correct `multipart/form-data; boundary=…` value; setting
it manually breaks the boundary and the backend can't parse the body.

**Contract**: `apiParseReceipt(file: File): Promise<{ok: true; data:
ReceiptParseResult} | {ok: false; status: number; message?: string}>`.
Build a `FormData` with the file under the `image` field, `fetch` with
`method: "POST"`, `headers: {Accept: "application/json", ...authHeaders()}`
(no `Content-Type` key at all), `body: formData`,
`signal: AbortSignal.timeout(10_000)` matching every other call's
timeout. On `res.ok`, return `{ok: true, data: await res.json()}`. On
non-ok, parse the body for `{message}` if present (backend's 422 shape)
and return `{ok: false, status: res.status, message: body?.message}`.

#### 3. Categorize call

**File**: `src/lib/api/client.ts`

**Intent**: `POST /shopping-items/categorize`, no body, synchronous
(caller needs the reordered list back immediately to update state) —
same shape as `apiRegenerateShareCode`.

**Contract**: `apiCategorizeShoppingItems(): Promise<{ok: true; items:
ShoppingItem[]} | {ok: false; status: number}>`. POST with
`Accept`+auth headers only, no body. On `res.ok`, return `{ok: true,
items: await res.json()}`. On non-ok, return `{ok: false, status:
res.status}` (no message parsing needed here — the caller shows a
generic toast per the confirmed UX).

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `bunx tsc -p tsconfig.json`
- Lint passes: `bun run lint`
- Build succeeds: `bun run build`

#### Manual Verification:

- N/A — no UI changes in this phase; verified indirectly by Phase 2/3
  actually using these functions successfully.

---

## Phase 2: Receipt parse UI

### Overview

Replaces the mock capture/processing/form flow with a real upload, an
editable AI-review step on success, and today's existing manual form as
the fallback on failure or skip.

### Changes Required:

#### 1. `completePurchase` accepts real AI-derived lines

**File**: `src/lib/store.tsx`

**Intent**: The manual-entry path (422/skip) keeps today's naive-split
pricing exactly as-is; the AI-success path needs to save the real
per-line names/prices/`shopping_item_id` the user confirmed, and use the
receipt's own date instead of "now" (confirmed decision).

**Contract**: `completePurchase`'s parameter type gains two optional
fields: `lines?: PurchaseLine[]` and `purchased_at?: string`. When
`lines` is provided, use it directly instead of computing the naive
split; when `purchased_at` is provided, use it instead of
`new Date().toISOString()`. Both default to today's existing behavior
when absent (the manual-entry call site passes neither).

#### 2. Real upload + AI review step

**File**: `src/components/ReceiptCheckoutModal.tsx`

**Intent**: Replace the mock flow. The file input becomes a real trigger
for `apiParseReceipt`; success shows an editable draft (store/category/
total inputs — same as today's form — plus an editable list of AI-parsed
lines, each with an editable name/price and a remove button); failure or
"Pomiń zdjęcie" lands on today's existing 3-field form unchanged.

**Contract**: File input drops `capture="environment"` (keep
`accept="image/*"` only, per confirmed decision — lets the OS offer both
camera and library). On file selection: set a `processing` step, call
`apiParseReceipt(file)`. On success: populate new local state
(`store`/`total`/`category` prefilled from the result, plus a
`lines: ReceiptParseLine[]` array seeded from `result.lines`, plus a
`purchasedAt` string from `result.purchased_at`) and move to a new
`review` step. On failure (422 or thrown network error): toast the
backend's `message` (or a generic fallback if a network error, not a
422, produced no message) and move to today's existing `form` step
(unchanged — naive split, no AI lines). "Pomiń zdjęcie" goes straight to
`form` as it does today. The `review` step's confirm button calls
`completePurchase({store, total, category, lines, purchased_at:
purchasedAt})` using the (possibly user-edited) local `lines` array
mapped to `PurchaseLine` shape (`name`, `price`, `shopping_item_id`);
removing a line in the review UI just filters it out of local `lines`
state before submit.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `bunx tsc -p tsconfig.json`
- Lint passes: `bun run lint`
- Build succeeds: `bun run build`

#### Manual Verification:

- Upload a real receipt photo against the live backend — confirm the
  review step shows AI-parsed store/category/total/lines, editing a
  line's name/price updates it, removing a line drops it, and saving
  produces a `Purchase` with those exact (possibly edited) lines and the
  receipt's own date, not today's date.
- Force a 422 (e.g. upload a non-receipt image) — confirm the toast
  shows the backend's message and the manual 3-field form appears,
  behaving exactly as it does on `main` today (naive split, current
  date).
- Tap "Pomiń zdjęcie" — confirm it goes straight to the manual form as
  before, completely unaffected by this phase's changes.
- Confirm the file picker offers both camera and library options (not
  camera-only).

---

## Phase 3: Categorize UI

### Overview

Adds the "Kategoryzuj" button next to the Zakupy page header, wired to
the new categorize API call.

### Changes Required:

#### 1. Store action for categorize

**File**: `src/lib/store.tsx`

**Intent**: Categorize replaces the entire `shopping` array wholesale
(the backend returns every item, reordered) — this needs to live in the
store like every other piece of shopping state, not as a one-off direct
fetch from the route component.

**Contract**: New `StoreValue` method
`categorizeShoppingItems: () => Promise<boolean>` (returns whether it
succeeded, so the caller can toast appropriately). Implementation calls
`apiCategorizeShoppingItems()`; on `ok`, `setState(s => ({...s, shopping:
result.items}))` and return `true`; on failure, return `false` without
touching state (list stays untouched, matching the backend's "list
untouched on failure" contract).

#### 2. Categorize button

**File**: `src/routes/shopping.tsx`

**Intent**: A small icon button in the existing `PageHeader`'s `action`
slot (a prop the component already supports, currently unused on this
route), disabled when there's nothing to sort, with a loading state
while the request is in flight.

**Contract**: Add an `action` prop to the route's `<PageHeader>` with a
button (icon: a sort/wand-style lucide icon consistent with this app's
existing icon choices) that's `disabled` when `pending === 0` (the
existing pending-count variable already computed on this route) or while
a local `categorizing` boolean is true. `onClick`: set `categorizing`
true, `await categorizeShoppingItems()`, toast success ("Lista
posortowana") or failure ("Nie udało się skategoryzować listy. Spróbuj
ponownie." — matches the backend's own 422 message) based on the
returned boolean, then set `categorizing` false.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `bunx tsc -p tsconfig.json`
- Lint passes: `bun run lint`
- Build succeeds: `bun run build`

#### Manual Verification:

- With items on the list, tap "Kategoryzuj" against the live backend —
  confirm the list reorders into aisle-category groups (produce, dairy,
  meat, snacks, paper/household, personal care per the peer's own smoke
  test) and a success toast appears.
- Confirm done items are preserved and stay appended after the pending
  ones (not reordered into the aisle groups themselves).
- Clear the list to 0 pending items — confirm the button is disabled.
- While the request is in flight, confirm the button shows a loading
  state and can't be double-tapped.

---

## Testing Strategy

No automated test framework exists in this repo. Every phase's automated
gate is `tsc` + `eslint` + `bun run build`; correctness against the real
AI endpoints is manual-only, against the live backend the peer session
already deployed — this is also the "real end-to-end pass" the peer
session asked to do together once this UI exists.

### Manual Testing Steps (full flow, after all phases):

1. Add a few items to `/shopping`, check some off.
2. Tap "Zakończ zakupy", upload a real receipt photo, confirm the AI
   review step, edit a line, save — confirm the purchase and its lines
   look right.
3. Repeat with a bad/non-receipt image to exercise the 422 fallback.
4. Add fresh pending items spanning a few aisle categories (e.g. milk,
   apples, chicken, chips), tap "Kategoryzuj", confirm they group
   sensibly.

## Performance Considerations

Image uploads use the same 10s `AbortSignal.timeout` as every other
request in this codebase — no special handling for large files beyond
the backend's own 10MB limit (enforced server-side, not duplicated
client-side per this plan's scope).

## Migration Notes

None — no local data model changes, only new optional fields.

## References

- Backend contract: cross-session message from
  `deploy-homecraft-api-aws-bref`, 2026-09-30 (both endpoints, already
  committed on `main` at `c7a8741`/`7b1c506`).
- Existing synchronous-call pattern to follow:
  `src/lib/api/client.ts`'s `apiRegenerateShareCode`.
- Existing header-action pattern to follow: `src/routes/index.tsx` and
  `src/routes/cookbook.index.tsx`'s `<PageHeader action={...}>` usage.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Client API layer

#### Automated

- [x] 1.1 Typecheck passes: `bunx tsc -p tsconfig.json` — a25d265
- [x] 1.2 Lint passes: `bun run lint` — a25d265
- [x] 1.3 Build succeeds: `bun run build` — a25d265

### Phase 2: Receipt parse UI

#### Automated

- [x] 2.1 Typecheck passes: `bunx tsc -p tsconfig.json`
- [x] 2.2 Lint passes: `bun run lint`
- [x] 2.3 Build succeeds: `bun run build`

#### Manual

- [ ] 2.4 Real receipt upload shows correct AI review step; edit/remove work; save produces correct Purchase with receipt's own date
- [ ] 2.5 Forced 422 shows backend message and correct manual-form fallback, unchanged from today
- [ ] 2.6 "Pomiń zdjęcie" still goes straight to manual form, unaffected
- [ ] 2.7 File picker offers camera and library, not camera-only

### Phase 3: Categorize UI

#### Automated

- [ ] 3.1 Typecheck passes: `bunx tsc -p tsconfig.json`
- [ ] 3.2 Lint passes: `bun run lint`
- [ ] 3.3 Build succeeds: `bun run build`

#### Manual

- [ ] 3.4 Categorize groups pending items into sensible aisle order against live backend, success toast shown
- [ ] 3.5 Done items preserved, appended after pending, not reordered into aisle groups
- [ ] 3.6 Button disabled at 0 pending items
- [ ] 3.7 Button shows loading state in flight, no double-tap
