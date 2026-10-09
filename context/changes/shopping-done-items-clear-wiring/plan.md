# Shopping Done-Items Clear Wiring Implementation Plan

## Overview

Backend (HomeCraftApi) deployed two changes to prod: `GET /shopping-items`
(default, no `since`) now returns the full household list including
`done=true` rows, and a new `DELETE /shopping-items/done` bulk-clears all
`done=true` rows for the caller's household. The frontend's two "finish
shopping" actions — `discardCompletedShoppingItems()` and
`completePurchase()` — currently only mutate local state and never call the
backend to clear done items. Without this wiring, done items now pile up
permanently in every household member's "Zakończone" section instead of
disappearing after checkout/discard.

## Current State Analysis

- `src/lib/store.tsx:418-420` — `discardCompletedShoppingItems()`: local
  `setState` filter only (`shopping: s.shopping.filter((i) => !i.done)`),
  zero network calls. Functional `setState` updater — per
  `context/foundation/lessons.md`'s pure-setState-updater rule, any
  `enqueue()` call must be hoisted outside it, not placed inside.
- `src/lib/store.tsx:389-417` — `completePurchase()`: local `setState`
  filter + `enqueue("POST", "/receipts/process", purchase)` (hoisted outside
  the updater, correctly) + `await flushQueue()`.
- `src/lib/api/client.ts:106-121` — `enqueue(method, path, body?)`: pushes a
  `QueuedRequest` onto a durable localStorage-backed FIFO queue and kicks
  `flushQueue()`. `src/lib/api/client.ts:371-373` (`removeShoppingItem`) is
  the existing precedent for a bare DELETE: `enqueue("DELETE",
  "/shopping-items/${id}")` — no dedicated `api*` wrapper function needed for
  a parameterless DELETE.
- `src/lib/api/client.ts:130-168` — `flushQueue()`: processes the queue
  strictly in FIFO order, one request at a time. On 401 or 5xx it `break`s
  (stops, leaves the rest queued for retry); on other 4xx it dead-letters via
  `recordFailed()` and continues; no response body is parsed for DELETE-style
  calls — callers never await a per-call result, only the overall
  `flushQueue()` promise.
- `src/routes/shopping.tsx:264-274` — the only call site of
  `discardCompletedShoppingItems()`: a `DropdownMenuItem` already disabled
  via `disabled={!shopping.some((i) => i.done)}`, behind a
  `window.confirm()` guard.
- `src/components/ReceiptCheckoutModal.tsx:109-120,122-139` — the only two
  call sites of `completePurchase()`, both already `await` it before closing
  the modal.
- No test framework configured in this repo (`package.json` has no
  `vitest`/`jest`); verification is manual-only, consistent with
  `edit-modal-focus-fixes`.

## Desired End State

After `discardCompletedShoppingItems()` or `completePurchase()` runs with at
least one done item present, the backend's `done=true` rows for this
household are cleared (via `DELETE /shopping-items/done`), matching the
local state change already applied. Checking items off no longer causes them
to permanently accumulate in other household members' "Zakończone" section.
A `completePurchase()` call always clears done items only after its purchase
POST is queued ahead of it in the same FIFO queue, so a prior-step failure
(offline/5xx) that keeps the POST queued also keeps the DELETE queued behind
it — never clearing server-side state for a purchase that didn't record.

### Key Discoveries:

- `src/lib/store.tsx:418` — `discardCompletedShoppingItems` needs a guard:
  skip the `enqueue()` call entirely when there are no done items (avoids a
  no-op network call; the call site already disables its only UI trigger
  when `!shopping.some((i) => i.done)`, but the store method itself should
  not assume that invariant).
- `src/lib/store.tsx:389` — `completePurchase` already computes `bought =
  state.shopping.filter((i) => i.done)` before building the purchase — reuse
  its length (or re-check `state.shopping.some(i => i.done)`) rather than
  adding a second filter pass.
- `src/lib/api/client.ts:371-373` — exact pattern to copy:
  `enqueue("DELETE", "/shopping-items/${id}")`. For the bulk endpoint it's
  `enqueue("DELETE", "/shopping-items/done")` — no body, no new `api*`
  wrapper function.

## What We're NOT Doing

- Not adding a toast/error UI for a failed `DELETE /shopping-items/done` —
  stays silent-dead-letter, consistent with every other `enqueue("DELETE",
  ...)` call site in this codebase (user confirmed: recommended option).
- Not extending `syncFromBackend()`'s `pendingIds` regex-based
  queued-PATCH-override mechanism to cover `DELETE /shopping-items/done` —
  the narrow race window (a `visibilitychange`/focus-triggered incremental
  sync landing between the local filter and the queued DELETE actually
  flushing) is cosmetic and self-corrects on the next sync (user confirmed:
  recommended option).
- Not adding a dedicated `apiDeleteDoneShoppingItems()` wrapper in
  `client.ts` — the existing bare `enqueue("DELETE", path)` idiom already
  used by `removeShoppingItem` covers this; a dedicated synchronous wrapper
  was considered and rejected (loses offline-queueing for this call).
- Not adding automated/unit tests — no test framework exists in this repo;
  manual verification only.
- Not touching `GET /shopping-items` client-side handling
  (`apiGetShoppingItems`, `syncFromBackend`) — the backend's default-list
  behavior fix requires no frontend change (per the change's Notes: "No
  param change needed on the frontend").

## Implementation Approach

Single-file change in `src/lib/store.tsx`: add one guarded, hoisted
`enqueue("DELETE", "/shopping-items/done")` call to each of
`discardCompletedShoppingItems()` and `completePurchase()`, following the
exact `enqueue("DELETE", ...)` idiom already in use for
`removeShoppingItem()`. In `completePurchase()`, the new `enqueue()` call is
placed immediately after the existing `enqueue("POST", "/receipts/process",
purchase)` line and before `await flushQueue()`, so both requests share the
same FIFO queue-processing guarantee already provided by `flushQueue()`.

## Phase 1: Wire DELETE /shopping-items/done into both finish-shopping actions

### Overview

Add the bulk-clear network call to `discardCompletedShoppingItems()` and
`completePurchase()` in `src/lib/store.tsx`, so checked-off items are
actually cleared server-side whenever they're cleared locally.

### Changes Required:

#### 1. `discardCompletedShoppingItems()` — hoisted guarded enqueue

**File**: `src/lib/store.tsx`

**Intent**: Clear done items server-side whenever this action clears them
locally, but skip the network call entirely when there's nothing to clear.

**Contract**: Before the existing `setState` call, compute whether any item
is done (reuse `state.shopping.some((i) => i.done)`); if true, call
`enqueue("DELETE", "/shopping-items/done")` — hoisted outside the `setState`
updater, matching the pure-setState-updater rule in
`context/foundation/lessons.md`. The existing `setState` filter logic is
unchanged.

#### 2. `completePurchase()` — enqueue DELETE after the POST

**File**: `src/lib/store.tsx`

**Intent**: Clear done items server-side as part of the same purchase-finish
flow, ordered so the clear only actually reaches the backend once the
purchase POST has had its turn in the same queue.

**Contract**: Immediately after the existing `enqueue("POST",
"/receipts/process", purchase)` call (and before `await flushQueue()`), add
`enqueue("DELETE", "/shopping-items/done")`. No guard needed here —
`completePurchase()` is only ever invoked from the checkout modal after
`bought.length > 0` already held when the modal was opened.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npx tsc --noEmit`
- Lint passes: `npm run lint`

#### Manual Verification:

- Check off 1+ shopping items, use "Wyczyść zaznaczone bez zapisu do
  budżetu" (discard path) → items disappear locally and stay gone after a
  manual page reload (confirms the backend actually cleared them, not just
  local state).
- Check off 1+ shopping items, go through "Zakończ zakupy" (purchase path,
  either manual form or receipt-scan review) → items disappear locally and
  stay gone after a manual page reload.
- With no items checked off, confirm the "Wyczyść zaznaczone..." menu item
  is still disabled (pre-existing UI guard) — not a behavior change, sanity
  check only.
- On a second device/browser logged into the same household, confirm
  cleared items don't reappear after that device's next sync.

**Implementation Note**: After completing this phase and automated
verification passes, pause here for manual confirmation from the human that
the manual testing was successful.

---

## Testing Strategy

### Unit Tests:

- None added — no test framework in this repo; manual verification only.

### Integration Tests:

- None added.

### Manual Testing Steps:

1. Add a few shopping items, check 2-3 off, use "Wyczyść zaznaczone bez
   zapisu do budżetu", confirm the dialog, reload the page — checked items
   must not come back.
2. Add a few shopping items, check 2-3 off, "Zakończ zakupy" → fill the
   manual form → submit, reload the page — checked items must not come
   back, purchase must still appear in history.
3. Repeat step 2 via the receipt-scan → review path if a test receipt image
   is available.
4. On a second device/session in the same household, confirm neither path's
   cleared items resurface.

## Performance Considerations

None — one additional queued DELETE request per finish-shopping action, same
cost class as the existing per-item DELETE already in the codebase.

## Migration Notes

None — no data model or local-storage schema changes.

## References

- Ticket: `context/changes/shopping-done-items-clear-wiring/change.md`
- Backend precedent for bare `enqueue("DELETE", ...)`:
  `src/lib/store.tsx:371-373` (`removeShoppingItem`)
- Pure-setState-updater rule: `context/foundation/lessons.md`

> **Adaptation (manual testing, 2026-10-09)**: The plan's original approach
> — `enqueue("DELETE", "/shopping-items/done")`, the bulk endpoint — caused a
> real data-loss bug confirmed in manual testing: a freshly-toggled-done item
> disappeared after a hard refresh. Root cause: `enqueue()` is a durable,
> possibly-delayed offline queue (compounded by a separate, pre-existing sync
> bug where sync only reliably runs after a hard refresh); a bulk "clear
> whatever's done" request replayed late also deletes any item marked done
> *after* it was queued but *before* it actually flushes — including items
> toggled by this device or another household member in between. Fixed by
> switching both call sites to per-id `enqueue("DELETE",
> "/shopping-items/${id}")` (the existing `removeShoppingItem` idiom) for
> each item that was done at the moment of the call — a delayed replay then
> only ever removes that specific item, never anything marked done later.
> The separate sync-only-after-hard-refresh bug is out of scope for this
> change (pre-existing, not introduced by this wiring).

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a
> step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Wire DELETE /shopping-items/done into both finish-shopping actions

#### Automated

- [x] 1.1 Typecheck passes: `npx tsc --noEmit`
- [x] 1.2 Lint passes: `npm run lint`

#### Manual

- [ ] 1.3 Discard path ("Wyczyść zaznaczone bez zapisu do budżetu") clears
      items server-side (survive reload)
- [ ] 1.4 Purchase path ("Zakończ zakupy", manual form) clears items
      server-side (survive reload)
- [ ] 1.5 Purchase path via receipt-scan review clears items server-side
      (survive reload)
- [ ] 1.6 Second device/session in same household doesn't see cleared items
      resurface
