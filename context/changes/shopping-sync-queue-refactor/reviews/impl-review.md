<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Refactor offline-queue sync so default path is immediate backend sync

- **Plan**: context/changes/shopping-sync-queue-refactor/plan.md
- **Scope**: Phase 1 of 3, Phase 2 of 3, Phase 3 of 3 (full plan) — Phase 1's backend file lives in the sibling `HomeCraftApi` repo, not present in this working directory; reviewed via plan/commit-sha evidence only, not direct file read. Phases 2–3 reviewed directly.
- **Date**: 2026-10-12
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — Empty-string cursor falls through to `undefined` by accident of double-falsy-checking

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/store.tsx:111, src/lib/api/client.ts (the `since ? ... : ...` URL builder)
- **Detail**: `readShoppingCursor() ?? undefined` only coalesces `null`; a stored empty-string cursor would pass through as `since = ""`, then `client.ts`'s truthiness check (`since ? ... : ...`) also treats `""` as falsy and omits the param anyway. Net behavior is correct today, but it's correct by two independent falsy-checks happening to agree, not by design — if either check is ever changed independently (e.g. a future `since !== undefined` check), this could silently diverge.
- **Fix**: Normalize `readShoppingCursor()`'s return type so it never returns `""` (or coalesce `""` alongside `null` at the `store.tsx:111` call site), for clarity rather than correctness.
- **Decision**: FIXED — `store.tsx:111` changed to `readShoppingCursor() || undefined`, coalescing both `null` and `""` in one check.

## Notes

- Phase 1 (backend, `HomeCraftApi` repo): plan specifies changing the `since` validation rule in `ShoppingItemController.php` to reject the epoch floor, plus a regression test. Commit `0d37544` (per plan Progress and change.md) is recorded as shipped; automated backend checks (`php artisan test`) and the live 422 manual check are marked `[x]` with SHAs `0d37544` / `cc1265f`. Not independently re-verified in this review since the file isn't in this repo — flagged as a scope limitation, not a finding.
- Phase 2 (frontend): both `src/lib/api/client.ts` (optional `since` param) and `src/lib/store.tsx` (`syncFromBackend`'s three-way since-computation, dead `EPOCH_SINCE` removal, stale comment replacement) are clean MATCHes against plan intent — verified by direct file read.
- Phase 3: manual-only, end-to-end verification against the live GH Pages deploy, confirmed by the user and recorded with SHA `2cb871c`.
- Automated checks re-run clean at review time: `npx tsc --noEmit` (exit 0), `npm run lint` (0 errors, 11 pre-existing warnings unrelated to this change).
