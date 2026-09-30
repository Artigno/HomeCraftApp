# Fix Shopping List Drag-and-Drop Reordering Implementation Plan

## Overview

Replaces the broken gesture composition from `shopping-list-ux-fixes`'s
Phase 6 with a working one. The drag-and-drop feature currently ships but
doesn't work: long-press only engages from a narrow, seemingly-arbitrary
strip of each row, and a dragged item visually vanishes instead of lifting
to follow the finger.

## Current State Analysis

`src/routes/shopping.tsx`'s `ShoppingListRow` currently composes three
gesture systems on one `<div>`:

1. `useSwipeToDelete` (`src/hooks/use-swipe-to-delete.ts`) — horizontal
   swipe-to-reveal-delete, unrelated to reordering.
2. `@dnd-kit/sortable`'s `useSortable` — long-press (400ms) to drag-reorder.
3. A tap-to-edit `<button>` wrapping the item's name, added in the parent
   plan's Phase 4, with `onPointerDown={(e) => e.stopPropagation()}` so
   the row's own pointer handlers (needed for swipe) don't hijack the
   edit tap.

Two concrete, code-verified bugs:

- **The edit button's `stopPropagation` covers ~100% of the row.** The
  label element is `className="block w-full text-left"` inside a
  `flex-1` wrapper — it fills essentially the entire row surface minus
  the small checkbox (which also stops propagation for the same reason).
  A pointerdown starting anywhere over the name text never reaches the
  row's own `onPointerDown` (where `dnd-kit`'s `listeners.onPointerDown`
  is composed in), so dnd-kit's activation-constraint timer never even
  starts from most of the row. Only a thin sliver of unclaimed padding
  near the row's edges reaches the row-level handler at all — matching
  the "handle only works near the delete button" report, since that
  sliver happens to be spatially adjacent to where the (normally hidden)
  delete button sits.
- **`overflow-hidden` on each `<li>` clips the drag visual.** The `<li>`
  needs `overflow-hidden` so the swipe-revealed delete button (`absolute
  inset-y-0 right-0`) stays clipped until swiped into view. `useSortable`
  lifts a dragged item via CSS `transform`, which doesn't affect layout —
  the `<li>`'s own box stays exactly where it started. Once the dragged
  row's transform pushes it visually outside that unchanged box, the
  `<li>`'s `overflow-hidden` clips it away entirely instead of letting it
  visibly float above the list.

`useSwipeToDelete`'s `onPointerDown` (`src/hooks/use-swipe-to-delete.ts`)
calls `e.currentTarget.setPointerCapture(e.pointerId)` **immediately, on
every pointerdown**, before knowing whether the gesture is a tap, a
swipe, or a long-press-drag. This is the actual root mechanism behind
both the original Phase 4 manual-test failure (fixed there by adding
`stopPropagation` to children) and this phase's breakage (the
`stopPropagation` patches that fixed Phase 4 are exactly what then
blocked dnd-kit from ever seeing most pointerdowns) — eager capture
redirects a child element's click synthesis to the capturing ancestor
regardless of how far the pointer actually moved.

## Desired End State

- Long-press-and-hold anywhere on a row (except the checkbox) after
  ~400ms lifts it into a floating, slightly-scaled, shadowed copy that
  visibly follows the finger/cursor; other rows shift to make room; on
  release, the new order persists via the existing `sort_order` PATCH
  mechanism (unchanged from the original Phase 6).
- A short tap on the item's name opens inline edit, exactly as today,
  with no manual event-blocking needed to make it coexist with dragging.
- The checkbox remains a small, dedicated, always-tap-only zone — holding
  it never starts a drag.
- Swipe-to-delete continues to work exactly as before this whole
  drag-and-drop effort started.
- No behavior from Phases 1-5 of the parent plan changes.

### Key Discoveries:

- `useSwipeToDelete`'s `CLICK_SUPPRESS_THRESHOLD` (8px,
  `src/hooks/use-swipe-to-delete.ts:10`) already exists as the constant
  that distinguishes "this was basically a tap" from "this was a real
  drag" for its own `draggedFar`/click-suppression logic — reusable as
  the same threshold for deciding when to actually capture the pointer,
  rather than introducing a second magic number.
- `@dnd-kit/sortable`'s `useSortable` accepts a `disabled` option — used
  in Phase 2 to turn off drag listeners while a row is in edit mode,
  where dragging would make no sense anyway.
- `@dnd-kit/core` calls `event.preventDefault()` internally once a drag
  actually activates, which is what already prevents a spurious `click`
  from firing after a real drag-and-drop — no manual suppression needed
  for that case once children stop eagerly blocking propagation.

## What We're NOT Doing

- Any change to `sort_order`'s data model, persistence, or the
  `onDragEnd` renumbering logic — that already works correctly
  (confirmed: the backend PATCH calls landed correctly in the prior
  attempt; only the drag *mechanism* was broken).
- Any change to Phases 1-5 of `shopping-list-ux-fixes` (drawer scroll fix,
  append-to-bottom, inline add flow, toggle debounce).
- Removing `overflow-hidden` from the row `<li>` — still needed for
  swipe-reveal clipping; `DragOverlay` sidesteps the conflict instead of
  removing the constraint that caused it.
- A dedicated drag-handle icon — confirmed decision: the whole row (minus
  the checkbox) is the drag surface.

## Implementation Approach

Three phases. Phase 1 fixes the actual root cause (`useSwipeToDelete`'s
eager pointer capture) in isolation — this alone should already make
plain taps on children reliable again, independent of anything
drag-related. Phase 2 then redesigns the row's gesture composition on top
of that fixed foundation: no more `stopPropagation` patches, checkbox
stays excluded, name-tap-vs-hold falls out of dnd-kit's own
activation-constraint timing. Phase 3 adds `DragOverlay` to fix the
visual clipping and deliver the confirmed lift/dim/shadow appearance.

## Critical Implementation Details

**Follow dnd-kit's own `DragOverlay` pattern precisely in Phase 3, don't
improvise it.** The interaction between a sortable item's own `transform`
(used for the list-reflow animation of *other* items around the dragged
one) and the separately-portal-rendered `DragOverlay` child is
subtle — dnd-kit's official sortable + `DragOverlay` example (in their
docs/storybook) is the reference to match line-for-line for: which
element keeps applying `useSortable`'s `transform`/`transition` during a
drag (all items, including the dragged one, for consistent reflow
physics), what changes about the dragged item's own in-list rendering
(reduced opacity, not `visibility:hidden` — hiding it entirely causes a
list-height jump), and what `DragOverlay` receives as its `children`
(a presentational copy, not the interactive row). Deviating from that
reference pattern is exactly how the original attempt introduced new,
hard-to-diagnose bugs.

## Phase 1: Fix `useSwipeToDelete` — defer pointer capture until confirmed

### Overview

The hook currently captures the pointer unconditionally on `pointerdown`.
This phase changes it to only capture once horizontal movement actually
confirms the gesture is a swipe, leaving a plain tap-and-release on a
child element (checkbox, name) free to produce its normal `click` event.

### Changes Required:

#### 1. Deferred capture in the swipe hook

**File**: `src/hooks/use-swipe-to-delete.ts`

**Intent**: Root-cause fix. `onPointerDown` should record the gesture's
start position without capturing the pointer; `onPointerMove` should only
capture — and only then start applying `translateX` — once movement
exceeds `CLICK_SUPPRESS_THRESHOLD` **and** is horizontally dominant
(`|deltaX| > |deltaY|`, so a mostly-vertical hold, which is what a
long-press-drag looks like before it moves, is never misread as swipe
intent). A gesture that never crosses that bar (a tap, or a hold that
dnd-kit later claims as a vertical drag) never captures the pointer at
all, leaving the browser's normal click synthesis on the actual pressed
element completely undisturbed.

**Contract**: Add a `startY` ref (alongside the existing `startX`) and a
`captured` ref (replacing the implicit "capture happened in
`onPointerDown`" assumption). `onPointerMove` gains the threshold+
direction check described above before doing anything it does today;
`endDrag` only calls `releasePointerCapture` when `captured.current` is
true (guard already exists via `hasPointerCapture`, but must not assume
capture always happened). No change to `onDelete`, `reset`,
`consumeDragFlag`, `isRevealed`, or the returned `style`/`bind` shape —
this is an internal-behavior fix, not an interface change.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `bunx tsc -p tsconfig.json`
- Lint passes: `bun run lint`
- Build succeeds: `bun run build`

#### Manual Verification:

- On `/shopping`, tap a checkbox — toggles instantly, no delay or
  misfire.
- Tap a product name — opens inline edit instantly.
- Swipe a row horizontally (deliberate, fast) — delete-reveal still
  works exactly as before, with no perceptible change in feel.
- Slowly press and hold a row without moving — nothing happens yet (no
  premature swipe-translate creep from tiny jitter).

---

## Phase 2: Redesign row gesture composition

### Overview

Removes the `stopPropagation` patches from the name/edit-input and
switches the name from a full-width `<button>` to a plain clickable
element relying on dnd-kit's own tap-vs-hold distinction. The checkbox
keeps its own explicit exclusion. Dragging is disabled while a row is in
edit mode.

### Changes Required:

#### 1. Name becomes a non-button clickable element, no `stopPropagation`

**File**: `src/routes/shopping.tsx` (`ShoppingListRow`)

**Intent**: The name element must stop blocking the row's own
`onPointerDown` from reaching dnd-kit's activation-constraint tracking.
Using a plain element instead of a native `<button>` avoids that
element's own default touch/pointer handling adding another source of
interference (already burned once by composing native interactive
elements with custom pointer-gesture systems).

**Contract**: Replace the `<button type="button" onPointerDown={stop...}
onClick={startEdit}>` wrapper around the name with a
`<span role="button" tabIndex={0} onClick={...} onKeyDown={...(Enter/Space
→ startEdit)}>` — same `guardedTap()` gate as today (still needed for the
swipe-revealed-state check), no `onPointerDown` handler at all. The edit
`<Input>` itself also drops its `onPointerDown={stopPropagation}` — no
longer needed once nothing eagerly captures on pointerdown (Phase 1).

#### 2. Checkbox stays excluded; warning-badge buttons excluded too

**File**: `src/routes/shopping.tsx` (`ShoppingListRow`)

**Intent**: Per the confirmed decision, the checkbox is the one
deliberate exception to "whole row drags" — it keeps blocking the row's
pointerdown from reaching dnd-kit so a checkbox press is never
misinterpreted as a drag-hold, however long it's held. The small
delete/dismiss buttons inside the warning badge get the same treatment
for completeness (holding a tiny inline icon button shouldn't start a
row drag either).

**Contract**: Checkbox `<button>` keeps its existing
`onPointerDown={(e) => e.stopPropagation()}` unchanged. Add the same
`onPointerDown={(e) => e.stopPropagation()}` to the warning badge's two
inline buttons (delete, dismiss-warning) — they don't have it today.

#### 3. Drag disabled while editing

**File**: `src/routes/shopping.tsx` (`ShoppingListRow`)

**Intent**: Dragging a row that's mid-edit makes no sense — pass
`disabled` to `useSortable` while the inline edit input is open.

**Contract**: `useSortable({ id: item.id, disabled: editing })`.

#### 4. Row-level pointer composition stays, minus the now-unneeded gates

**File**: `src/routes/shopping.tsx` (`ShoppingListRow`)

**Intent**: The row still needs both `dnd-kit`'s `listeners.onPointerDown`
and the swipe hook's `onPointerDown` to run on every press (Phase 1 made
the swipe hook's version safe to call unconditionally, since it no longer
eagerly captures). `onPointerMove`/`onPointerUp`/`onPointerCancel`
continue to route to the swipe hook only while dnd-kit's `isDragging` is
false, unchanged from the prior attempt — that gating was never the
broken part.

**Contract**: `handlePointerDown` keeps calling
`listeners?.["onPointerDown"]?.(e)` then `bind.onPointerDown(e)`, in that
order, unchanged in shape from the prior attempt.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `bunx tsc -p tsconfig.json`
- Lint passes: `bun run lint`
- Build succeeds: `bun run build`

#### Manual Verification:

- Long-press (~400ms) anywhere on a row's name/background area — the row
  visibly begins to lift (even before Phase 3's overlay polish, some
  visible response should occur — full "no longer vanishes" verification
  is Phase 3's).
- Long-press specifically on the checkbox for well over 400ms — nothing
  drag-related happens; releasing still just toggles it.
- Short tap on the name — opens inline edit, no drag ever engaged.
- Open inline edit on an item, then try to long-press-drag it while the
  input is focused — dragging does not engage.
- Swipe-to-delete still works on a row that is not mid-edit.

---

## Phase 3: `DragOverlay` for the visual drag preview

### Overview

Adds a portal-rendered floating copy of the dragged row via `dnd-kit`'s
`DragOverlay`, which is unaffected by any row's own `overflow-hidden` —
this is what actually fixes the "disappears instead of lifting" bug. The
original row dims and shrinks in place while its floating copy follows
the pointer.

### Changes Required:

#### 1. Extract a presentational row-content component

**File**: `src/routes/shopping.tsx`

**Intent**: `DragOverlay`'s child must be a static visual copy, not the
interactive `ShoppingListRow` (which carries its own `useSortable`/
`useSwipeToDelete` state that has no meaning for a floating preview).
Extracting the shared visual markup (checkbox circle, name, amount,
recipe badge, warning badge) into one presentational component keeps
`ShoppingListRow` and the new overlay preview from duplicating that JSX.

**Contract**: New component, e.g. `ShoppingItemContent({ item, editing?
}: { item: ShoppingItem })` rendering the checkbox/name/badges markup
`ShoppingListRow` already has, with no event handlers of its own.
`ShoppingListRow` renders it internally (passing through its own
interactive wrappers); the `DragOverlay` preview renders it directly,
wrapped in the "lifted" visual treatment (scaled ~1.03x, shadow) from the
confirmed decision.

#### 2. Track the active drag id and render `DragOverlay`

**File**: `src/routes/shopping.tsx` (`ShoppingList`)

**Intent**: `DragOverlay` needs to know which item is currently being
dragged to render its preview.

**Contract**: Add `activeId: string | null` state, set via `DndContext`'s
`onDragStart`, cleared in the existing `handleDragEnd` (and on
`onDragCancel`, so an interrupted drag doesn't leave a stale overlay).
Render `<DragOverlay>{activeItem ? <liftedPreview using
ShoppingItemContent /> : null}</DragOverlay>` as a sibling of
`SortableContext` inside `DndContext` (not nested inside it — `DragOverlay`
portal-renders outside the list's own DOM regardless of where it's
declared, but keeping it as a direct `DndContext` child matches dnd-kit's
own examples).

#### 3. Dim/shrink the original row while it's the active drag

**File**: `src/routes/shopping.tsx` (`ShoppingListRow`)

**Intent**: Per the confirmed decision — the original slot stays in the
list (so spacing doesn't jump) but fades to ~0.4 opacity and shrinks
slightly, while the crisp moving copy is the `DragOverlay`.

**Contract**: When `isDragging` is true for a row, apply `opacity-40
scale-95` (or equivalent inline style) instead of the previous attempt's
manual `zIndex`/`CSS.Transform.toString(transform)` override — `useSortable`'s
own `transform`/`transition` continue to apply normally (per this plan's
Critical Implementation Details, follow dnd-kit's own `DragOverlay`
pattern for exactly which properties the in-list item keeps versus what
moves to the overlay).

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `bunx tsc -p tsconfig.json`
- Lint passes: `bun run lint`
- Build succeeds: `bun run build`

#### Manual Verification:

- Long-press and drag a row — a scaled, shadowed floating copy visibly
  follows the finger/cursor the entire time (never disappears), while
  the original slot in the list dims and shrinks but stays visible.
- Drop the dragged item in a new position — other rows have shifted to
  make room, the floating copy settles into place, the original dimmed
  slot is gone (only the one final row remains).
- Reload after a reorder — new order persisted (unchanged mechanism from
  the original Phase 6, just re-confirming nothing regressed).
- Interrupt a drag (e.g. via browser back gesture or losing focus, if
  reproducible) — no stale floating overlay left behind.

---

## Testing Strategy

No automated test framework exists in this repo. Every phase's automated
gate is `tsc` + `eslint` + `bun run build`; the gesture/visual correctness
is manual-only, using Chrome devtools mobile emulation as the primary
method (consistent with how the rest of `shopping-list-ux-fixes` was
verified) — but given this exact feature already failed two rounds of
devtools-only verification, a real-device spot-check before considering
Phase 3 fully done is strongly recommended this time, not just
suggested.

### Manual Testing Steps (full flow, after all phases):

1. On a real phone (or at minimum devtools touch emulation), open
   `/shopping`.
2. Tap a checkbox — toggles instantly.
3. Tap a name — edits instantly, Enter/blur commits, Escape cancels.
4. Long-press a row's name/background for ~1 second — it visibly lifts
   (scaled, shadowed) and follows the finger; drop it elsewhere — list
   reorders, persists across reload.
5. Long-press specifically the checkbox — never starts a drag.
6. Swipe a row horizontally — delete-reveal works exactly as before.
7. Toggle an item done — still moves to the end of the list after the
   ~300ms freeze (Phase 5 of the parent plan, unaffected by this plan).

## Performance Considerations

None beyond what the original Phase 6 already introduced — no new
dependencies added in this plan (`@dnd-kit/core`'s `DragOverlay` is
already part of the installed `@dnd-kit/core` package).

## Migration Notes

None — no data model changes.

## References

- Parent plan (Phases 1-5 unaffected, Phase 6 being replaced):
  `context/changes/shopping-list-ux-fixes/plan.md`
- Root-cause code: `src/hooks/use-swipe-to-delete.ts`,
  `src/routes/shopping.tsx`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Fix `useSwipeToDelete` — defer pointer capture until confirmed

#### Automated

- [x] 1.1 Typecheck passes: `bunx tsc -p tsconfig.json` — 4faffcc
- [x] 1.2 Lint passes: `bun run lint` — 4faffcc
- [x] 1.3 Build succeeds: `bun run build` — 4faffcc

#### Manual

- [x] 1.4 Checkbox tap toggles instantly, no delay or misfire — 4faffcc
- [x] 1.5 Name tap opens inline edit instantly — 4faffcc
- [x] 1.6 Deliberate horizontal swipe still reveals delete normally — 4faffcc
- [x] 1.7 Slow still-held press produces no premature swipe-translate creep — 4faffcc

### Phase 2: Redesign row gesture composition

#### Automated

- [x] 2.1 Typecheck passes: `bunx tsc -p tsconfig.json` — 4faffcc
- [x] 2.2 Lint passes: `bun run lint` — 4faffcc
- [x] 2.3 Build succeeds: `bun run build` — 4faffcc

#### Manual

- [x] 2.4 Long-press on name/background area visibly begins to lift the row — 4faffcc
- [x] 2.5 Long-press on checkbox never starts a drag; release still toggles — 4faffcc
- [x] 2.6 Short tap on name opens edit, no drag engaged — 4faffcc
- [x] 2.7 Dragging disabled while a row is mid-edit — 4faffcc
- [x] 2.8 Swipe-to-delete still works on non-editing rows — 4faffcc

### Phase 3: `DragOverlay` for the visual drag preview

#### Automated

- [x] 3.1 Typecheck passes: `bunx tsc -p tsconfig.json` — 4faffcc
- [x] 3.2 Lint passes: `bun run lint` — 4faffcc
- [x] 3.3 Build succeeds: `bun run build` — 4faffcc

#### Manual

- [x] 3.4 Floating scaled/shadowed copy follows the finger the whole drag, never disappears — 4faffcc
- [x] 3.5 Drop settles correctly; original dimmed slot resolves to one final row — 4faffcc
- [x] 3.6 Reorder persists across reload — 4faffcc
- [x] 3.7 No stale overlay left behind after an interrupted drag — 4faffcc
