<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Fix Shopping List Drag-and-Drop Reordering

- **Plan**: context/changes/shopping-drag-reorder-fix/plan.md
- **Scope**: Phase 3 of 3 (full plan)
- **Date**: 2026-09-30
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 5 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — DragOverlay preview drops recipe/warning badges

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/routes/shopping.tsx:268-292 (`ShoppingListRowPreview`)
- **Detail**: The plan's Phase 3 Intent named the recipe badge and warning badge as shared markup the preview should reuse (checkbox, name, amount, recipe badge, warning badge). The actual `ShoppingListRowPreview` only renders checkbox + name + amount — an item with a recipe tag or a "bought recently" warning loses that context while being dragged.
- **Fix**: Add the recipe-title badge and a static (non-interactive) warning-badge render to `ShoppingListRowPreview`, matching the read-only visual `ShoppingListRow` already has for those two blocks.
- **Decision**: FIXED

### F2 — Dragged row doesn't shrink, only dims

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/routes/shopping.tsx:362-367 (`liStyle`)
- **Detail**: Confirmed decision was "dims to ~0.4 opacity **and shrinks**." Actual `liStyle` only sets `opacity: 0.4` when `isDragging` — no scale applied.
- **Fix**: Append `scale(0.95)` to the `<li>`'s transform string when `isDragging` (alongside the existing `CSS.Transform.toString(transform)`).
- **Decision**: FIXED

### F3 — `freezeTimer` not cleared on unmount

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/routes/shopping.tsx:70-76 (`freezeOrderBriefly`)
- **Detail**: Navigating away from `/shopping` within the 400ms freeze window leaves the `setTimeout` pending; it fires `setFrozenOrder` on an unmounted component. Harmless in React 18+ (no warning), but not cleaned up.
- **Fix**: Add a `useEffect(() => () => { if (freezeTimer.current) clearTimeout(freezeTimer.current); }, [])` cleanup.
- **Decision**: FIXED

### F4 — Swipe state can go stale when a drag activates mid-swipe

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/routes/shopping.tsx:332-346 (`handlePointerMove/Up/Cancel`)
- **Detail**: All three gate on `if (!isDragging) bind...`. If dnd-kit's activation constraint commits (long-press wins) *while* `useSwipeToDelete` already has `captured.current = true` from an in-progress horizontal read, `bind.onPointerUp`/`onPointerCancel` never fires for that gesture — `dragging.current`/`captured.current` inside the hook stay stuck until the *next* `onPointerDown` (which resets them). Not a crash; `isRevealed`/`translateX` can be visibly wrong for one gesture in this narrow race.
- **Fix**: Add a `useEffect` on `isDragging` that calls `bind.onPointerCancel` (a synthetic no-op event is fine, or expose a `forceCancel()` from the hook) the moment it transitions to `true`, forcing a clean handoff.
  - Strength: Closes the race at its actual source rather than papering over the symptom.
  - Tradeoff: `useSwipeToDelete`'s public shape gains a small new method, or the caller needs a synthetic-event workaround — either way it's a few lines, not a rewrite.
  - Confidence: MED — the race window is narrow (both systems reading the same pointerdown), untested against a real device where the timing might differ from devtools emulation.
  - Blind spot: Haven't reproduced this specific interleaving manually; reasoning from code, not an observed bug report.
- **Decision**: FIXED

### F5 — Drag-to-reorder is pointer-only, no keyboard path

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Safety & Quality
- **Location**: src/routes/shopping.tsx:92-96 (`useSensors`)
- **Detail**: Only `PointerSensor` is registered. A keyboard-only user has no way to reorder the shopping list at all (checkbox toggle and name edit both work via keyboard already — this is specifically the drag surface). Not called out as in-scope or out-of-scope anywhere in the plan.
- **Fix**: Add `@dnd-kit/core`'s `KeyboardSensor` with `sortableKeyboardCoordinates` from `@dnd-kit/sortable`, wired into the same `useSensors(...)` call.
  - Strength: dnd-kit ships this as a near drop-in addition (a few lines), and it's the standard accessible-reorder pattern for exactly this library.
  - Tradeoff: Needs its own manual verification pass (focus the row, arrow-key reorder, confirm persistence) — this review didn't verify that path exists anywhere else in the app either, so it may be a pre-existing gap being surfaced here for the first time rather than a regression this plan introduced.
  - Confidence: MED — the fix itself is well-documented dnd-kit usage; whether it's this plan's job to close a gap the original plan never scoped is a product-priority call, not a code-correctness one.
  - Blind spot: Unclear whether accessibility is currently a tracked requirement for this app at all — no other evidence of keyboard-first design was found in the reviewed files.
- **Decision**: FIXED

### F6 — Swipe/drag state not keyed by `pointerId` (multi-touch)

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/hooks/use-swipe-to-delete.ts:14-19
- **Detail**: `dragging`/`captured`/`startX`/`startY` are single refs, not keyed by `pointerId`. A second pointerdown on the same row before the first pointer's up/cancel (genuine multi-touch on one row) would clobber in-flight state. `touch-action: none` on the `<li>` narrows this to a real multi-finger-on-one-row scenario, which is rare for this UI.
- **Fix**: Not recommended as a required fix — informational only, given the narrow real-world likelihood.
- **Decision**: SKIPPED
