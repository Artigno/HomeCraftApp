<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Finish HomeSync — Shopping List & Analytics

- **Plan**: context/changes/finish-homesync-shopping-analytics/plan.md
- **Scope**: Phase 1 of 5 through Phase 5 of 5 (full plan)
- **Date**: 2026-09-25
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 3 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Findings

### F1 — Queue silently drops mutations on 4xx response

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/api/client.ts:76
- **Detail**: `flushQueue()` only halts retrying on 5xx (`if (!res.ok && res.status >= 500) break;`). Any 4xx (validation error, 404, stale id) falls through to `queue = readQueue().slice(1)` and the queued mutation is discarded silently — no user-facing signal, no dead-letter record. Pre-existing behavior (this plan's phases call `enqueue()` but didn't touch `flushQueue`'s retry logic), surfaced because Phase 3's `completePurchase()` now routes a genuinely important mutation (the receipt) through this same path.
- **Fix**: On 4xx, capture the failed request (e.g. append to a `failed` list) instead of silently dropping it, so a rejected receipt sync isn't just lost.
  - Strength: Closes a real data-loss gap now that receipts flow through this path.
  - Tradeoff: Needs a UI surface for the failed list — bigger than a one-line fix, and out of this plan's declared scope (no backend endpoint exists yet, so 4xx won't happen in practice today).
  - Confidence: MED — real risk once a backend exists; inert until then.
  - Blind spot: No backend is live yet, so this can't be exercised or verified today.
- **Decision**: FIXED — added `readFailedQueue()`/dead-letter capture on 4xx in `src/lib/api/client.ts`

### F2 — Unclosed `setTimeout` in receipt checkout modal

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/ReceiptCheckoutModal.tsx:41
- **Detail**: `startProcessing()` calls `setTimeout(() => setStep("form"), 1200)` and never clears it. If the route unmounts (nav away) while `step === "processing"`, the timeout still fires and calls `setState` on an unmounted component.
- **Fix**: Store the timeout id in a ref; clear it in a `useEffect` cleanup and on `onOpenChange(false)`.
- **Decision**: FIXED — `processingTimeout` ref + cleanup effects in `ReceiptCheckoutModal.tsx`

### F3 — Swipe hook doesn't capture the pointer

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/hooks/use-swipe-to-delete.ts:25-33
- **Detail**: `onPointerDown` never calls `setPointerCapture`. A fast swipe that exits the row's hit-box stops receiving `pointermove`/`pointerup` (browser re-targets by hit-test), leaving `dragging.current` stuck `true` and the row visually frozen mid-swipe.
- **Fix**: Call `e.currentTarget.setPointerCapture(e.pointerId)` in the pointerdown handler and release it in `endDrag`.
- **Decision**: FIXED — pointer capture/release added in `use-swipe-to-delete.ts`

### F4 — No timeout on offline-queue fetch calls

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/api/client.ts:62-86
- **Detail**: `fetch` in `flushQueue` has no `AbortController`/timeout. A hung request keeps the module-level `flushing` flag `true` indefinitely, stalling later flush attempts. Pre-existing, unrelated to this plan's phases.
- **Fix**: Wrap the fetch call with an abort timeout.
- **Decision**: FIXED — `signal: AbortSignal.timeout(10_000)` added to the flushQueue fetch call

### F5 — ReceiptCheckoutModal's Dialog omits a description

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/ReceiptCheckoutModal.tsx (DialogHeader)
- **Detail**: Unlike `cookbook.$recipeId.tsx`'s Dialog (`DialogTitle` + `DialogDescription`), this modal's `DialogHeader` has only `DialogTitle` — Radix will emit an a11y console warning for the missing `aria-describedby`.
- **Fix**: Add a short `DialogDescription` to match the sibling pattern.
- **Decision**: FIXED — `DialogDescription` added to `ReceiptCheckoutModal.tsx`

## Notes (non-findings, verified clean)

- Plan-adherence sweep (Agent 1): all 5 phases MATCH their contracts exactly — route shapes, `computeSuggestion` signature/logic (average consecutive-purchase interval, not `daysSincePurchase`'s min), `ReceiptCheckoutModal` prop signature and post-confirm `completePurchase()` sequencing, `analytics.ts` signatures, icon file sizes. One benign unplanned addition: `use-swipe-to-delete.ts` exposes an extra `consumeDragFlag()` beyond the plan's stated contract, used to suppress tap-toggle right after a drag — necessary, non-breaking, not a violation.
- "What We're NOT Doing" boundaries held: no test framework added, no Dashboard/TaskWizard/IconPicker/Cookbook logic changes, no real OCR/backend calls (the receipt image is never uploaded).
- `src/lib/api/client.ts` and `src/routes/cookbook.$recipeId.tsx` diffs (outside the plan's file list) are minor, justified, non-behavioral: a null-guard and a conditional-spread refactor to keep `ShoppingItem` field omission consistent with the new quick-add shape.
- No XSS/injection risk, no hardcoded secrets found in any reviewed file.
- All automated checks (lint, tsc, build) pass at HEAD across all 5 phases; all manual checkboxes have corresponding diff evidence.
