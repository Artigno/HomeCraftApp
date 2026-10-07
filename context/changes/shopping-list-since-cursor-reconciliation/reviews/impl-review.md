<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Shopping-List Since-Cursor Reconciliation

- **Plan**: context/changes/shopping-list-since-cursor-reconciliation/plan.md
- **Scope**: Phase 1-3 of 3 (full plan)
- **Date**: 2026-10-07
- **Verdict**: NEEDS ATTENTION
- **Findings**: 1 critical, 2 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | FAIL |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Findings

### F1 — Unbounded recursion on repeated 422 from epoch `since`

- **Severity**: CRITICAL
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/store.tsx:133-142
- **Detail**: On `invalidSince`, `syncFromBackend` clears the cursor and calls `await syncFromBackend({ incremental: false })`. That recursive call hits the exact same `invalidSince` check with no retry counter or one-shot flag. If the backend ever 422s the epoch constant itself (regression, locale bug), this recurses without bound — not the "retry once" the comment implies.
- **Fix**: Pass a one-shot flag (e.g. `{ incremental: false, retriedAfterInvalidSince: true }`) and skip the recursive call (fall through to "keep local state") when it's already set.
- **Decision**: FIXED — added `retriedAfterInvalidSince` opt, guarded the recursive call with `!opts?.retriedAfterInvalidSince`.

### F2 — Queue-override protects `done` but not the companion `sort_order` PATCH

- **Severity**: WARNING
- **Impact**: MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/store.tsx:160-173 (merge) vs. 313-331 (`toggleShoppingItem`)
- **Detail**: `toggleShoppingItem` enqueues two PATCHes per toggle — `.../toggle` and a second `PATCH /shopping-items/{id}` carrying the new `sort_order`. The merge's `pendingToggleIds` regex only matches the `.../toggle` path, so a sync landing between the two queued requests flushing can overwrite the optimistic `sort_order` with the stale server value — the just-toggled item visibly jumps back until the second PATCH flushes. Self-healing, but it's the same race class the `done` override exists to close, left half-fixed.
- **Fix A ⭐ Recommended**: Extend the pending-id detection to also match plain `PATCH /shopping-items/{id}` entries, and when present, also preserve `sort_order` from pre-sync local state alongside `done`.
  - Strength: Symmetric fix — same mechanism already built for `done`, no new concept.
  - Tradeoff: Slightly broader override — any in-flight `PATCH /shopping-items/{id}` (not just toggle-triggered ones) preserves local `sort_order`, which is correct here since the only caller of that path is the toggle reorder.
  - Confidence: HIGH — the two queued requests always originate from the same `toggleShoppingItem` call.
  - Blind spot: None significant.
- **Fix B**: Leave as-is, document as a known transient visual flicker (self-heals once the queue flushes).
  - Strength: Zero code change.
  - Tradeoff: Visible flicker remains in the toggle-while-syncing window the queue-override was built to close.
  - Confidence: MEDIUM — low-frequency race, but defeats the purpose of F2's sibling fix.
  - Blind spot: Actual frequency in production unmeasured.
- **Decision**: FIXED via Fix A — pending-id regex now matches both `.../toggle` and plain `/shopping-items/{id}`; override preserves `sort_order` alongside `done`.

### F3 — Full/epoch resync wholesale-replaces local state, dropping unflushed local creates

- **Severity**: WARNING
- **Impact**: MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/store.tsx:175-181
- **Detail**: Incremental sync upserts fetched items into local state by id (preserves anything not mentioned, including locally-created items whose `POST /shopping-items/batch` hasn't flushed). Full/epoch resync instead does `shopping.map(applyQueueOverride)` — a raw replace. Full resync runs on every mount/login; a user who adds an item and then backgrounds/foregrounds the PWA (or re-auths) before the batch-create flushes can see that item transiently disappear.
- **Fix**: Apply the same id-preserving merge on the full-resync path (seed the Map from `s.shopping`, upsert fetched items, keep any local id absent from the response if it has a pending create in the queue) instead of a raw replace.
- **Decision**: FIXED — full-resync path now carries forward local items covered by a pending `POST /shopping-items/batch` and absent from the fetched set.

### F4 — No tombstone handling on incremental sync (accepted MVP tradeoff, undocumented)

- **Severity**: OBSERVATION
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: src/lib/store.tsx:175-180
- **Detail**: Incremental sync only upserts ids present in the `since` response — a backend-side delete (this device's own late-flushing `removeShoppingItem`, or another household member's delete) isn't purged locally until the next full/mount resync. Likely an accepted tradeoff of a since-cursor scheme without deletion markers (consistent with the plan's "delete-catching happens via full resync" framing), but it's not called out in a code comment.
- **Fix**: Add a one-line comment at the incremental merge noting deletes are only caught by the next full resync.
- **Decision**: FIXED — comment added above the incremental upsert branch.

### F5 — `apiGetShoppingItems`/`apiGet` have no request timeout, unlike every mutation helper in the file

- **Severity**: OBSERVATION
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/api/client.ts:212-231 (new function, matches its sibling `apiGet` at :170-186 — not a new deviation, but `syncFromBackend` now fans this out across 5 concurrent GETs)
- **Detail**: Every synchronous POST/PATCH/DELETE helper in client.ts uses `signal: AbortSignal.timeout(10_000)`; both GET-for-sync helpers rely on browser/OS defaults. One hanging connection among the 5 concurrent `Promise.all` GETs (including the 422-retry path) can stall the whole sync indefinitely. Pre-existing on `apiGet`, not introduced by this diff, but worth fixing while this code is being touched.
- **Fix**: Add `signal: AbortSignal.timeout(10_000)` to both `apiGet` and `apiGetShoppingItems`.
- **Decision**: FIXED — timeout added to both.

### F6 — 422-retry path double-fetches the other 4 endpoints

- **Severity**: OBSERVATION
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/store.tsx:150
- **Detail**: On the 422 retry, the already-awaited `tasks`/`recipes`/`purchases`/`tins` results from the outer call are discarded and re-fetched by the recursive call — minor wasted round-trips, and compounds if F1's unbounded-recursion scenario ever triggers.
- **Fix**: Low priority; resolves naturally once F1's one-shot guard is in place (bounds the waste to at most one extra round-trip).
- **Decision**: SKIPPED — bounded to one extra round-trip after F1's fix; not worth the refactor.
