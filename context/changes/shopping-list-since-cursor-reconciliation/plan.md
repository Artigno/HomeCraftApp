# Shopping-List Since-Cursor Reconciliation Implementation Plan

## Overview

Replace the shopping-items 6h `local_marked_done_at` TTL workaround with
proper `since`-cursor reconciliation against the backend's new
`GET /shopping-items?since=<ISO8601>` contract, and verify the already-fixed
toggle PATCH body matches the backend's now-required `{ done: boolean }`
shape.

## Current State Analysis

- `syncFromBackend` (`src/lib/store.tsx:95-162`) does a single, bare
  `apiGet<ShoppingItem[] | null>("/shopping-items", null)` with no query
  params, as part of a `Promise.all` alongside tasks/recipes/purchases/tins.
  Because the legacy endpoint only ever returns `done=false` items, a
  checked-off item vanishes from every subsequent fetch unless the client
  compensates.
- The compensation is `local_marked_done_at` (`src/lib/api/types.ts:63-66`):
  stamped by `toggleShoppingItem` on toggle-to-done, stripped on
  toggle-to-not-done (`src/lib/store.tsx:287-293`), and read by a 6-hour TTL
  filter (`INPROGRESS_TTL_MS`, `src/lib/store.tsx:136-142`) that keeps a
  "zombie" done item visible past the fetch for up to 6h, then silently
  drops it.
- A second, independent block (`src/lib/store.tsx:148-151`) force-trusts a
  local `done:true` over a stale `done:false` fetch for any id the device
  already believes it toggled — covers the case where a `/toggle` PATCH is
  still queued when the GET lands.
- Sync triggers are event-driven only — mount (`store.tsx:173`), post-login
  (`store.tsx:182-183`), and return-to-app via `visibilitychange`/`focus`
  (`store.tsx:189-193`). No polling interval exists.
- `apiGet` (`src/lib/api/client.ts:169-185`) takes no query-string parameter
  today.
- `toggleShoppingItem` (`src/lib/store.tsx:272-297`) already sends
  `enqueue("PATCH", \`/shopping-items/${id}/toggle\`, { done: !current?.done })`
  — this matches the backend's new required-body contract as-is; this plan
  only needs to confirm it during Phase 2's manual verification, not change it.
- `readQueue()` (`src/lib/api/client.ts:31-38`) is already exported and is
  the source of truth for what's still in flight — any `PATCH
  /shopping-items/{id}/toggle` entry currently sitting in it means that
  item's `done` state hasn't reached the server yet.
- Per the backend contract: `since` **absent** keeps legacy behavior
  (`done=false` only). `since` **present** returns all rows with
  `updated_at > since`, including `done=true`, ordered by `updated_at`
  ascending. An unparsable `since` value → 422. This means a "full refresh
  that includes done items" is NOT the same as "omit since" — it requires
  passing a `since` value old enough to match everything (epoch).

## Desired End State

- `syncFromBackend` always passes a `since` value for the shopping-items
  fetch — a far-past epoch constant on mount/login (full resync, replaces
  the local array wholesale, naturally drops server-side deletes), and the
  stored cursor on visibility/focus (incremental, upserts the delta into the
  existing array without dropping unmentioned items).
- The cursor advances from the response's own `updated_at` values (server
  clock), stored under a dedicated `localStorage` key, never from
  `Date.now()` on the client.
- Any shopping item with a pending `/shopping-items/{id}/toggle` PATCH still
  sitting in the offline queue keeps its local `done` value through a sync,
  regardless of what the fetch returned, in either direction (done→not-done
  or not-done→done) — an improvement over today's one-directional
  `done:true`-only trust.
- A 422 on the `since` fetch (corrupted/invalid stored cursor) clears the
  stored cursor and retries once, within the same sync pass, as a full
  epoch-anchored fetch.
- `local_marked_done_at` and its 6h TTL logic no longer exist anywhere in
  the codebase.
- Verify: toggle an item done, let 6+ simulated hours pass (or just confirm
  the code path no longer references a TTL at all), reload — item state
  matches the backend, no zombie-retention logic involved.

### Key Discoveries:

- `src/lib/store.tsx:106-114` — today's `syncFromBackend` already aborts the
  **entire** sync (keeping all local state as-is) if *any* of the 5
  `apiGet` calls returns `null` (offline/401/etc). The since-aware shopping
  fetch must preserve this all-or-nothing abort semantics for the other 4
  resources — only the shopping-specific 422 case gets special handling.
- `src/lib/store.tsx:116-123` — the brand-new-account seed check
  (`backendHasData`) only ever runs on the very first `syncFromBackend` call,
  which is always the mount call (always full/epoch mode) — visibility/focus
  listeners are registered in the same effect but can't fire before mount's
  async call resolves in practice (they require a subsequent user tab-switch
  or focus event). No change needed to this check; it's a pre-existing
  invariant, not something this plan has to defend against.
- `src/lib/api/client.ts:19-25` — `QueuedRequest` already has `method` and
  `path` fields; matching on `method === "PATCH"` and
  `path === \`/shopping-items/${id}/toggle\`` is sufficient to detect a
  pending toggle, no new queue metadata needed.

## What We're NOT Doing

- Not touching the `sort_order` PATCH or the two-PATCHes-per-toggle ordering
  race (`toggle` + `sort_order` as separate queue entries) — pre-existing,
  separate from this change's goal. Noted as a follow-up below.
- Not rolling the `since` pattern out to `/purchases`, `/maintenance-tasks`,
  `/maintenance-logs`, or `/recipes` — explicitly out of scope per this
  change's `change.md`; those endpoints still do a full fetch every sync,
  unchanged.
- Not adding a periodic timer/polling — the existing full-resync-on-
  mount/login cadence is the delete-catching mechanism; no new scheduling
  infrastructure.
- Not changing `toggleShoppingItem`'s PATCH body — it already matches the
  backend's new contract (confirmed in Current State Analysis); this plan
  only verifies it manually.
- Not adding automated tests — no test runner/script exists anywhere in
  this repo (`package.json` has no `test` script); verification here is
  manual only, consistent with the rest of the codebase.

## Implementation Approach

Phase 1 adds the inert plumbing (type field, cursor storage, the new fetch
function) with nothing wired in yet — compiles and ships standalone. Phase 2
rewires `syncFromBackend` to use it, which is the actual behavior change and
where the TTL block gets replaced by the queue-aware merge. Phase 3 deletes
the now-fully-dead `local_marked_done_at` field and its remaining
references. Each phase is independently shippable; Phase 2 is the one that
actually fixes the behavior, so Phase 3 is pure cleanup with no functional
risk.

## Critical Implementation Details

**Since-absent vs. since-epoch are not interchangeable.** Omitting `since`
keeps the *legacy* `done=false`-only behavior per the backend contract — it
is NOT a valid way to do a "full fetch including done items." Every
shopping-items fetch this plan makes (mount/login full resync AND
visibility/focus incremental) must pass an explicit `since` value: a
far-past epoch constant for the full resync, the stored cursor for
incremental. There is no code path in this plan that omits `since` for
shopping-items.

**Cursor advancement only from server-supplied `updated_at`.** Compute the
new cursor as the maximum `updated_at` among the items actually returned in
a response (the backend orders by `updated_at` ascending, so the last
element's value is sufficient). Never derive it from `Date.now()` on the
client — that's the exact clock-skew risk this redesign exists to avoid. If
a response is empty (nothing changed since the stored cursor), leave the
stored cursor untouched rather than overwriting it with anything derived
locally.

**Queue-override applies after merge, uniformly for full and incremental.**
After producing the merged shopping array (full replace, or incremental
upsert), for every id with a `PATCH /shopping-items/{id}/toggle` entry still
in `readQueue()`, overwrite that item's `done` field with the value found in
the pre-sync local state (`s.shopping`) — not the fetched value — regardless
of which direction the toggle went. This replaces both the old
`INPROGRESS_TTL_MS` block and the old `reconciled` block; neither survives
into the new logic.

## Phase 1: Plumbing — type field, cursor storage, since-aware fetch

### Overview

Add the pieces the rewired sync will need, without wiring them into
`syncFromBackend` yet. Fully inert — the app's behavior is unchanged after
this phase.

### Changes Required:

#### 1. Add `updated_at` to `ShoppingItem`

**File**: `src/lib/api/types.ts`

**Intent**: The backend's `ShoppingItemResource` now exposes `updated_at`
(ISO8601) — the client type needs it to read the field and compute the
cursor.

**Contract**: Add `updated_at: string;` to the `ShoppingItem` interface
(`src/lib/api/types.ts:50-67`), alongside the existing `created_at: string`.
Leave `local_marked_done_at` in place for now — it's removed in Phase 3.

#### 2. Cursor storage helpers

**File**: `src/lib/api/client.ts`

**Intent**: Persist the shopping-items sync cursor the same way the
existing offline queue persists its state, so a page reload doesn't lose
the client's place.

**Contract**: Add a dedicated `localStorage` key (e.g.
`homesync.shopping-cursor`) plus `readShoppingCursor(): string | null` and
`writeShoppingCursor(cursor: string | null): void`, following the exact
`try { JSON.parse(...) } catch { return fallback }` idiom already used by
`readQueue`/`writeQueue` (`src/lib/api/client.ts:31-44`) — `writeShoppingCursor(null)`
removes the stored key (used by the 422-recovery path in Phase 2).

#### 3. Since-aware shopping-items fetch

**File**: `src/lib/api/client.ts`

**Intent**: A dedicated fetch function for `GET /shopping-items?since=...`
that, unlike the generic `apiGet`, distinguishes a 422 (invalid `since`)
from other failures — the caller needs that distinction to decide whether
to drop the cursor and retry.

**Contract**: New exported async function, e.g.
`apiGetShoppingItems(since: string): Promise<{ ok: true; items: ShoppingItem[] } | { ok: false; invalidSince: boolean } | null>`.
Mirrors `apiGet`'s existing auth/offline/401/pending-approval handling
(`src/lib/api/client.ts:169-185` and the `checkPending`/`handleUnauthorized`
helpers it already calls) — `null` return keeps the same meaning
`syncFromBackend` already relies on ("treat like today's offline/401 case,
abort the whole sync"). A 422 response resolves to
`{ ok: false, invalidSince: true }`; any other non-ok status resolves to
`{ ok: false, invalidSince: false }` (keep local state, let the next sync
trigger retry naturally — no special recovery needed since the cursor
wasn't the problem). `since` is appended as a URL-encoded query param.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npx tsc --noEmit`
- Lint passes: `npm run lint`

#### Manual Verification:

- None — this phase changes no runtime behavior; nothing new is called yet.

---

## Phase 2: Rewire `syncFromBackend` — epoch-anchored full resync + incremental merge

### Overview

Replace the TTL/reconciled merge block with queue-aware reconciliation
driven by the Phase 1 plumbing. Mount/login pass an epoch `since` (full
resync); visibility/focus pass the stored cursor (incremental).

### Changes Required:

#### 1. Mode-aware `syncFromBackend`

**File**: `src/lib/store.tsx`

**Intent**: `syncFromBackend` needs to know whether this call is a full
resync (mount/login) or an incremental one (return-to-app), so it can pick
the right `since` value and the right merge strategy.

**Contract**: Add an `{ incremental?: boolean }` options parameter to
`syncFromBackend` (`src/lib/store.tsx:95`), defaulting to full (no options =
full resync, matching today's mount/login call sites unchanged at
`store.tsx:173` and `store.tsx:182-183`). Update the `onReturnToApp` handler
(`store.tsx:189-193`) to call `syncFromBackend({ incremental: true })`.
Resolve the `since` value to pass `apiGetShoppingItems`: a module-level
epoch constant (e.g. `"1970-01-01T00:00:00Z"`) when not incremental, or
`readShoppingCursor() ?? <epoch constant>` when incremental (falls back to a
full resync if no cursor is stored yet — e.g. first-ever incremental call
on a device that's never completed a mount sync, which shouldn't happen in
practice but keeps the function total).

#### 2. Replace the shopping fetch call site

**File**: `src/lib/store.tsx`

**Intent**: Swap the bare `apiGet<ShoppingItem[] | null>("/shopping-items", null)`
call (`store.tsx:100`) for the new `apiGetShoppingItems(since)`, keeping it
inside the same `Promise.all` as the other 4 resources for concurrency.

**Contract**: The `Promise.all` destructure and the existing
all-or-`null`-abort check (`store.tsx:106-114`) need to handle
`apiGetShoppingItems`'s richer return shape for its one element — `null`
still means abort-everything (same as today); a resolved
`{ ok: false, invalidSince: true }` triggers the 422-recovery path (clear
the stored cursor, re-invoke `syncFromBackend({ incremental: false })` once,
and return — no further processing of the current pass); a resolved
`{ ok: false, invalidSince: false }` means "keep local state, let the next
natural sync trigger retry" (same early-return as today's null case, no
special recovery); `{ ok: true, items }` proceeds to the merge below using
`items` wherever the current code uses the plain `shopping` array.

#### 3. Replace the TTL/reconciled merge block with queue-aware merge

**File**: `src/lib/store.tsx`

**Intent**: Replace `INPROGRESS_TTL_MS`/`inProgress`/`localDoneIds`/`reconciled`
(`store.tsx:126-151`) with a merge that branches on full vs. incremental and
applies the queue-override described in Critical Implementation Details.

**Contract**: Full resync — replace `s.shopping` entirely with the fetched
`items` (same shape as today's final assignment, just without the
TTL/reconciled preprocessing). Incremental — upsert each item in `items`
into `s.shopping` by `id` (replace if present, append if new), leaving
every other existing entry untouched. In both branches, afterward, for
every id with a pending `/shopping-items/{id}/toggle` entry in
`readQueue()`, overwrite that merged item's `done` with the value from
`s.shopping` as it stood *before* this merge (the pre-sync local state).
After the `setState` call resolves, advance the stored cursor from the
response: compute the max `updated_at` across `items` (skip if `items` is
empty — leave the stored cursor untouched) and call
`writeShoppingCursor(...)`.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npx tsc --noEmit`
- Lint passes: `npm run lint`

#### Manual Verification:

- Toggle an item done; confirm it stays visible and checked immediately
  (optimistic update, unaffected by this change)
- Reload the page (triggers a full/mount resync): the just-toggled done
  item is still present and still shows done — confirms the epoch-anchored
  full fetch now includes done items without needing the old TTL window
- Switch away and back to the tab/app (triggers an incremental resync):
  behavior unchanged, no flicker or item loss
- Delete an item, then reload: item is gone (full resync drops it by
  absence, same as today)
- Toggle an item done, then immediately switch tabs away and back before
  the toggle's PATCH could plausibly have flushed (airplane mode or a slow
  network helps reproduce this reliably): the item stays done through the
  incremental sync instead of flickering back to not-done
- Confirm (via a quick read of the network tab or request log) that the
  toggle PATCH body is `{ "done": true/false }` matching the backend's
  required-body contract — this was already fixed in a prior change, this
  step just re-confirms it still holds after this phase's edits

---

## Phase 3: Remove the dead TTL workaround

### Overview

Delete `local_marked_done_at` and everything that referenced it — Phase 2
already stopped relying on it; this phase removes the now-dead code.

### Changes Required:

#### 1. Remove the field from the type

**File**: `src/lib/api/types.ts`

**Intent**: `local_marked_done_at` has no remaining readers after Phase 2.

**Contract**: Delete the `local_marked_done_at?: string;` field and its
doc comment (`src/lib/api/types.ts:63-66`) from `ShoppingItem`.

#### 2. Remove the set/strip logic in `toggleShoppingItem`

**File**: `src/lib/store.tsx`

**Intent**: The destructure-and-conditionally-set logic that stamped/stripped
`local_marked_done_at` on every toggle is now writing a field nothing reads.

**Contract**: In `toggleShoppingItem`'s `setState` updater
(`src/lib/store.tsx:284-293`), remove the
`const { local_marked_done_at: _drop, ...rest } = i;` destructure and the
`...(!i.done ? { local_marked_done_at: new Date().toISOString() } : {})`
spread — the returned object no longer needs to touch this field at all.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npx tsc --noEmit`
- Lint passes: `npm run lint`
- `grep -rn "local_marked_done_at" src/` returns no results

#### Manual Verification:

- Full regression pass on the shopping list: add, toggle, reorder (drag),
  delete, and complete-purchase flows all still work as before
- Ping `homecraftapi-30` (the backend session) to confirm this change has
  landed, so they can close their plan's final manual check

---

## Testing Strategy

### Unit Tests:

- None — no test runner exists in this repo; see "What We're NOT Doing."

### Manual Testing Steps:

1. Toggle an item done, reload the page, confirm it's still done (full
   resync now includes done items — no 6h window needed).
2. Toggle an item done, switch tabs away and back, confirm no flicker.
3. Toggle an item done while offline (or heavily throttled), switch tabs
   away and back before the queue flushes, confirm the done state holds
   through the incremental sync.
4. Delete an item, reload, confirm it's gone.
5. Drag-reorder items, reload, confirm order persists (unaffected by this
   change, but exercises the same `shopping` array).
6. Complete a purchase (the "Zakończ zakupy" flow), confirm it still works
   end-to-end (unaffected by this change, but shares the `shopping` array).
7. `grep -rn "local_marked_done_at" src/` after Phase 3 — zero results.

## Performance Considerations

Incremental fetches on visibility/focus should return few or zero rows in
the common case (nothing changed since the last sync), smaller than today's
always-full fetch. Full resyncs on mount/login are unchanged in payload size
from today's baseline (same data, just also including done items now
instead of filtering them server-side).

## Migration Notes

No backend/data migration — this is a client-only change against an
already-shipped, already-tested backend contract. The only "migration" is
the first incremental sync on an existing device never seeing a stored
cursor yet; handled by the epoch-constant fallback in Phase 2 (treated as a
full resync).

## References

- Research: `context/changes/shopping-list-since-cursor-reconciliation/research.md`
- Backend contract source: cross-session message from `homecraftapi-30`
  (HomeCraftApi repo, commit `d3f84cf`, change `shopping-list-done-state-bug`)
- Prior toggle-body fix (already landed): commit `4f784f5` in this repo
- Prior art for optimistic `setState` + `enqueue(...)`: `context/changes/shopping-list-ux-fixes/plan.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Plumbing — type field, cursor storage, since-aware fetch

#### Automated

- [x] 1.1 Typecheck passes — 1d16e6e
- [x] 1.2 Lint passes — 1d16e6e

### Phase 2: Rewire syncFromBackend — epoch-anchored full resync + incremental merge

#### Automated

- [x] 2.1 Typecheck passes
- [x] 2.2 Lint passes

#### Manual

- [ ] 2.3 Toggle done persists through a full (mount) resync, no TTL window needed
- [ ] 2.4 Toggle done persists through an incremental (visibility/focus) resync, no flicker
- [ ] 2.5 Delete still removes an item on reload (full resync drops by absence)
- [ ] 2.6 Toggle-while-offline-then-return-to-app holds done state through the incremental sync (queue-override)
- [ ] 2.7 Toggle PATCH body confirmed as `{ "done": boolean }`

### Phase 3: Remove the dead TTL workaround

#### Automated

- [ ] 3.1 Typecheck passes
- [ ] 3.2 Lint passes
- [ ] 3.3 `grep -rn "local_marked_done_at" src/` returns no results

#### Manual

- [ ] 3.4 Full regression pass: add/toggle/reorder/delete/complete-purchase all still work
- [ ] 3.5 Ping homecraftapi-30 to confirm landed, so they can close their plan's final manual check
