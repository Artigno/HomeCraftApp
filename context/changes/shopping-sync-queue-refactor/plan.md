# Shopping Items Vanish-on-Resync (Epoch Sentinel Bug) Implementation Plan

## Overview

Fix the bug where shopping items (toggled or not) disappear from the client
after a hard refresh / full resync. Root cause: the frontend's full-resync
path sends `since=1970-01-01T00:00:00Z` as a sentinel meaning "fetch
everything," but MySQL's `TIMESTAMP` column type cannot represent a value
below `1970-01-01 00:00:01` UTC. Under strict mode, the backend's
`updated_at > $since` comparison against that unrepresentable value matches
zero rows instead of "everything," so every full resync silently replaces
local `shopping` state with an empty list. Fix both sides: backend gets a
defensive validation that turns a silent wrong-answer into a visible error,
frontend stops sending a `since` value that was never needed for a full
resync in the first place.

## Current State Analysis

- `ShoppingItemController::index()` (HomeCraftApi,
  `app/Http/Controllers/ShoppingItemController.php:22-37`) has two branches:
  `since` present → `where('updated_at', '>', $since)`; `since` absent →
  unfiltered, ordered by `sort_order`. The unfiltered branch already
  includes done items (confirmed by
  `test_index_without_since_param_returns_full_household_list`,
  `tests/Feature/ShoppingItemTest.php:186-197`) — the done-item exclusion
  that branch used to have was removed in commit `01ebf97` (git history:
  `1188735` added the filter, `01ebf97` removed it).
- `shopping_items.updated_at` is a `TIMESTAMP` column (migration
  `2026_09_25_131535_create_shopping_items_table.php:20`), and
  `config/database.php` runs MySQL in `strict` mode. MySQL's `TIMESTAMP`
  type's valid range starts at `1970-01-01 00:00:01` UTC — the frontend's
  `EPOCH_SINCE = "1970-01-01T00:00:00Z"` (HomeCraftApp,
  `src/lib/store.tsx:40`) is one second below that floor.
- Live reproduction: `GET /shopping-items?since=1970-01-01T00:00:00Z`
  against the deployed API returns `[]` for a household with existing
  rows — confirming the comparison silently matches nothing rather than
  erroring or matching everything.
- `syncFromBackend` (`src/lib/store.tsx:110-231`) always sends a `since`:
  `EPOCH_SINCE` for a full resync, or `readShoppingCursor() ?? EPOCH_SINCE`
  for an incremental resync (i.e. the epoch sentinel is also the fallback
  when no cursor is stored yet). A full resync's `setState` wholesale-
  replaces `shopping` with the fetched list (plus queue-override/unflushed-
  create carryovers) — see `:189-209` — so an empty fetch wipes every
  already-synced item, done or not.
- `src/lib/store.tsx:36-39` carries a comment claiming "since-absent...
  keeps the legacy done=false-only filter server-side" — this was true
  when the comment was written but is now **stale**: that filter was
  removed from the backend in `01ebf97`. The comment is actively
  misleading about current backend behavior and needs to go.
- `apiGetShoppingItems(since: string)` (HomeCraftApp,
  `src/lib/api/client.ts:213-233`) always builds the query with a `since`
  param; there's no way today to call the unfiltered backend branch from
  the frontend.
- The existing `invalidSince`/retry mechanism
  (`src/lib/store.tsx:134-146`) assumes a 422 only ever comes from a
  corrupted *stored cursor*, and retries by calling `syncFromBackend({
  incremental: false, retriedAfterInvalidSince: true })` — which today
  still sends `EPOCH_SINCE` for that retry. If the backend starts
  rejecting the epoch sentinel with 422 (Phase 1) without the frontend
  change (Phase 2), this retry would hit 422 again, hit the
  `retriedAfterInvalidSince` guard, and give up silently — so Phase 1 and
  Phase 2 must ship together, not independently, backend-first (per
  deploy sequencing decided below) immediately followed by frontend.

## Desired End State

A full resync omits `since` entirely and always returns every household
shopping item (done or not), matching what `test_index_without_since_param_returns_full_household_list`
already verifies server-side. A stored-cursor-missing incremental sync
falls back to a full resync instead of the epoch sentinel. The backend
additionally rejects any `since` value below what its `TIMESTAMP` column
can represent with a 422, rather than silently matching zero rows — so if
any other caller (old cached frontend bundle, future code) sends a bad
`since`, it fails loudly instead of wiping data.

**Verification**: repeat the live `GET
/shopping-items?since=1970-01-01T00:00:00Z` request against the deployed
backend post-fix and confirm it now returns 422 (not `[]`); manually
reproduce the original toggle → hard-refresh sequence and confirm the
toggled item is still present after refresh.

### Key Discoveries:

- `ShoppingItemController.php:22-37` — confirmed, by direct read, no
  done-item filter on either branch today.
- `ShoppingItemTest.php:186-197` — existing test already proves the
  since-absent branch is safe to route a full resync through.
- Migration `:20` + `config/database.php:60,80` — confirms the `TIMESTAMP`
  + strict-mode combination that produces the silent-zero-rows behavior.
- `store.tsx:134-146` — retry-after-invalid-since logic constrains phase
  ordering (see Current State Analysis above).

## What We're NOT Doing

- Not touching the incremental-sync cursor's strict `>` comparison
  (same-second-write exclusion) — frame-identified secondary candidate,
  logged in Open Risks below, not implemented here.
- Not decoupling the toggle's two PATCHes (`/toggle` then plain
  `sort_order` PATCH) to fix FIFO head-of-line blocking — frame-identified
  secondary candidate that doesn't match the reported symptom (local
  optimistic state isn't rolled back on a failed queued PATCH), logged in
  Open Risks below, not implemented here.
- Not refactoring the offline-queue architecture itself (the originally-
  assumed cause) — the frame brief ruled this out; the queue's
  merge/override logic is deliberately engineered and not implicated.
- Not changing how `sort_order` vs `updated_at` ordering is chosen between
  the two `index()` branches — out of scope, pre-existing behavior.

## Implementation Approach

Backend change first (Phase 1): add a validation rule to `index()`'s
`since` query param that rejects anything before MySQL's `TIMESTAMP`
floor, returning the same 422 shape the frontend's `invalidSince` handling
already expects. Add a regression test using the literal sentinel value
that reproduced this live. Frontend change second (Phase 2, deployed
immediately after): stop sending `since` for a full resync by making the
param optional in `apiGetShoppingItems` and omitting it from the query
string when absent; change the incremental-with-no-cursor case to trigger
a full (since-omitted) resync instead of falling back to the epoch
sentinel; remove `EPOCH_SINCE` and the stale comment. Phase 3 is the
manual verification pass against the deployed, fixed backend+frontend.

## Phase 1: Backend defensive validation (HomeCraftApi)

### Overview

Reject a `since` value the `TIMESTAMP` column can't represent, instead of
silently matching zero rows.

### Changes Required:

#### 1. Reject unrepresentable `since` values in `index()`

**File**: `app/Http/Controllers/ShoppingItemController.php`

**Intent**: Extend the existing `since` validation so a date before
MySQL's `TIMESTAMP` floor fails validation (422) instead of silently
producing an empty result set.

**Contract**: Change the `since` validation rule from `['sometimes',
'date']` to `['sometimes', 'date', 'after_or_equal:1970-01-01 00:00:01']`
(the exact floor MySQL's `TIMESTAMP` type can represent). Laravel's
`after_or_equal` date rule parses both sides with Carbon, so the existing
ISO-8601 `since` values (e.g. `2026-...Z`) continue to validate normally;
only something at-or-below the epoch boundary now fails. No change to the
query logic itself (`where('updated_at', '>', $since)` stays as-is — the
`>=` same-second-exclusion question is explicitly out of scope, see What
We're NOT Doing).

#### 2. Regression test for the exact live-reproduced bug

**File**: `tests/Feature/ShoppingItemTest.php`

**Intent**: Lock in the fix with a test using the literal value that
produced the live empty-array repro, so this specific boundary bug can't
silently regress.

**Contract**: Add a test asserting `GET
/shopping-items?since=1970-01-01T00:00:00Z` (and, for completeness,
`1970-01-01T00:00:01Z` succeeding) against a household with existing
items returns `422` with a validation error on `since`, following the
existing `test_invalid_since_param_returns_422` pattern
(`ShoppingItemTest.php:258-265`).

### Success Criteria:

#### Automated Verification:

- Backend test suite passes: `php artisan test` (or project's configured
  test runner) in `HomeCraftApi`
- New regression test passes and fails on the pre-fix code (verify by
  temporarily reverting the validation rule change and re-running)

#### Manual Verification:

- Live `GET /shopping-items?since=1970-01-01T00:00:00Z` against the
  deployed (post-fix) backend now returns 422, not `[]`

**Implementation Note**: After completing this phase and all automated
verification passes, pause here for manual confirmation from the human
that the manual testing was successful before proceeding to the next
phase.

---

## Phase 2: Frontend full-resync fix (HomeCraftApp)

### Overview

Stop sending a `since` value for full resyncs; route the incremental-with-
no-cursor case through the same since-omitted path; remove the stale
comment and now-dead sentinel constant.

### Changes Required:

#### 1. Make `since` optional in the shopping-items fetch

**File**: `src/lib/api/client.ts`

**Intent**: Allow `apiGetShoppingItems` to be called without a `since`
value, omitting the query param entirely so the request hits the
backend's unfiltered branch.

**Contract**: Change `apiGetShoppingItems(since: string)` to
`apiGetShoppingItems(since?: string)`; build the URL as
`${API_BASE}/shopping-items` when `since` is absent, and
`${API_BASE}/shopping-items?since=${encodeURIComponent(since)}` when
present. Return type and status handling (401 / `checkPending` / 422 /
other-non-ok / success) are unchanged.

#### 2. Stop sending the epoch sentinel from `syncFromBackend`

**File**: `src/lib/store.tsx`

**Intent**: A full resync should fetch everything by omitting `since`,
not by sending a sentinel date; an incremental resync with no stored
cursor should fall back to a full resync, not to the sentinel.

**Contract**: Replace the `since = incremental ? (readShoppingCursor() ??
EPOCH_SINCE) : EPOCH_SINCE` computation (`store.tsx:114`) with logic that:
(a) for a non-incremental call, passes `undefined` to
`apiGetShoppingItems`; (b) for an incremental call with a stored cursor,
passes that cursor as before; (c) for an incremental call with no stored
cursor, also passes `undefined` (equivalent to falling back to a full
resync) rather than the old epoch fallback. The `invalidSince`/retry
branch (`:134-146`) keeps its existing shape — a retried call now also
passes `undefined`, which can no longer 422 (no `since` sent), so the
`retriedAfterInvalidSince` guard remains a safety net rather than an
active code path for this specific case.

#### 3. Remove the stale comment and dead constant

**File**: `src/lib/store.tsx`

**Intent**: Delete the comment block at `:36-39` (`// since-absent and
since-epoch are NOT interchangeable...`) — it describes backend behavior
(a done=false-only filter on the since-absent branch) that was removed in
backend commit `01ebf97` and is no longer true. Remove the `EPOCH_SINCE`
constant (`:40`) once nothing references it after change #2 above.

**Contract**: No replacement comment is needed — the new behavior (full
resync omits `since`) is self-explanatory from the code; if a note is
useful, it should state only that a full resync intentionally omits
`since` to hit the backend's unfiltered branch, without re-deriving
claims about backend internals that can drift again.

### Success Criteria:

#### Automated Verification:

- Frontend test/typecheck suite passes: `npm run typecheck` /
  project's configured test runner in `HomeCraftApp`
- Lint passes: `npm run lint`

#### Manual Verification:

- Hard-refresh the app after toggling a shopping item; item remains
  present and correctly marked done
- Fresh toggle (unrelated to discard/complete-purchase) survives a hard
  refresh
- A second device/tab sees items added/toggled by the first after a
  resync

**Implementation Note**: After completing this phase and all automated
verification passes, pause here for manual confirmation from the human
that the manual testing was successful before proceeding to the next
phase.

---

## Phase 3: End-to-end manual verification

### Overview

Confirm the original reported symptom is gone against the real deployed
stack, backend fix live first, frontend fix live second (per decided
deploy order).

### Changes Required:

No code changes — verification only.

### Success Criteria:

#### Automated Verification:

- N/A (verification-only phase)

#### Manual Verification:

- Deploy Phase 1 (backend) alone; confirm live `GET
  /shopping-items?since=1970-01-01T00:00:00Z` now returns 422
- Deploy Phase 2 (frontend) immediately after; confirm a fresh hard
  refresh fetches the full household shopping list with no `since` param
  in the network request
- Repeat the original user-reported repro (toggle an item, hard refresh)
  and confirm the item is still present and correctly marked done
- Spot-check an unrelated toggle (not tied to discard/complete-purchase)
  survives a hard refresh, confirming the fix isn't scoped only to the
  two previously-patched call sites

---

## Testing Strategy

### Unit Tests:

- Backend: `since` validation rejects the exact epoch sentinel and
  anything else below `1970-01-01 00:00:01`, while still accepting normal
  ISO-8601 values (Phase 1, item 2)

### Integration Tests:

- Backend: existing `test_index_without_since_param_returns_full_household_list`
  already covers the since-absent branch end-to-end; no new integration
  test needed there since Phase 2 routes the frontend through this
  already-tested path

### Manual Testing Steps:

1. Toggle a shopping item, hard-refresh, confirm it's still present and
   correctly marked done
2. Repeat for a freshly-added (never-toggled) item to confirm the fix
   isn't toggle-specific
3. Hit the live `since=1970-01-01T00:00:00Z` endpoint directly and
   confirm 422 post-backend-deploy

## Performance Considerations

None — this is a correctness fix; no added query cost (the unfiltered
branch already existed and is already used whenever `since` is naturally
absent, e.g. via direct API calls).

## Migration Notes

No data migration needed — no data was actually lost server-side (frame's
narrowing signal: backend DB already had `done: true` persisted
correctly). This is purely a client-visibility fix; once deployed,
affected users see their existing correct data on next resync with no
backfill required.

## References

- Frame brief: `context/changes/shopping-sync-queue-refactor/frame.md`
- Related changes: `context/changes/shopping-duplicate-stale-sync/`,
  `context/changes/shopping-list-since-cursor-reconciliation/`
- `context/foundation/lessons.md` (pure-setState-updater lesson, same
  subsystem — not directly implicated here but worth re-checking during
  Phase 2 implementation since `syncFromBackend`'s `setState` call is in
  the same file)

## Open Risks & Assumptions

- **Cursor same-second exclusion** (frame candidate 3): the incremental
  path's `where('updated_at', '>', $since)` can permanently exclude a
  same-second write from future incremental (focus/visibility-triggered)
  syncs. Not fixed here (deferred per user decision); if a user reports a
  narrower "item doesn't show up until I hard-refresh, but hard-refresh
  works" symptom post-deploy, this is the next thing to investigate.
- **FIFO head-of-line blocking** (frame candidate 4): a failed `/toggle`
  PATCH can indefinitely delay a trailing `sort_order` PATCH behind it in
  the queue. Not fixed here (deferred per user decision); frame rated
  this as not matching the reported vanish symptom (local optimistic
  state isn't rolled back), so it's a latency/staleness risk, not a data-
  loss risk.
- **Assumption**: no other caller of `GET /shopping-items` (mobile client,
  internal script, etc.) depends on the current silent-empty-result
  behavior for an out-of-range `since`. If one exists, Phase 1's 422 would
  be a breaking change for it. Not verified beyond this codebase; flagged
  here rather than blocking the plan since the frame's confidence in the
  fix is HIGH and no such caller is known.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when
> a step lands. Do not rename step titles. See
> `references/progress-format.md`.

### Phase 1: Backend defensive validation (HomeCraftApi)

#### Automated

- [x] 1.1 Backend test suite passes: `php artisan test` — 0d37544
- [x] 1.2 New regression test passes and fails on pre-fix code — 0d37544

#### Manual

- [x] 1.3 Live `GET /shopping-items?since=1970-01-01T00:00:00Z` against
      deployed post-fix backend returns 422

### Phase 2: Frontend full-resync fix (HomeCraftApp)

#### Automated

- [x] 2.1 Frontend typecheck/test suite passes: `npm run typecheck` — 8075d3e
- [x] 2.2 Lint passes: `npm run lint` — 8075d3e

#### Manual

- [x] 2.3 Hard-refresh after toggling a shopping item; item remains
      present and correctly marked done — 8075d3e
- [x] 2.4 Fresh toggle unrelated to discard/complete-purchase survives a
      hard refresh — 8075d3e
- [x] 2.5 Second device/tab sees items added/toggled by the first after a
      resync — 8075d3e

### Phase 3: End-to-end manual verification

#### Manual

- [ ] 3.1 Deploy Phase 1 alone; confirm live epoch-sentinel request
      returns 422
- [ ] 3.2 Deploy Phase 2 immediately after; confirm full resync omits
      `since` in the network request
- [ ] 3.3 Repeat original user-reported repro (toggle, hard refresh);
      item still present and correctly marked done
- [ ] 3.4 Spot-check an unrelated toggle survives a hard refresh
