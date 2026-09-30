---
change_id: shopping-drag-reorder-fix
title: Fix shopping list drag-and-drop reordering
status: implementing
created: 2026-09-30
updated: 2026-09-30
archived_at: null
---

## Notes

Redo of `context/changes/shopping-list-ux-fixes/plan.md`'s Phase 6, which
shipped broken (commits present, but the feature doesn't work). Root
cause: composing `@dnd-kit`'s long-press-drag with the existing
`useSwipeToDelete` hook and a full-width tap-to-edit button on the same
row element — the label button's `stopPropagation` blanketed ~100% of the
row surface (leaving no real "long-press anywhere" area), and the row's
`overflow-hidden` (needed for swipe-reveal) clipped the dragged item's
CSS-transform visual instead of letting it lift and follow the pointer.

This plan replaces that composition with: whole-row long-press-drag
(checkbox excluded), tap-vs-hold on the name via dnd-kit's own
cancelled-activation-still-clicks behavior (no manual stopPropagation),
and `DragOverlay` for the visual drag preview (sidesteps the clipping
bug by portal-rendering outside any row's `overflow-hidden`). The actual
enabling fix is in `useSwipeToDelete` itself: defer `setPointerCapture`
until horizontal movement confirms a swipe, instead of capturing on every
pointerdown — that eager capture was redirecting clicks away from
checkbox/label all along, previously masked by ad-hoc stopPropagation
patches rather than fixed at the source.

Scope: only Phase 6's gesture/visual mechanism. Phases 1-5 of the parent
plan (drawer fix, sort_order model + append, inline add flow, inline
edit trigger, toggle debounce) are confirmed working and untouched.
