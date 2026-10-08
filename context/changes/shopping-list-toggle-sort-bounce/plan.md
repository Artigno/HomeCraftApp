# Shopping List Toggle Sort Bounce & Done-Items Section Implementation Plan

## Overview

Fix `toggleShoppingItem`'s sort-targeting bug (confirmed by `frame.md`: the
move-to-end computation is global instead of group-scoped, contradicting its
own comment), then restructure the shopping list so completed items live in
a collapsed-by-default accordion instead of comingling with pending items in
one flat, drag-sortable list, and relocate the checkout/clear actions out of
a fixed bottom button block into the existing header actions menu.

## Current State Analysis

- `toggleShoppingItem` (`src/lib/store.tsx:343-360`) computes `nextOrder =
  Math.max(0, ...s.shopping.map(i => i.sort_order)) + 1` — the global max
  across the ENTIRE array, for both check and uncheck. Its own comment
  claims "move the toggled item to the end of its new group," which the code
  does not do (confirmed in `frame.md`'s Hypothesis Investigation).
- `src/routes/shopping.tsx`'s `ShoppingList` renders every item (done and
  pending) in one flat, `sort_order`-sorted list (`sorted` memo, line 98-101),
  draggable via a single `DndContext`/`SortableContext` pair spanning the
  whole list (lines 248-273). A toggle relocates the item to the absolute
  bottom of this combined list, which is the reported bounce.
- The "freeze" mechanism (`frozenOrder`/`displayOrder`, lines 103-128) delays
  the visual reflow ~400ms after any toggle so a fast second tap doesn't
  misfire — it does not change final position, only when the jump is shown.
- `handleDragEnd` (lines 148-162) renumbers only the items whose index
  actually changed, sequentially (`0, 1, 2, ...`), scoped to whatever array
  `displayOrder` currently holds.
- The checkout trigger ("Zakończ zakupy", disabled when no done items) and
  the "Wyczyść zaznaczone bez zapisu do budżetu" link currently live in a
  fixed `<div>` block below the list (lines 275-298), always rendered when
  `shopping.length > 0`.
- The header's actions dropdown (`PageHeader`'s `action` prop, lines
  196-223) already holds one item, "Kategoryzuj AI" (`DropdownMenuItem`,
  disabled when `pending < 2`) — the established pattern for list-level
  actions in this view.
- `src/components/ui/collapsible.tsx` already wraps
  `@radix-ui/react-collapsible`'s `Collapsible`/`CollapsibleTrigger`/
  `CollapsibleContent` but is currently unused anywhere in the app.
- `addShoppingItems` (`src/lib/store.tsx`) computes its own `baseOrder` from
  the global max across all items — this remains correct after this plan:
  new items are always pending, and since display always filters-then-sorts
  within a group, a globally-large `sort_order` still lands a new item at
  the end of the pending group after filtering. No change needed there.

## Desired End State

- Toggling an item off moves it to the end of the **pending** items only
  (not past already-done items); toggling an item on moves it to the end of
  the **done** items only. The in-code comment accurately describes this.
- Completed items render in a collapsed-by-default "Zakończone (N)"
  accordion section below the pending list, tap-to-expand on the header row.
  They are not draggable and are not part of the pending list's
  `SortableContext`.
- Unchecking an item from inside the expanded accordion moves it back into
  the pending list; the accordion stays however it was (no implicit
  collapse).
- "Zakończ zakupy" and "Wyczyść zaznaczone bez zapisu do budżetu" are
  `DropdownMenuItem`s in the existing header actions menu, alongside
  "Kategoryzuj AI"; the old fixed bottom button block is removed entirely.
- Verify: check an item → it disappears into the (still collapsed, count
  incremented) accordion immediately; expand the accordion → see it at the
  bottom of the done list; uncheck it from there → it reappears in the
  pending list, accordion stays expanded; drag-reorder pending items → only
  pending items are draggable; open the header's "⋮" menu → "Zakończ
  zakupy" and "Wyczyść zaznaczone" are there, triggering the same modal/
  confirm flow as before.

### Key Discoveries:

- `src/lib/store.tsx:160-173` — the since-cursor change's queue-override
  (just shipped) preserves whatever local `sort_order` value was already
  assigned to an item with a pending toggle PATCH in the queue, regardless
  of how that value was computed — the group-scoped computation this plan
  introduces is fully compatible with it, no changes needed there.
- `handleDragEnd`'s sequential renumbering (`shopping.tsx:159-161`) only
  ever operates on `displayOrder`, which Phase 2 scopes to pending items —
  no separate change needed to make drag "pending-only"; it already will be
  once `displayOrder`'s source is pending-only.
- `src/components/ui/dropdown-menu.tsx`'s `DropdownMenuItem` forwards
  `className` through `cn(...)` — `src/routes/index.tsx:163` already uses
  `text-destructive` on a destructive list action, the pattern to reuse for
  "Wyczyść zaznaczone."

## What We're NOT Doing

- Not adding a separate `SortableContext`/drag support for done items (frame
  decision: pending-only drag).
- Not persisting the accordion's expanded/collapsed state across reloads —
  it always starts collapsed on mount (frame decision: no localStorage key
  for this).
- Not auto-collapsing the accordion when the last visible done item is
  unchecked — it stays however the user left it (frame decision).
- Not changing `addShoppingItems`' order computation — confirmed unaffected
  above.
- Not touching the drag-reorder feature's own persistence/renumbering logic
  beyond it naturally scoping to pending items once `displayOrder`'s source
  changes.
- Not adding automated tests — no test runner exists in this repo
  (consistent with every prior plan touching this file).

## Implementation Approach

Phase 1 fixes the underlying data bug in isolation (`store.tsx` only) —
ships correct group-scoped targeting even before the UI changes, and is the
root fix the frame brief identified. Phase 2 builds the accordion UI on top
of that corrected targeting (if done first, the accordion would visibly
inherit the pre-existing bounce since unchecking would still jump past the
whole list including the still-growing done section). Phase 3 is a pure
relocation of two existing actions into an existing menu pattern, fully
independent of Phases 1-2's logic — ordered last since it's the
lowest-risk, purely cosmetic change.

## Critical Implementation Details

**Group-scoped targeting still allows cross-group numeric collisions, by
design.** After Phase 1, a pending item and a done item can legitimately
end up with the same raw `sort_order` integer (e.g. both `2`) — this is
harmless because every render path filters by `done` status *before*
sorting by `sort_order`; relative order within each filtered group is all
that matters. Do not "fix" this by trying to keep values globally unique.

**Done rows need no drag plumbing at all, not just a disabled drag.**
Rather than reusing `ShoppingListRow` with a conditional `useSortable({
disabled: true })`, Phase 2 introduces a separate, leaner row component for
done items with no `useSortable` call and no drag-handle button — avoids
needing a second `SortableContext` or reasoning about an id excluded from
one while still calling the hook.

## Phase 1: Group-scoped toggle targeting

### Overview

Fix `toggleShoppingItem`'s `nextOrder` computation to scope to the item's
target group (pending when unchecking, done when checking) instead of the
whole array, and correct the stale comment.

### Changes Required:

#### 1. Group-scoped `nextOrder` in `toggleShoppingItem`

**File**: `src/lib/store.tsx`

**Intent**: The toggled item should land at the end of whichever group
(pending or done) it's moving into, not the absolute end of the entire
list — matching the comment's original, never-implemented claim and
resolving the frame's confirmed bug.

**Contract**: Replace the single global `Math.max(0, ...s.shopping.map(i =>
i.sort_order))` with a computation scoped to `s.shopping.filter(i => i.done
=== nextDone)`, where `nextDone` is the item's new `done` value after the
toggle (`!current?.done`). `Math.max(0, ...)` over an empty filtered array
still correctly evaluates to `0` (the `0` baseline is already present in
the existing call) — no special-case needed for an empty target group.
Update the comment above the computation to describe the actual,
now-correct behavior instead of the previous mismatched claim.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npx tsc --noEmit`
- Lint passes: `npm run lint`

#### Manual Verification:

- None — covered by Phase 3's full-cycle manual pass per the plan's
  verification strategy (see "Testing Strategy").

---

## Phase 2: Collapsible done-items section

### Overview

Split the list's rendering into a pending section (unchanged drag/freeze
behavior, now naturally scoped to pending items) and a new collapsed-by-
default "Zakończone (N)" accordion section for done items, using the
already-present but unused `Collapsible` primitive.

### Changes Required:

#### 1. Split `sorted`/`displayOrder` into pending-only

**File**: `src/routes/shopping.tsx`

**Intent**: The existing `sorted` memo, freeze mechanism, and
`DndContext`/`SortableContext` should only ever see pending items — done
items move to their own, separate, non-draggable rendering path.

**Contract**: `sorted` (line 98-101) filters to `!i.done` before sorting.
Add a second memo, `doneSorted`, filtering to `i.done` and sorting by
`sort_order` the same way. `frozenOrder`/`displayOrder` (lines 103-128)
continue to operate on the pending-only `sorted`, unchanged otherwise — the
freeze mechanism's scope narrows automatically since its source data does.
Update the stale comment at lines 93-97 (it currently says "no more
automatic done-to-bottom grouping" — grouping is reintroduced by this
phase, just via a different UI than the old done-to-bottom sort).

#### 2. Collapsible done-items section with a non-draggable row

**File**: `src/routes/shopping.tsx`

**Intent**: Render `doneSorted` inside a collapsed-by-default accordion
below the pending `DndContext` block, using a leaner row component with no
drag plumbing.

**Contract**: Add `const [doneExpanded, setDoneExpanded] = useState(false)`.
Render, after the closing `</DndContext>` and before the (relocated-away-in
-Phase-3) action buttons: a `Collapsible` wrapping a `CollapsibleTrigger`
(a tappable header row, e.g. "Zakończone ({doneSorted.length})" with a
chevron icon reflecting `doneExpanded`, `aria-expanded={doneExpanded}`,
rendered only when `doneSorted.length > 0`) and a `CollapsibleContent`
rendering `doneSorted.map(item => <DoneShoppingListRow key={item.id}
item={item} />)`. Add `DoneShoppingListRow` as a new component: copies
`ShoppingListRow`'s checkbox/toggle, inline-name-edit, swipe-to-delete, and
warning-badge behavior, but omits `useSortable`, the drag-handle button,
and the `isDragging`-related styling/effects entirely — its toggle
`onClick` still calls `toggleShoppingItem(item.id)` (no `onToggleFreeze`
call needed; the freeze mechanism is pending-only per this plan).

#### 3. Empty-state subtitle when all items are done

**File**: `src/routes/shopping.tsx`

**Intent**: The header subtitle currently reads "Lista jest pusta" whenever
`pending === 0`, which is misleading once a non-empty done accordion can
coexist with an empty pending list.

**Contract**: Change the subtitle condition (line 198) to distinguish
"truly empty" (`shopping.length === 0`) from "everything done" (`pending
=== 0 && shopping.length > 0`), with its own copy for the latter (e.g.
"Wszystko zaznaczone ✅").

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npx tsc --noEmit`
- Lint passes: `npm run lint`

#### Manual Verification:

- None — covered by Phase 3's full-cycle manual pass per the plan's
  verification strategy (see "Testing Strategy").

---

## Phase 3: Relocate checkout actions into the header menu

### Overview

Move "Zakończ zakupy" and "Wyczyść zaznaczone bez zapisu do budżetu" from
the fixed bottom button block into the existing header actions dropdown,
and remove that block.

### Changes Required:

#### 1. Add both actions to the header's `DropdownMenu`

**File**: `src/routes/shopping.tsx`

**Intent**: Both actions are list-level, not per-item — they belong next to
"Kategoryzuj AI" in the same menu rather than in their own fixed block.

**Contract**: Add two `DropdownMenuItem`s to the existing
`DropdownMenuContent` (after "Kategoryzuj AI"): "Zakończ zakupy"
(`onSelect={() => setCheckoutOpen(true)}`, `disabled={!shopping.some(i =>
i.done)}`, same condition as today) and "Wyczyść zaznaczone bez zapisu do
budżetu" (`onSelect` runs the same `window.confirm(...)` +
`discardCompletedShoppingItems()` as today, `disabled={!shopping.some(i =>
i.done)}`, styled with `className="text-destructive"` following the
pattern at `src/routes/index.tsx:163`).

#### 2. Remove the fixed bottom button block

**File**: `src/routes/shopping.tsx`

**Intent**: The block both actions moved out of (lines 275-298) has no
remaining purpose.

**Contract**: Delete the `{shopping.length > 0 && (...)}` block entirely.
`checkoutOpen` state and the `ReceiptCheckoutModal` render stay — only the
trigger button moves.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npx tsc --noEmit`
- Lint passes: `npm run lint`

#### Manual Verification:

- Check an item done — it disappears from the pending list immediately and
  the (still collapsed) "Zakończone" accordion's count increments.
- Expand the accordion — the just-checked item is there, at the bottom of
  the done list.
- Uncheck it from inside the expanded accordion — it reappears in the
  pending list; the accordion stays expanded (not auto-collapsed).
- Drag-reorder pending items — works as before; done items in the
  accordion are not draggable (no grip handle, dragging them does nothing).
- Open the header's "⋮" menu — "Zakończ zakupy" and "Wyczyść zaznaczone bez
  zapisu do budżetu" are both there alongside "Kategoryzuj AI", both
  disabled when no items are done, both enabled and working (checkout modal
  opens; clear-without-saving confirms and clears) when items are done.
- With all items done and zero pending, header subtitle reads the new
  "everything done" copy instead of "Lista jest pusta."
- Full regression: add, edit-name, swipe-to-delete, and the recent-purchase
  warning badge all still work on both pending and done rows.

---

## Testing Strategy

### Unit Tests:

- None — no test runner exists in this repo.

### Manual Testing Steps:

Per the user's stated preference during planning, verification happens as
one full-cycle manual pass after Phase 3, covering all three phases'
behavior together (see Phase 3's Manual Verification above) rather than a
separate pass per phase.

## Performance Considerations

No new network calls or data-model changes; `doneSorted` is a second
`useMemo` over the same `shopping` array already in memory, same cost class
as the existing `sorted` memo.

## Migration Notes

No backend/data migration — purely client-side rendering and one local
computation fix. No `ShoppingItem` schema change.

## References

- Frame brief: `context/changes/shopping-list-toggle-sort-bounce/frame.md`
- Source: `src/lib/store.tsx:343-360` (`toggleShoppingItem`)
- Source: `src/routes/shopping.tsx` (full file — `ShoppingList`,
  `ShoppingListRow`, header actions dropdown)
- Pattern reference: `src/routes/index.tsx:163` (`text-destructive` on a
  destructive list action)
- Unused primitive now put to use: `src/components/ui/collapsible.tsx`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Group-scoped toggle targeting

#### Automated

- [x] 1.1 Typecheck passes — c7c9dee
- [x] 1.2 Lint passes — c7c9dee

### Phase 2: Collapsible done-items section

#### Automated

- [x] 2.1 Typecheck passes — c070c69
- [x] 2.2 Lint passes — c070c69

### Phase 3: Relocate checkout actions into the header menu

#### Automated

- [x] 3.1 Typecheck passes — 2f73ca0
- [x] 3.2 Lint passes — 2f73ca0

#### Manual

- [x] 3.3 Check an item — disappears from pending, collapsed accordion count increments — 2f73ca0
- [x] 3.4 Expand accordion — checked item visible at bottom of done list — 2f73ca0
- [x] 3.5 Uncheck from expanded accordion — reappears in pending, accordion stays expanded — 2f73ca0
- [x] 3.6 Drag-reorder pending items works; done items not draggable — 2f73ca0
- [x] 3.7 Header menu has "Zakończ zakupy" + "Wyczyść zaznaczone", correct disabled state, both work — 2f73ca0
- [x] 3.8 All-done empty-pending state shows new subtitle copy — 2f73ca0
- [x] 3.9 Full regression: add/edit-name/swipe-delete/warning-badge on both pending and done rows — 2f73ca0
