# Fix Shopping List Drag-and-Drop Reordering — Plan Brief

> Full plan: `context/changes/shopping-drag-reorder-fix/plan.md`

## What & Why

The drag-and-drop reordering feature shipped in `shopping-list-ux-fixes`'s
Phase 6 doesn't actually work: long-press only engages from a narrow strip
of each row, and a dragged item visually vanishes instead of lifting to
follow the finger. This plan replaces the broken gesture composition with
a working one, without touching anything else in the shopping list.

## Starting Point

`ShoppingListRow` composes three gesture systems on one `<div>`: swipe-
to-delete, dnd-kit's long-press-drag, and a full-width tap-to-edit button
that stops event propagation to avoid conflicting with the other two.
Code review found two definitive bugs: the edit button's
`stopPropagation` blankets ~100% of the row, leaving almost no surface
for dnd-kit to detect a long-press from; and the row's `overflow-hidden`
(needed for swipe-reveal) clips the dragged item's CSS-transform visual
instead of letting it lift. Underneath both is the real root cause:
`useSwipeToDelete` captures the pointer on every single pointerdown,
immediately, before knowing if the gesture is a tap, swipe, or drag-hold —
which is what forced the `stopPropagation` patches in the first place.

## Desired End State

Long-press anywhere on a row except the checkbox lifts it into a floating,
scaled, shadowed copy that visibly follows the finger; other rows shift to
make room; the new order persists on drop. A short tap on the name still
opens inline edit, with no manual event-blocking needed. The checkbox
stays a dedicated tap-only zone. Swipe-to-delete is unaffected.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
|---|---|---|
| Drag surface | Whole row (minus checkbox) | User's explicit choice for easy touch-screen grabbing over a small handle icon |
| Edit vs. drag disambiguation | Short tap edits, long-press drags — via dnd-kit's own tap/hold timing | No manual stopPropagation needed; matches how Reminders/Todoist actually work |
| Checkbox | Excluded from drag entirely | The most-touched control stays perfectly predictable, never accidentally starts a reorder |
| Drag preview | `DragOverlay`: full row copy, ~1.03x scale, shadow | Portal-rendered, so it's immune to any row's own `overflow-hidden` clipping — the actual fix for the "disappears" bug |
| Origin row during drag | Dims to ~0.4 opacity + shrinks, stays in place | dnd-kit's own recommended default; avoids list-height jump |
| Root-cause fix | Defer `useSwipeToDelete`'s pointer capture until horizontal movement confirms a swipe | Fixes the actual mechanism that broke both this and the earlier Phase 4 bug, instead of patching around it again |

## Scope

**In scope:** the row-level gesture composition (swipe, drag, edit-tap),
the `useSwipeToDelete` hook's capture timing, `DragOverlay` wiring.

**Out of scope:** `sort_order` data model/persistence (already correct),
Phases 1-5 of the parent plan (drawer fix, append-to-bottom, inline add,
toggle debounce) — confirmed working, untouched. No dedicated drag-handle
icon (explicitly declined). No new dependencies (`DragOverlay` is already
part of the installed `@dnd-kit/core`).

## Architecture / Approach

Three phases, each fixing one layer: Phase 1 fixes the actual root cause
inside `useSwipeToDelete` (deferred pointer capture) in isolation — this
alone should make plain taps on children reliable again. Phase 2 rebuilds
the row's gesture composition on that fixed foundation, removing the
`stopPropagation` patches. Phase 3 adds `DragOverlay` for the visual fix
and the confirmed lift/dim/shadow appearance.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Fix `useSwipeToDelete` | Root-cause fix: deferred pointer capture | Low — isolated, single-file, testable independently of drag |
| 2. Row gesture redesign | Whole-row drag, tap-vs-hold edit, checkbox excluded | Medium — still composing two systems, but on a now-fixed foundation |
| 3. `DragOverlay` | Visual drag preview, fixes the clipping bug | Medium — must follow dnd-kit's own overlay pattern precisely (see plan's Critical Implementation Details) |

**Prerequisites:** None — no new dependencies, `@dnd-kit/core` already installed.
**Estimated effort:** ~3 short sessions, one per phase.

## Open Risks & Assumptions

- This exact feature already failed two rounds of devtools-only manual
  verification. A real-device spot-check before calling Phase 3 done is
  strongly recommended, not just the usual devtools mobile emulation.
- Phase 3's `DragOverlay` composition (which properties stay on the
  in-list item vs. move to the overlay) is genuinely fiddly — the plan
  calls out following dnd-kit's own reference example precisely rather
  than improvising, since ad-hoc composition is exactly what broke the
  first attempt.

## Success Criteria (Summary)

- Long-press-drag works smoothly from anywhere on a row (except the
  checkbox), with a visible floating preview the entire time.
- Checkbox, name-tap-edit, and swipe-to-delete all continue working
  exactly as before, unaffected by the drag mechanism sharing the row.
- Reorder persists across reload.
