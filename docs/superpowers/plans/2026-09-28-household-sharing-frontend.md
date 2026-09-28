# Household Sharing (Frontend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a HomeSync user join an existing household via a one-time share code, get gently prompted for their name the first time they try to write something as a joiner, and see/manage household members, the share code, and an activity log from a new account screen.

**Architecture:** Extend the existing offline-first client (`src/lib/store.tsx` + `src/lib/api/client.ts`) with four new pieces: (1) two new synchronous (non-queued) API calls — `apiProfile` and `apiRegenerateShareCode` — alongside the existing `apiGet`/`apiAuth`/queue machinery; (2) a `POST /join` public route mirroring `/login`; (3) a profile-completion gate implemented **inside `store.tsx`** (not per call-site) — every mutating store function is wrapped by a `gated()` helper that, when the local `profile-complete` flag is `false`, stashes the action and opens a modal instead of running it; (4) a new `/account` route surfacing profile/members/share-code/activity, reached via a header icon. This deviates from the design spec's originally-proposed per-call-site `runGated` hook: centralizing the wrap inside `store.tsx` gives the same UX with one choke point instead of touching every mutating call site across `TaskWizard`, `ReceiptCheckoutModal`, the shopping/cookbook routes, etc. — lower risk of a missed spot, same public API surface for consumers.

**Tech Stack:** React 19, TanStack Router (file-based routes, SPA/GH-Pages build), TanStack Query (unused by this feature directly), Tailwind, shadcn/radix `Dialog`/`Button`/`Input` components, `sonner` toasts, Bun.

**Spec:** `docs/superpowers/specs/2026-09-28-household-sharing-frontend-design.md` (frontend). Backend contract: `../HomeCraftApi/docs/superpowers/specs/2026-09-28-household-sharing-design.md`.

## Global Constraints

- All new fetches use `AbortSignal.timeout(10_000)`, matching every existing call in `client.ts`.
- `PATCH /profile` returns `204` with no body (confirmed against `ProfileController::update`) — never parse a body from it.
- `POST /join` returns `201 {token}` on success, `422` with Laravel's standard `{message, errors: {share_code: [...]}}` shape on failure (confirmed against `JoinController`/`JoinRequest`) — do not assume a flat `{error: string}` shape for this endpoint.
- The profile-completion 422 (confirmed against `EnsureProfileComplete` middleware) is `{message, error: "profile_incomplete"}` — a flat `error` key, distinct from `/join`'s `errors` (plural, nested) shape. Don't conflate the two.
- `GET /household` returns `{id, members: [{id, name, is_owner}], share_code}`; `share_code` is `null` unless the caller is the household owner (confirmed against `HouseholdResource`) — never assume a non-owner can read it.
- `GET /household/activity` is Laravel's default paginated resource-collection shape: `{data: ActivityLogEntry[], links: {...}, meta: {current_page, last_page, ...}}`, not a bare array.
- `POST /household/share-code` is owner-only; a non-owner gets `403`.
- All new UI copy is Polish, matching every existing route (`login.tsx`, `index.tsx`, etc.).
- Do not touch the sync queue's retry/dead-letter semantics for any status other than the new `profile_incomplete` special case (Task 3) — existing 4xx-dead-letters-everything-else behavior stays.

## Review Focus

- **Two open tabs, one goes through the gate:** tab A resolves the profile-completion modal and sets `profile-complete: true`; tab B still has a stale in-memory `profileGate` open with its own pending action. Not solved by this plan (no cross-tab sync mechanism exists anywhere in this codebase today) — acceptable per spec's known gaps, but the modal must not crash or double-submit if this happens; Task 5's cancel path covers "user closes the modal without submitting."
- **Regenerating the share code twice in a row:** the account screen must display the *latest* code returned by `apiRegenerateShareCode`, not a stale one from the initial `GET /household` load — Task 7's state update must replace, not merge.
- **Activity log pagination exhausted:** hitting "Załaduj więcej" on the last page must not throw or silently loop — Task 7 checks `meta.current_page < meta.last_page` before rendering the button.
- **`/join` with a garbage or already-redeemed code:** must surface a non-crashing message and never store a token. The backend deliberately returns the same generic message for "wrong code" and "already used" (no enumeration) — Task 6's error branch matches that by always showing one generic toast on any non-`429` failure, never parsing `data.errors` for a more specific one, and never calls `setAuthToken` on a non-`ok` response.
- **Network failure mid-gate (not a 4xx, an actual thrown/timeout error) on `PATCH /profile`:** `resolveProfileGate` must not silently swallow this — Task 4's `resolveProfileGate` lets the throw propagate to the modal's `catch`, Task 5's modal shows a toast and leaves the modal open (doesn't clear `profileGate`) so the user can retry.

---

## Task 1: Types for household/activity data

**Files:**
- Modify: `src/lib/api/types.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `HouseholdMember`, `Household`, `ActivityLogEntry`, `ActivityPage` — consumed by Task 3 (client.ts), Task 4 (store.tsx doesn't need these directly), and Task 7 (account.tsx).

- [ ] **Step 1: Add the new types**

Append to `src/lib/api/types.ts`:

```ts
export interface HouseholdMember {
  id: number;
  name: string | null;
  is_owner: boolean;
}

export interface Household {
  id: string;
  members: HouseholdMember[];
  share_code: string | null;
}

export interface ActivityLogEntry {
  id: string;
  actor_name: string;
  action: "created" | "updated" | "deleted";
  subject_type: string;
  subject_label: string;
  created_at: string;
}

export interface ActivityPage {
  data: ActivityLogEntry[];
  meta: {
    current_page: number;
    last_page: number;
  };
}
```

- [ ] **Step 2: Typecheck**

Run: `bunx tsc -p tsconfig.json`
Expected: no errors (this file has no consumers yet, so this only checks the new block parses/typechecks in isolation).

- [ ] **Step 3: Commit**

```bash
git add src/lib/api/types.ts
git commit -m "feat: add household/activity types"
```

---

## Task 2: Profile-completion flag and local name storage

**Files:**
- Modify: `src/lib/auth.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `getProfileComplete(): boolean`, `setProfileComplete(complete: boolean): void`, `getMyName(): string | null`, `setMyName(name: string): void` — consumed by Task 3 (`client.ts`'s `flushQueue` fallback), Task 4 (`store.tsx`'s gate), Task 6 (`join.tsx` sets the flag false), Task 7 (`account.tsx` prefill).

- [ ] **Step 1: Add the storage helpers and wire logout to clear them**

Modify `src/lib/auth.ts` — add two new keys next to `TOKEN_KEY`, four new exported functions, and clear both on `clearAuthToken` (a fresh login/join on the same device shouldn't inherit the previous account's cached name/flag):

```ts
/** Sanctum bearer token storage — see docs/api-integration-guide.md §3. */

const TOKEN_KEY = "homesync.auth-token";
const PROFILE_COMPLETE_KEY = "homesync.profile-complete";
const MY_NAME_KEY = "homesync.my-name";

function isBrowser() {
  return typeof window !== "undefined";
}

export function getAuthToken(): string | null {
  if (!isBrowser()) return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setAuthToken(token: string) {
  if (!isBrowser()) return;
  window.localStorage.setItem(TOKEN_KEY, token);
  window.dispatchEvent(new CustomEvent("homesync:auth"));
}

export function clearAuthToken() {
  if (!isBrowser()) return;
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(PROFILE_COMPLETE_KEY);
  window.localStorage.removeItem(MY_NAME_KEY);
  window.dispatchEvent(new CustomEvent("homesync:auth"));
}

export function isAuthenticated(): boolean {
  return getAuthToken() !== null;
}

/**
 * Whether the current account has a name set server-side. Defaults to
 * `true` (existing users, fresh register/SSO accounts always have a name
 * already) — only `/join` (share-code signup) sets this `false`, since a
 * joiner has no name until they complete PATCH /profile. See
 * docs/superpowers/specs/2026-09-28-household-sharing-frontend-design.md §C.
 */
export function getProfileComplete(): boolean {
  if (!isBrowser()) return true;
  return window.localStorage.getItem(PROFILE_COMPLETE_KEY) !== "false";
}

export function setProfileComplete(complete: boolean) {
  if (!isBrowser()) return;
  window.localStorage.setItem(PROFILE_COMPLETE_KEY, complete ? "true" : "false");
}

/** Local cache of "my name" for prefill only — the backend has no "who am I"
 * endpoint distinct from the household members list, so this is best-effort
 * and can go stale across devices. See design doc's Open Questions. */
export function getMyName(): string | null {
  if (!isBrowser()) return null;
  return window.localStorage.getItem(MY_NAME_KEY);
}

export function setMyName(name: string) {
  if (!isBrowser()) return;
  window.localStorage.setItem(MY_NAME_KEY, name);
}

/** Full-page nav into the backend's server-side OAuth redirect — not a client SDK. */
export function ssoRedirectUrl(provider: "google" | "apple", apiBase: string): string {
  return `${apiBase}/auth/${provider}/redirect`;
}
```

- [ ] **Step 2: Typecheck and lint**

Run: `bunx tsc -p tsconfig.json && bun run lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/auth.ts
git commit -m "feat: add profile-complete flag and local name cache"
```

---

## Task 3: New API client calls + queue fallback for profile_incomplete

**Files:**
- Modify: `src/lib/api/client.ts`

**Interfaces:**
- Consumes: `getProfileComplete`/`setProfileComplete` from Task 2 (`../auth`, already imported as a relative path from this file).
- Produces: `apiProfile(name: string): Promise<{ok: boolean; status: number}>`, `apiRegenerateShareCode(): Promise<{ok: true; share_code: string} | {ok: false; status: number}>` — both consumed by Task 4 (`store.tsx`) and Task 7 (`account.tsx`). `apiJoin` is **not** added here — Task 6 calls the existing generic `apiAuth<{token: string}>("/join", body)` directly, since `/join`'s success/error shape already matches what `apiAuth` returns.

- [ ] **Step 1: Add `apiProfile` and `apiRegenerateShareCode`**

Modify `src/lib/api/client.ts` — extend the import from `../auth` and add two functions after `apiAuth`:

```ts
import { clearAuthToken, getAuthToken, isAuthenticated, setProfileComplete } from "../auth";
```

Add after the existing `apiAuth` function (before `export { API_BASE };`):

```ts
/**
 * PATCH /profile — synchronous, not queued. Unlike domain mutations, the
 * profile-completion gate (store.tsx) needs to know the result before
 * running the action it was blocking, so this bypasses enqueue().
 * Returns 204 with no body on success (confirmed against ProfileController).
 */
export async function apiProfile(name: string): Promise<{ ok: boolean; status: number }> {
  const res = await fetch(`${API_BASE}/profile`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify({ name }),
    signal: AbortSignal.timeout(10_000),
  });
  return { ok: res.ok, status: res.status };
}

/** POST /household/share-code — synchronous, owner-only (403 for non-owners). */
export async function apiRegenerateShareCode(): Promise<
  { ok: true; share_code: string } | { ok: false; status: number }
> {
  const res = await fetch(`${API_BASE}/household/share-code`, {
    method: "POST",
    headers: { Accept: "application/json", ...authHeaders() },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return { ok: false, status: res.status };
  const data = (await res.json()) as { share_code: string };
  return { ok: true, share_code: data.share_code };
}
```

- [ ] **Step 2: Add the `profile_incomplete` fallback to `flushQueue`**

In `flushQueue`, replace:

```ts
        if (!res.ok && res.status >= 500) break; // retry later
        if (!res.ok) recordFailed(next); // 4xx — backend rejected it, dead-letter instead of silent drop
```

with:

```ts
        if (!res.ok && res.status >= 500) break; // retry later
        if (!res.ok && res.status === 422) {
          const body = (await res.json().catch(() => undefined)) as
            | { error?: string }
            | undefined;
          if (body?.error === "profile_incomplete") {
            // Proactive gate in store.tsx should catch this before a request
            // is ever queued — this only fires if that flag drifted (e.g. a
            // second tab). Leave the request queued (don't dead-letter) and
            // flip the flag so the next gated action re-surfaces the modal.
            setProfileComplete(false);
            break;
          }
        }
        if (!res.ok) recordFailed(next); // 4xx — backend rejected it, dead-letter instead of silent drop
```

- [ ] **Step 3: Typecheck and lint**

Run: `bunx tsc -p tsconfig.json && bun run lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/api/client.ts
git commit -m "feat: add profile/share-code API calls, queue fallback for profile_incomplete"
```

---

## Task 4: Profile-completion gate inside the store

**Files:**
- Modify: `src/lib/store.tsx`

**Interfaces:**
- Consumes: `apiProfile` from Task 3 (`./api/client`); `getProfileComplete`, `setProfileComplete`, `setMyName` from Task 2 (`./auth`).
- Produces: `StoreValue.profileGateOpen: boolean`, `StoreValue.resolveProfileGate: (name: string) => Promise<{ok: boolean; status: number}>`, `StoreValue.cancelProfileGate: () => void` — all consumed by Task 5 (`CompleteProfileModal`). Every existing mutating method on `StoreValue` (`logTask`, `addTask`, `removeTask`, `updateTask`, `addShoppingItems`, `toggleShoppingItem`, `removeShoppingItem`, `dismissWarning`, `completePurchase`, `addRecipe`, `addTin`, `removeTin`) keeps its existing signature — callers in every other file are unaffected by this task.

- [ ] **Step 1: Import the new dependencies**

In `src/lib/store.tsx`, change:

```ts
import { apiGet, enqueue, flushQueue, readQueue } from "./api/client";
```
to:
```ts
import { apiGet, apiProfile, enqueue, flushQueue, readQueue } from "./api/client";
```

and change:
```ts
import { isAuthenticated } from "./auth";
```
to:
```ts
import { getProfileComplete, isAuthenticated, setMyName, setProfileComplete } from "./auth";
```

- [ ] **Step 2: Add `profileGateOpen`/`resolveProfileGate`/`cancelProfileGate` to the `StoreValue` interface**

Add these three lines to the `StoreValue` interface, after `pendingSync: number;`:

```ts
  profileGateOpen: boolean;
  resolveProfileGate: (name: string) => Promise<{ ok: boolean; status: number }>;
  cancelProfileGate: () => void;
```

- [ ] **Step 3: Add the gate state and helpers inside `HomeSyncProvider`**

Inside `HomeSyncProvider`, after the existing `const [pendingSync, setPendingSync] = useState(0);` line, add:

```ts
  const [profileGate, setProfileGate] = useState<(() => void) | null>(null);

  const gated = useCallback((action: () => void) => {
    if (getProfileComplete()) {
      action();
    } else {
      setProfileGate(() => action);
    }
  }, []);

  const resolveProfileGate = useCallback(
    async (name: string) => {
      const res = await apiProfile(name);
      if (res.ok) {
        setProfileComplete(true);
        setMyName(name);
        const pending = profileGate;
        setProfileGate(null);
        pending?.();
      }
      return res;
    },
    [profileGate],
  );

  const cancelProfileGate = useCallback(() => setProfileGate(null), []);
```

- [ ] **Step 4: Wrap every mutating function body in `gated(() => ...)`**

In the `value` object (inside the `useMemo`), wrap each of these twelve functions' existing bodies. This is purely mechanical — each function keeps its parameter list and just wraps its body in `gated(() => { ... })`, changing nothing about the logic inside. Example for `logTask` (apply the same wrapping pattern to the other eleven):

```ts
      logTask: (taskId) =>
        gated(() => {
          haptic();
          const loggedAt = new Date().toISOString();
          setState((s) => ({
            ...s,
            tasks: s.tasks.map((t) => (t.id === taskId ? { ...t, last_done_at: loggedAt } : t)),
            logs: [{ id: crypto.randomUUID(), task_id: taskId, logged_at: loggedAt }, ...s.logs],
          }));
          enqueue("POST", "/maintenance-logs", { task_id: taskId, logged_at: loggedAt });
        }),
      addTask: (task) =>
        gated(() => {
          const created: MaintenanceTask = {
            ...task,
            id: crypto.randomUUID(),
            last_done_at: new Date().toISOString(),
          };
          setState((s) => ({ ...s, tasks: [created, ...s.tasks] }));
          enqueue("POST", "/maintenance-tasks", created);
        }),
      removeTask: (taskId) =>
        gated(() => {
          setState((s) => ({ ...s, tasks: s.tasks.filter((t) => t.id !== taskId) }));
          enqueue("DELETE", `/maintenance-tasks/${taskId}`);
        }),
      updateTask: (taskId, patch) =>
        gated(() => {
          setState((s) => ({
            ...s,
            tasks: s.tasks.map((t) => (t.id === taskId ? { ...t, ...patch } : t)),
          }));
          enqueue("PATCH", `/maintenance-tasks/${taskId}`, patch);
        }),
      addShoppingItems: (items) =>
        gated(() => {
          haptic();
          const created: ShoppingItem[] = items.map((i) => ({
            ...i,
            id: crypto.randomUUID(),
            done: false,
            created_at: new Date().toISOString(),
          }));
          setState((s) => ({ ...s, shopping: [...created, ...s.shopping] }));
          enqueue("POST", "/shopping-items/batch", { items: created });
        }),
      toggleShoppingItem: (id) =>
        gated(() => {
          haptic();
          setState((s) => ({
            ...s,
            shopping: s.shopping.map((i) => (i.id === id ? { ...i, done: !i.done } : i)),
          }));
          enqueue("PATCH", `/shopping-items/${id}/toggle`);
        }),
      removeShoppingItem: (id) =>
        gated(() => {
          setState((s) => ({ ...s, shopping: s.shopping.filter((i) => i.id !== id) }));
          enqueue("DELETE", `/shopping-items/${id}`);
        }),
      dismissWarning: (id) =>
        gated(() => {
          setState((s) => ({
            ...s,
            shopping: s.shopping.map((i) => (i.id === id ? { ...i, warning_dismissed: true } : i)),
          }));
          enqueue("PATCH", `/shopping-items/${id}`, { warning_dismissed: true });
        }),
      completePurchase: ({ store, total, category }) =>
        gated(() => {
          haptic(25);
          setState((s) => {
            const bought = s.shopping.filter((i) => i.done);
            const purchase: Purchase = {
              id: crypto.randomUUID(),
              store,
              category,
              total,
              purchased_at: new Date().toISOString(),
              lines: bought.map((i) => ({
                name: i.name,
                price: Math.round((total / Math.max(bought.length, 1)) * 100) / 100,
              })),
            };
            enqueue("POST", "/receipts/process", purchase);
            return {
              ...s,
              shopping: s.shopping.filter((i) => !i.done),
              purchases: [purchase, ...s.purchases],
            };
          });
        }),
      dismissSuggestion: (name) =>
        setState((s) => ({ ...s, dismissed_suggestions: [...s.dismissed_suggestions, name] })),
      daysSincePurchase,
      addRecipe: (recipe) =>
        gated(() => {
          const created: Recipe = { ...recipe, id: crypto.randomUUID() };
          setState((s) => ({ ...s, recipes: [created, ...s.recipes] }));
          enqueue("POST", "/recipes", created);
        }),
      addTin: (tin) =>
        gated(() => {
          const created: Tin = { ...tin, id: crypto.randomUUID() };
          setState((s) => ({ ...s, tins: [created, ...s.tins] }));
          enqueue("POST", "/tins", created);
        }),
      removeTin: (id) =>
        gated(() => {
          setState((s) => ({ ...s, tins: s.tins.filter((t) => t.id !== id) }));
          enqueue("DELETE", `/tins/${id}`);
        }),
```

Note `dismissSuggestion` is deliberately **not** wrapped — it never calls `enqueue()` (it's pure local state, per `docs/backend-api-spec.md` §6.4, never synced to the backend), so there's no backend write to gate.

- [ ] **Step 5: Expose the new fields on `value` and update the `useMemo` deps**

Add to the returned object (anywhere alongside `hydrated`/`pendingSync`):

```ts
      profileGateOpen: profileGate !== null,
      resolveProfileGate,
      cancelProfileGate,
```

Update the `useMemo` dependency array from:

```ts
    [state, hydrated, pendingSync, haptic, daysSincePurchase],
```
to:
```ts
    [state, hydrated, pendingSync, haptic, daysSincePurchase, profileGate, gated, resolveProfileGate, cancelProfileGate],
```

- [ ] **Step 6: Typecheck and lint**

Run: `bunx tsc -p tsconfig.json && bun run lint`
Expected: no errors. Pay attention to any "used before declaration" issue — `gated` must be declared (Step 3) before the `useMemo` block that references it (it already will be, since Step 3 inserts above the existing `const value = useMemo(...)`).

- [ ] **Step 7: Commit**

```bash
git add src/lib/store.tsx
git commit -m "feat: gate domain writes behind profile-completion in the store"
```

---

## Task 5: CompleteProfileModal component, wired into the app shell

**Files:**
- Create: `src/components/CompleteProfileModal.tsx`
- Modify: `src/routes/__root.tsx`

**Interfaces:**
- Consumes: `useHomeSync()` → `profileGateOpen`, `resolveProfileGate`, `cancelProfileGate` from Task 4.
- Produces: `<CompleteProfileModal />`, a self-contained component taking no props, rendered once in `__root.tsx`.

- [ ] **Step 1: Write the component**

Create `src/components/CompleteProfileModal.tsx`:

```tsx
import { useState } from "react";
import type { FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useHomeSync } from "@/lib/store";

export function CompleteProfileModal() {
  const { profileGateOpen, resolveProfileGate, cancelProfileGate } = useHomeSync();
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setPending(true);
    try {
      const res = await resolveProfileGate(trimmed);
      if (res.ok) {
        setName("");
      } else {
        toast.error("Nie udało się zapisać imienia — spróbuj ponownie.");
      }
    } catch {
      toast.error("Brak połączenia z serwerem — spróbuj ponownie.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={profileGateOpen} onOpenChange={(open) => !open && cancelProfileGate()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Jak masz na imię?</DialogTitle>
          <DialogDescription>
            Zanim coś dodasz lub zmienisz, ustaw swoje imię — inni domownicy zobaczą je w historii
            aktywności.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <Input
            placeholder="Imię"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
          />
          <Button type="submit" disabled={pending || !name.trim()}>
            Zapisz
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Render it in the app shell**

In `src/routes/__root.tsx`, add the import:

```ts
import { CompleteProfileModal } from "@/components/CompleteProfileModal";
```

Then render `<CompleteProfileModal />` inside `HomeSyncProvider`, alongside the existing `<Toaster />`:

```tsx
      <HomeSyncProvider>
        <div
          className={cn("mx-auto min-h-screen max-w-lg bg-background", !isPublicRoute && "pb-24")}
        >
          {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
          <Outlet />
        </div>
        {!isPublicRoute && <TabBar />}
        <Toaster position="top-center" />
        <CompleteProfileModal />
      </HomeSyncProvider>
```

- [ ] **Step 3: Typecheck and lint**

Run: `bunx tsc -p tsconfig.json && bun run lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/CompleteProfileModal.tsx src/routes/__root.tsx
git commit -m "feat: add profile-completion modal to app shell"
```

---

## Task 6: `/join` route

**Files:**
- Create: `src/routes/join.tsx`
- Modify: `src/routes/login.tsx`
- Modify: `src/routes/__root.tsx`

**Interfaces:**
- Consumes: `apiAuth` (existing, from `@/lib/api/client`), `setAuthToken` (existing, from `@/lib/auth`), `setProfileComplete` from Task 2.
- Produces: the `/join` route itself; no new exports consumed elsewhere.

- [ ] **Step 1: Add `/join` to the public routes set**

In `src/routes/__root.tsx`, change:

```ts
const PUBLIC_ROUTES = new Set(["/login", "/auth/callback"]);
```
to:
```ts
const PUBLIC_ROUTES = new Set(["/login", "/join", "/auth/callback"]);
```

- [ ] **Step 2: Write the join route**

Create `src/routes/join.tsx`:

```tsx
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiAuth } from "@/lib/api/client";
import { setAuthToken, setProfileComplete } from "@/lib/auth";

export const Route = createFileRoute("/join")({
  head: () => ({ meta: [{ title: "Dołącz do domu — HomeSync" }] }),
  component: JoinPage,
});

function JoinPage() {
  const navigate = useNavigate();
  const [shareCode, setShareCode] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    try {
      const res = await apiAuth<{ token: string }>("/join", {
        share_code: shareCode,
        email,
        password,
      });
      if (res.ok) {
        setAuthToken(res.data.token);
        setProfileComplete(false);
        void navigate({ to: "/", replace: true });
        return;
      }
      if (res.status === 429) {
        toast.error("Zbyt wiele prób — spróbuj ponownie za chwilę.");
      } else {
        toast.error("Nieprawidłowy lub już wykorzystany kod zaproszenia.");
      }
    } catch {
      toast.error("Brak połączenia z serwerem — spróbuj ponownie.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col justify-center px-6 pb-24 pt-safe">
      <div className="mx-auto w-full max-w-sm">
        <h1 className="text-2xl font-bold tracking-tight">Dołącz do domu</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Wpisz kod zaproszenia, który dostałeś/aś od właściciela konta.
        </p>

        <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-3">
          <Input
            placeholder="Kod zaproszenia"
            value={shareCode}
            onChange={(e) => setShareCode(e.target.value)}
            required
          />
          <Input
            type="email"
            placeholder="E-mail"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <Input
            type="password"
            placeholder="Hasło"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
          />
          <Button type="submit" disabled={pending}>
            Dołącz
          </Button>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Link to it from the login page**

In `src/routes/login.tsx`, add a link after the mode-toggle button (after the `</button>` that closes the "Nie masz konta? Zarejestruj się" toggle, before the `<div className="mt-6 flex items-center gap-3 text-xs text-muted-foreground">` separator):

```tsx
        <Link
          to="/join"
          className="mt-1 block w-full text-center text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          Masz kod zaproszenia? Dołącz
        </Link>
```

Add the import at the top of `login.tsx`:

```ts
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
```
(replacing the existing `import { createFileRoute, useNavigate } from "@tanstack/react-router";`).

- [ ] **Step 4: Typecheck and lint**

Run: `bunx tsc -p tsconfig.json && bun run lint`
Expected: no errors.

- [ ] **Step 5: Regenerate the route tree and verify the dev server boots**

Run: `bun run dev` (start it, confirm no route-generation error in the terminal output, then stop it — `src/routeTree.gen.ts` is auto-generated by the TanStack Router vite plugin on file changes under `src/routes/`, never hand-edit it).
Expected: dev server starts cleanly, `/join` is a recognized route (visiting `http://localhost:<port>/join` renders the form, not a 404).

- [ ] **Step 6: Commit**

```bash
git add src/routes/join.tsx src/routes/login.tsx src/routes/__root.tsx src/routeTree.gen.ts
git commit -m "feat: add /join route for share-code signup"
```

---

## Task 7: Account screen (profile, household members, share code, activity)

**Files:**
- Create: `src/routes/account.tsx`
- Modify: `src/routes/__root.tsx` (remove logout button from `TabBar`)
- Modify: `src/routes/index.tsx` (add header icon linking to `/account`)

**Interfaces:**
- Consumes: `apiGet` (existing, `@/lib/api/client`), `apiProfile`/`apiRegenerateShareCode` from Task 3, `getMyName`/`clearAuthToken` from Task 2/existing `auth.ts`, `Household`/`ActivityPage`/`ActivityLogEntry` types from Task 1.
- Produces: `/account` route; no new exports consumed elsewhere.

- [ ] **Step 1: Remove the logout button from `TabBar`, add the header icon to the Dom route**

In `src/routes/__root.tsx`, remove the logout `<button>` block from `TabBar` (the `<button type="button" onClick={() => { clearAuthToken(); ... }}>` element and its contents). This also leaves two things unused in `TabBar` — remove both:
- The `const router = useRouter();` line inside `TabBar` (it was only read by the removed button's `onClick`; `RootComponent`'s own separate `useRouter()` call is untouched).
- The `clearAuthToken` import at the top of `__root.tsx` (nothing else in this file calls it — the `homesync:unauthorized` handler only navigates, it doesn't clear the token itself).

In `src/routes/index.tsx`, add the import:

```ts
import { Link } from "@tanstack/react-router";
```
merged into the existing router import if one exists (currently `index.tsx` only imports `createFileRoute` — change to `import { createFileRoute, Link } from "@tanstack/react-router";`), and:
```ts
import { UserCircle } from "lucide-react";
```
merged into the existing lucide-react import line.

In the `action` prop of the `<PageHeader>` in `index.tsx`, add the account link as the first child of the existing `<div className="flex gap-2 pt-1">`:

```tsx
        action={
          <div className="flex gap-2 pt-1">
            <Link
              to="/account"
              className="flex size-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label="Konto"
            >
              <UserCircle className="size-5" />
            </Link>
            <Button
              variant={editMode ? "default" : "secondary"}
              size="sm"
              className="rounded-full"
              onClick={() => setEditMode((v) => !v)}
            >
              {editMode ? "Gotowe" : "Edytuj"}
            </Button>
            <Button size="icon" className="size-9 rounded-full" onClick={() => setWizardOpen(true)}>
              <Plus className="size-5" />
            </Button>
          </div>
        }
```

- [ ] **Step 2: Write the account route**

Create `src/routes/account.tsx`:

```tsx
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Copy, LogOut, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiGet, apiProfile, apiRegenerateShareCode } from "@/lib/api/client";
import { clearAuthToken, getMyName } from "@/lib/auth";
import type { ActivityPage, Household } from "@/lib/api/types";

export const Route = createFileRoute("/account")({
  head: () => ({ meta: [{ title: "Konto — HomeSync" }] }),
  component: AccountPage,
});

const ACTION_LABEL: Record<"created" | "updated" | "deleted", string> = {
  created: "dodał(a)",
  updated: "zaktualizował(a)",
  deleted: "usunął/usunęła",
};

function AccountPage() {
  const router = useRouter();
  const [household, setHousehold] = useState<Household | null>(null);
  const [activity, setActivity] = useState<ActivityPage | null>(null);
  const [name, setName] = useState(() => getMyName() ?? "");
  const [savingName, setSavingName] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  useEffect(() => {
    void apiGet<Household | null>("/household", null).then(setHousehold);
    void apiGet<ActivityPage | null>("/household/activity?page=1", null).then(setActivity);
  }, []);

  async function onSaveName(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setSavingName(true);
    try {
      const res = await apiProfile(trimmed);
      if (res.ok) {
        toast.success("Zapisano imię.");
      } else {
        toast.error("Nie udało się zapisać imienia.");
      }
    } catch {
      toast.error("Brak połączenia z serwerem.");
    } finally {
      setSavingName(false);
    }
  }

  async function onRegenerate() {
    setRegenerating(true);
    try {
      const res = await apiRegenerateShareCode();
      if (res.ok) {
        setHousehold((h) => (h ? { ...h, share_code: res.share_code } : h));
      } else if (res.status === 403) {
        toast.error("Tylko właściciel domu może wygenerować kod.");
      } else {
        toast.error("Nie udało się wygenerować kodu.");
      }
    } catch {
      toast.error("Brak połączenia z serwerem.");
    } finally {
      setRegenerating(false);
    }
  }

  async function onLoadMore() {
    if (!activity || activity.meta.current_page >= activity.meta.last_page) return;
    const nextPage = activity.meta.current_page + 1;
    const next = await apiGet<ActivityPage | null>(`/household/activity?page=${nextPage}`, null);
    if (next) {
      setActivity((prev) =>
        prev ? { data: [...prev.data, ...next.data], meta: next.meta } : next,
      );
    }
  }

  function onLogout() {
    clearAuthToken();
    void router.navigate({ to: "/login", replace: true });
  }

  const hasMorePages = activity !== null && activity.meta.current_page < activity.meta.last_page;

  return (
    <div>
      <PageHeader title="Konto" subtitle="Profil, domownicy i historia zmian" />

      <div className="flex flex-col gap-6 px-4 pt-1">
        <section>
          <h2 className="text-sm font-semibold text-muted-foreground">Profil</h2>
          <form onSubmit={onSaveName} className="mt-2 flex gap-2">
            <Input
              placeholder="Imię"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
            <Button type="submit" disabled={savingName || !name.trim()}>
              Zapisz
            </Button>
          </form>
        </section>

        <section>
          <h2 className="text-sm font-semibold text-muted-foreground">Domownicy</h2>
          <ul className="mt-2 flex flex-col gap-2">
            {household?.members.map((m) => (
              <li
                key={m.id}
                className="flex items-center justify-between rounded-2xl border border-border px-3 py-2"
              >
                <span>{m.name ?? "Bez imienia"}</span>
                {m.is_owner && (
                  <span className="text-xs font-medium text-muted-foreground">Właściciel</span>
                )}
              </li>
            ))}
          </ul>

          {household?.share_code && (
            <div className="mt-3 flex items-center gap-2 rounded-2xl border border-border px-3 py-2">
              <code className="flex-1 text-sm font-semibold tracking-wide">
                {household.share_code}
              </code>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => void navigator.clipboard.writeText(household.share_code ?? "")}
                aria-label="Kopiuj kod"
              >
                <Copy className="size-4" />
              </Button>
            </div>
          )}

          {household && (household.share_code !== null || household.members.length > 0) && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="mt-2"
              onClick={() => void onRegenerate()}
              disabled={regenerating}
            >
              <RefreshCw className="mr-2 size-4" />
              Nowy kod
            </Button>
          )}
        </section>

        <section>
          <h2 className="text-sm font-semibold text-muted-foreground">Aktywność</h2>
          <ul className="mt-2 flex flex-col gap-2">
            {activity?.data.map((entry) => (
              <li key={entry.id} className="rounded-2xl border border-border px-3 py-2 text-sm">
                <span className="font-medium">{entry.actor_name}</span>{" "}
                {ACTION_LABEL[entry.action]} <span className="font-medium">{entry.subject_label}</span>
              </li>
            ))}
          </ul>
          {hasMorePages && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-2"
              onClick={() => void onLoadMore()}
            >
              Załaduj więcej
            </Button>
          )}
        </section>

        <Button type="button" variant="outline" onClick={onLogout} className="mb-4">
          <LogOut className="mr-2 size-4" />
          Wyloguj
        </Button>
      </div>
    </div>
  );
}
```

Note on the "Nowy kod" button's visibility condition: `POST /household/share-code` 403s for non-owners, and `GET /household` never reveals whether the *viewer* is the owner directly (only `share_code !== null` when they are, or `null` always for non-owners). The button is shown whenever a household is loaded at all; a non-owner tapping it gets the `403` branch's toast ("Tylko właściciel domu może wygenerować kod.") rather than the button being hidden — simpler than trying to infer ownership client-side from an already-ambiguous signal, and the failure mode is just an extra toast, not a broken flow.

- [ ] **Step 3: Typecheck and lint**

Run: `bunx tsc -p tsconfig.json && bun run lint`
Expected: no errors.

- [ ] **Step 4: Regenerate the route tree and verify the dev server boots**

Run: `bun run dev`, confirm `/account` is reachable and renders without a console error, stop the server.

- [ ] **Step 5: Commit**

```bash
git add src/routes/account.tsx src/routes/__root.tsx src/routes/index.tsx src/routeTree.gen.ts
git commit -m "feat: add /account screen (profile, household, activity, logout)"
```

---

## Task 8: End-to-end manual verification against the real backend

**Files:** none (verification only).

**Interfaces:** none.

- [ ] **Step 1: Start the backend**

Run (in `../HomeCraftApi`): `composer run dev` (or `./vendor/bin/sail up`, matching whatever this machine already uses — see that repo's `AGENTS.md`/`README.md` if unsure).

- [ ] **Step 2: Start the frontend**

Run: `bun run dev`, confirm `VITE_API_URL` in `.env` points at the running backend (`http://localhost/api` or equivalent per `docs/api-integration-guide.md` §1).

- [ ] **Step 3: Walk the checklist from the design spec**

In a real browser (not just curl — the OAuth-adjacent flows and clipboard copy need a real DOM):

- [ ] Register a fresh account (owner). Confirm it lands on `/`, and `/account` shows one member, no share code yet (or an empty state — no "Nowy kod" click yet).
- [ ] On `/account`, tap "Nowy kod". Confirm a code appears and the copy button copies it.
- [ ] In a private/incognito window, go to `/join`, enter that code + a new email/password. Confirm it succeeds, lands on `/`, and `/account`'s Domownicy list (refresh the owner's tab) now shows two members, the joiner as "Bez imienia".
- [ ] As the joiner, try adding a shopping item. Confirm the "Jak masz na imię?" modal appears, submitting a name closes it, and the shopping item actually appears in the list afterward (not silently dropped).
- [ ] Reload the joiner's tab. Confirm the modal does **not** reappear on next write (profile-complete flag persisted).
- [ ] As the joiner, try `/join` again with the same (now-redeemed) code in a third window. Confirm it's rejected with the generic "Nieprawidłowy lub już wykorzystany kod zaproszenia." message, no account created.
- [ ] As the owner, tap "Nowy kod" again. Confirm the *old* code no longer works on `/join` (rejected the same way).
- [ ] On `/account`, confirm Aktywność shows entries for the shopping-item add from the joiner-write step above, with the joiner's name as actor.
- [ ] As the non-owner (joiner), open `/account`. Confirm no share code is ever visible, and tapping "Nowy kod" (if shown) produces the owner-only toast rather than a code.
- [ ] Tap "Wyloguj" on `/account`. Confirm it clears the session and redirects to `/login`, and the tab bar no longer has a logout control.

- [ ] **Step 4: Full lint + typecheck + build gate**

Run: `bun run lint && bunx tsc -p tsconfig.json && bun run build`
Expected: all three succeed with no errors (the build step also catches anything the dev server's HMR might have papered over).

- [ ] **Step 5: Commit if Step 3 uncovered any fixes**

If any checklist item required a code change, commit it with a message describing the specific gap found (not a generic "fix bugs" message) before considering the plan complete. If nothing needed fixing, this step is a no-op — the plan ends at Task 7's commit.
