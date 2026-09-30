# Shopping List UX Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Overview

Six post-test fixes to the shopping list (`/shopping`) and one shared-component
fix (the edit-task `Drawer`), relayed from a peer session's user testing.
Reworks the list's interaction model from a single whole-row tap-to-toggle
into a real per-target interaction: checkbox toggles, label edits, an
iOS-Reminders-style bottom slot adds, and drag reorders — while fixing two
concrete layout bugs found along the way.

## Current State Analysis

- `src/routes/shopping.tsx`'s `ShoppingListRow` makes the **entire row** one
  tap target (`role="button"` on the row's outer div) that calls
  `toggleShoppingItem`. There's no per-field interaction.
- The list is added to via a `position: fixed` bar at `bottom-16` (`shopping.tsx`),
  independent of the tab bar's own `pb-safe`-based height (`__root.tsx`'s
  `TabBar`) — on a device with a non-zero `safe-area-inset-bottom`, the tab
  bar renders taller than the 64px the add bar assumes, and — being
  `z-40` vs the add bar's `z-30` — visually clips it.
- `src/components/ui/drawer.tsx`'s `DrawerContent` is `h-auto` with no
  `max-h` or `overflow-y-auto` — content taller than the viewport (e.g.
  right after the on-screen keyboard closes and the layout re-measures) has
  no scroll fallback and is simply cut off.
- `src/lib/store.tsx`'s `addShoppingItems` **prepends** new items
  (`[...created, ...s.shopping]`) — they appear at the top of their
  done/pending group, not the bottom.
- `ShoppingItem` (`src/lib/api/types.ts`) has no order field; list order is
  implicit (array/insertion order), with `shopping.tsx`'s `sorted` memo
  applying only a done-to-bottom sort (`Number(a.done) - Number(b.done)`).
- `src/hooks/use-swipe-to-delete.ts` already binds `onPointerDown/Move/Up/Cancel`
  directly on the row's outer div for horizontal swipe-to-delete — any drag
  gesture added to the same element must coexist with this, not fight it.
- No drag-and-drop library is installed (`@dnd-kit/*` not in `package.json`).

## Desired End State

- The edit-task drawer never clips content, on any screen size or after a
  keyboard close.
- Tapping the tab bar never covers the add-item control (moot after Phase 3
  removes the fixed add bar entirely — see Phase 3).
- Adding an item works like iOS Reminders: tap the empty slot under the
  last item, type, Enter saves and opens a fresh input right below for the
  next item.
- Tapping a product's name edits it inline; Enter exits edit (no chaining).
  Tapping the checkbox still toggles done, independently.
- A fast double-tap can't land on the wrong item because it slid away.
- Long-pressing a row and dragging reorders the list; the new order
  persists to the backend via `PATCH /shopping-items/{id} {sort_order}`.

### Key Discoveries:

- Backend already ships `sort_order` (integer) on `ShoppingItem`, ordered
  ascending by `index()`, with new items assigned trailing values by
  `batchStore` — and `PATCH /shopping-items/{id}` accepts a partial
  `{sort_order}` update (confirmed against the peer session building it
  concurrently; no new endpoint needed). Existing rows are backfilled by
  `created_at asc`, so every row has a valid `sort_order` already.
- `src/lib/store.tsx`'s `dismissWarning` already proves the pattern this
  plan needs for both inline-name-edit and drag-persist: optimistic local
  `setState` + `enqueue("PATCH", ...)` with a partial body. Phase 4
  generalizes this into one reusable `updateShoppingItem(id, patch)`
  instead of adding two narrow one-off functions.
- `PageHeader` (`src/components/PageHeader.tsx`) is unrelated to the "search
  + '+' hides under menu bar" report — there's no search field anywhere in
  the app today. Research confirms the actual object being described is the
  fixed add bar (an `Input` + `Plus` button), which is what Phase 3 removes.

## What We're NOT Doing

- Receipt parse/save and AI-categorize (peer's items #1/#8) — backend team's
  scope, explicitly excluded per the original request.
- Editing an item's `amount` inline — only `name` is edited via tap-label
  (confirmed decision).
- A dedicated drag-handle icon — dragging engages via long-press anywhere on
  the row (confirmed decision; the gesture-conflict risk this creates is
  called out in Phase 6's Critical Implementation Details).
- Disabling checkbox/swipe-to-delete on *other* rows while one row is being
  dragged (confirmed decision — only the dragged row's own gestures are
  superseded by the drag).
- Collision/reindex logic on the backend for `sort_order` — the frontend
  owns sequencing (confirmed with the peer session); Phase 6 renumbers and
  PATCHes as needed.

## Implementation Approach

Six phases, each independently shippable and manually verifiable before the
next starts. Phases 1–2 are small, isolated fixes. Phase 3 structurally
resolves the add-bar/tab-bar overlap as a side effect of replacing the fixed
bar (no separate layout-offset fix needed — see Phase 3's note). Phase 5's
debounce mechanism is intentionally later made unreachable by Phase 6's
change to the sort key, and Phase 6 removes it as dead code rather than
leaving it in place.

## Critical Implementation Details

**Gesture composition in Phase 6 (drag vs. swipe-to-delete on one element):**
`useSwipeToDelete` binds `onPointerDown/onPointerMove/onPointerUp/onPointerCancel`
directly on the row. `@dnd-kit`'s `useSortable` also wants to own pointer
events on its draggable element via the `listeners` it returns. Spreading
both directly onto the same DOM node means both handlers fire on every
pointer event — they need to be explicitly composed, not just merged: call
`dnd-kit`'s listener first, and inside `useSwipeToDelete`'s own handlers,
bail out early (don't update `translateX`) while `dnd-kit` reports
`isDragging` for that row (from `useSortable`'s return value). Configure
`PointerSensor`'s `activationConstraint: { delay: 400, tolerance: 5 }` —
this makes dnd-kit itself cancel a pending drag activation the moment
horizontal movement exceeds 5px within the 400ms window, which is what
lets a fast horizontal swipe "win" and reach `useSwipeToDelete` uncontested,
while a stationary press-and-hold engages the drag instead.

## Phase 1: Edit-task Drawer scroll fix

### Overview

The shared `DrawerContent` component gets a capped height and scroll
fallback so `TaskWizard`'s "Edytuj zadanie" sheet (and any future Drawer
usage) can never render content that's simply cut off.

### Changes Required:

#### 1. Shared Drawer component

**File**: `src/components/ui/drawer.tsx`

**Intent**: Cap the drawer's height to the viewport and make it scrollable,
so content taller than the available space scrolls instead of overflowing
off-screen — the actual cause of the "half visible after keyboard closes"
report (no scroll fallback existed at all).

**Contract**: `DrawerContent`'s `DrawerPrimitive.Content` className gains
`max-h-[85dvh] overflow-y-auto` alongside its existing classes. `dvh`
(dynamic viewport height) is used rather than `vh` so the cap tracks the
actual visible viewport as the on-screen keyboard opens/closes, not the
layout viewport.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `bunx tsc -p tsconfig.json`
- Lint passes: `bun run lint`
- Build succeeds: `bun run build`

#### Manual Verification:

- In Chrome devtools, pick a small mobile preset (e.g. iPhone SE), open the
  Dom tab, long-press a task tile to open "Edytuj zadanie" — confirm the
  full sheet content (name, frequency presets, icon picker, save button) is
  reachable, scrolling inside the sheet if the preset is short enough to
  need it.
- Confirm the sheet's drag handle and header stay visible while scrolling
  the body (or, acceptably, scroll with it — this fix caps overall height,
  it doesn't pin the header separately, matching the chosen fix scope).

---

## Phase 2: `sort_order` data model + append-to-bottom fix

### Overview

Wires the backend's new `sort_order` field into the frontend type and
store, and fixes new items appending to the bottom of their done/pending
group instead of the top.

### Changes Required:

#### 1. Shopping item type

**File**: `src/lib/api/types.ts:50-60`

**Intent**: Mirror the backend's `sort_order` field so the client can read
and write it.

**Contract**: Add `sort_order: number;` to the `ShoppingItem` interface.

#### 2. Store: append instead of prepend, assign trailing `sort_order`

**File**: `src/lib/store.tsx` (`addShoppingItems`, and the `StoreValue`
interface's `addShoppingItems` signature)

**Intent**: New items must land at the bottom of the list, matching what
the backend's `batchStore` already does server-side — the client's
optimistic local insert needs to match that ordering so there's no visible
jump once the next sync reconciles.

**Contract**: Compute each new item's `sort_order` as
`Math.max(0, ...state.shopping.map(i => i.sort_order)) + 1 + index` (index
within the batch being added, so a multi-item batch keeps its own relative
order). Append rather than prepend: `shopping: [...s.shopping, ...created]`.
Update the `Omit<...>` in both the `StoreValue` interface's
`addShoppingItems` type and its implementation to also omit `"sort_order"`
from the caller-supplied item shape (callers never set it directly).

#### 3. List sort: `sort_order` as tiebreaker within done/pending groups

**File**: `src/routes/shopping.tsx` (`sorted` memo)

**Intent**: Preserve the existing done-items-sink-to-bottom behavior (not
in scope to remove yet — that's Phase 6's explicit, later change) while
making the order *within* each group follow `sort_order` instead of
insertion order.

**Contract**: `sorted` becomes
`[...shopping].sort((a, b) => Number(a.done) - Number(b.done) || a.sort_order - b.sort_order)`.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `bunx tsc -p tsconfig.json`
- Lint passes: `bun run lint`
- Build succeeds: `bun run build`

#### Manual Verification:

- Add three items in quick succession via the existing add bar (still
  present until Phase 3) — confirm they appear in the order typed, at the
  bottom of the pending group, not reversed at the top.
- Toggle one done — confirm it moves to the bottom of the done group (not
  the top), consistent with existing behavior.

---

## Phase 3: iOS-Reminders-style inline add flow (replaces the floating bar)

### Overview

Removes the fixed bottom add bar and replaces it with an always-present
empty slot as the last row of the list — tapping it opens an inline text
input; Enter saves the item and immediately opens a fresh input below for
the next one, matching iOS Reminders. This also structurally eliminates
the add-bar/tab-bar overlap bug from Current State Analysis: the new add
row lives in the normal document flow (inside the `<ul>`), not
`position: fixed`, so it can no longer be clipped by the tab bar the way a
fixed-position element could — no separate layout-offset fix is needed for
it.

### Changes Required:

#### 1. Remove the fixed add bar

**File**: `src/routes/shopping.tsx`

**Intent**: The fixed bottom bar (`Input` + `Plus` button, `addByName`/
`handleQuickAdd`, the `name` state tied to them) is fully replaced by the
new inline add row below.

**Contract**: Delete the `<div className="fixed inset-x-0 bottom-16 ...">`
block and the `name`/`setName`/`handleQuickAdd` state and handler that only
served it. `addByName(rawName: string)` stays — the new add row calls it
directly.

#### 2. Inline add row component

**File**: `src/routes/shopping.tsx` (new local component, e.g.
`AddItemRow`, rendered as the last `<li>` in the list's `<ul>`, after the
mapped `ShoppingListRow`s)

**Intent**: An idle empty-slot row that becomes an inline text input on
tap; Enter commits the item via `addByName` and keeps a fresh input
focused and empty for the next entry, rather than collapsing back to idle
— that chained-focus behavior is the entire point of the iOS Reminders
pattern and is easy to get wrong by accident (e.g. blurring on submit
would break the chain).

**Contract**: Local state `active: boolean` (idle placeholder vs. input
shown) and `draft: string`. Tapping the idle row sets `active = true` and
focuses the input (`autoFocus` on mount is enough since the input only
mounts once `active` flips true). On Enter: call `addByName(draft)`, reset
`draft` to `""`, and **keep `active = true`** (don't unmount/reset the
input) so the same focused input is immediately ready for the next item.
On blur with an empty `draft`, set `active = false` (collapse back to the
idle placeholder row) — typing something then tapping away without
pressing Enter should not silently discard a partially-typed item, but an
untouched empty input collapsing on blur is expected and matches the
placeholder-row mental model.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `bunx tsc -p tsconfig.json`
- Lint passes: `bun run lint`
- Build succeeds: `bun run build`

#### Manual Verification:

- Scroll to the bottom of the list, tap the empty slot — input appears and
  is focused.
- Type a name, press Enter — item appears in the list (at the bottom, per
  Phase 2), and a fresh empty input is focused immediately below with no
  visible flicker or lost focus.
- Repeat 3–4 times rapidly — confirm every item is added and focus never
  drops out of the input.
- Tap away from an empty, untouched input — it collapses back to the idle
  placeholder row.
- In Chrome devtools mobile emulation, confirm the add row is never
  obscured by the tab bar (it scrolls with the list like any other row).

---

## Phase 4: Inline edit on tap (name only)

### Overview

Splits the row's single whole-row tap target into two: the checkbox toggles
done (as before), and the product label opens inline name editing. Enter
in edit mode just exits — it does not chain to the next item (unlike
Phase 3's add flow).

### Changes Required:

#### 1. Generalized item-update store function

**File**: `src/lib/store.tsx` (`StoreValue` interface and
`HomeSyncProvider`'s `value`)

**Intent**: Both this phase (name edits) and Phase 6 (drag-persisted
`sort_order`) need the same shape of operation — optimistic local patch +
`PATCH /shopping-items/{id}` with a partial body. Generalizing now avoids
adding two near-identical one-off functions; `dismissWarning` already
proves this exact pattern for `warning_dismissed`.

**Contract**: Add
`updateShoppingItem: (id: string, patch: Partial<Pick<ShoppingItem, "name" | "sort_order">>) => void`
to `StoreValue`, implemented the same way as `dismissWarning`: map-update
`state.shopping` by id, then `enqueue("PATCH", \`/shopping-items/${id}\`, patch)`.

#### 2. Row interaction restructure

**File**: `src/routes/shopping.tsx` (`ShoppingListRow`)

**Intent**: The current outer `role="button"` div fires `toggleShoppingItem`
on any tap anywhere in the row. That has to split: the checkbox circle
becomes its own tap target for toggling, the label becomes its own tap
target for editing, and the row's existing swipe-to-delete pointer
bindings stay on the outer div (unaffected — swipe is a drag gesture, not
a tap).

**Contract**: Remove `role="button"`/`onClick={handleRowClick}` from the
row's outer div (swipe-to-delete's `bind` pointer handlers stay). The
checkbox `<span>` becomes a `<button type="button">` wrapping the existing
circle markup, `onClick` (with `stopPropagation`) calling
`toggleShoppingItem(item.id)` — pad its hit area (e.g. wrap in a
`p-2 -m-2` sized touch target) so the visually-small 20px circle keeps an
accessible tap size. The label `<span>` gets its own `onClick` (with
`stopPropagation`) that sets a row-local `editing: boolean` state to
`true`. While `editing`, render an `<Input autoFocus defaultValue={item.name}>`
in place of the label text; Enter calls
`updateShoppingItem(item.id, { name: <trimmed value> })` and sets
`editing = false` (exits, no chaining — the key behavioral difference from
Phase 3). Blur also commits (same rationale as a standard inline-edit
field); Escape cancels without saving, discarding the local draft.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `bunx tsc -p tsconfig.json`
- Lint passes: `bun run lint`
- Build succeeds: `bun run build`

#### Manual Verification:

- Tap a product's checkbox — item toggles done, no edit mode triggered.
- Tap a product's name — becomes an editable input, focused.
- Change the text, press Enter — name updates in the list, input closes
  (does not open a new input below, unlike the add flow).
- Edit a name, press Escape — reverts to the original name, no save.
- Swipe a row horizontally — delete-reveal still works exactly as before.

---

## Phase 5: Debounced re-sort on toggle

### Overview

Prevents a fast second tap from landing on a different item by delaying
the *visual reordering* that follows a done-toggle, without delaying the
toggle itself.

### Changes Required:

#### 1. Order-freeze on toggle

**File**: `src/routes/shopping.tsx` (`ShoppingList`)

**Intent**: `toggleShoppingItem` already updates `done` (and therefore the
checkbox's visual state) instantly — that's correct and shouldn't change.
The bug is that the *list* re-sorts (moving the item to the other group)
in the same instant, so a second fast tap can land on whatever item slid
up to take its place. Freezing the rendered order briefly after a toggle
means the tapped item stays exactly where it was for a beat, so the next
tap still lands on what the user is looking at.

**Contract**: Track a `frozenOrder: string[] | null` state (an ordered
list of item ids). On any toggle, if `frozenOrder` is `null`, capture the
*current* `sorted` order's ids into it and start a ~400ms timer; while
`frozenOrder` is set, render items in that captured id order (mapping ids
back to their current, possibly-updated item objects — filter out any id
no longer present, e.g. deleted mid-freeze) instead of the live `sorted`
memo's order. When the timer fires, clear `frozenOrder`, letting the live
`sorted` order take over — this is the single animated reflow the user
sees, instead of an instant snap at tap-time.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `bunx tsc -p tsconfig.json`
- Lint passes: `bun run lint`
- Build succeeds: `bun run build`

#### Manual Verification:

- Tap an item to toggle it done, then immediately tap where the *next*
  item down used to be, before ~400ms passes — confirm the second tap
  lands on the item that's still visually there, not one that jumped up
  early.
- Wait past 400ms after a toggle — confirm the list settles into the
  correct done-to-bottom order.

---

## Phase 6: Drag-and-drop reorder (persisted)

### Overview

Adds `@dnd-kit` for long-press-to-drag reordering. This phase also changes
the list's sort key from "done-to-bottom, then `sort_order`" (Phase 2) to
pure `sort_order` across all items — the user explicitly chose free
reordering over preserving the done-group split — which makes Phase 5's
freeze mechanism unreachable (nothing auto-moves across groups on toggle
anymore, since groups no longer drive order); this phase removes that
logic rather than leaving it as dead code.

### Changes Required:

#### 1. Add the drag-and-drop dependency

**File**: `package.json`

**Intent**: No drag-and-drop library exists in this repo yet.

**Contract**: Add `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`
via `bun add @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities`.

#### 2. Sort key change: pure `sort_order`, drop done-grouping

**File**: `src/routes/shopping.tsx` (`sorted` memo)

**Intent**: Per the confirmed decision, dragging reorders freely across
done/pending state — the automatic done-to-bottom sort from Phase 2 is
removed in favor of manual order being the only order.

**Contract**: `sorted` becomes `[...shopping].sort((a, b) => a.sort_order - b.sort_order)`.

#### 3. Remove Phase 5's freeze mechanism

**File**: `src/routes/shopping.tsx` (`ShoppingList`)

**Intent**: With done-grouping gone, toggling an item never changes its
position, so there is nothing left for the freeze-on-toggle mechanism to
guard against.

**Contract**: Remove the `frozenOrder` state, its timer effect, and the
id-remapping render path added in Phase 5; render directly from `sorted`.

#### 4. Drag-and-drop wiring

**File**: `src/routes/shopping.tsx` (`ShoppingList`, `ShoppingListRow`)

**Intent**: Wrap the list in `dnd-kit`'s drag context so rows become
reorderable via long-press, composing cleanly with the existing
swipe-to-delete gesture on the same row element (see this plan's Critical
Implementation Details section for the exact composition approach).

**Contract**: `ShoppingList` wraps the `<ul>` in `DndContext` (with a
`PointerSensor` configured `activationConstraint: { delay: 400, tolerance: 5 }`,
matching the "long-press anywhere on the row" decision) and
`SortableContext` (`items={sorted.map(i => i.id)}`,
`strategy={verticalListSortingStrategy}`). `ShoppingListRow` calls
`useSortable({ id: item.id })`, applies its `transform`/`transition` via
`CSS.Transform.toString` to the row's style (composed with
`useSwipeToDelete`'s existing `translateX` style — swipe's transform
no-ops while `isDragging` is true per the Critical Implementation Details
composition), and spreads `dnd-kit`'s `listeners`/`attributes` onto the
row alongside (not replacing) `useSwipeToDelete`'s own pointer bindings,
with `useSwipeToDelete`'s handlers early-returning while that row's
`isDragging` is true.

#### 5. Persist reorder on drop

**File**: `src/routes/shopping.tsx` (`ShoppingList`'s `onDragEnd` handler)

**Intent**: The backend owns no reindexing logic — the client must
renumber and PATCH whatever changed.

**Contract**: On `onDragEnd`, compute the new full id order (moving the
dragged id to its drop index), renumber every item's `sort_order`
sequentially by its new index (`0..n-1`), update local state with the new
values for all items, and call `updateShoppingItem(id, { sort_order })`
(from Phase 4) only for the ids whose `sort_order` actually changed
value versus before the drop (typically the contiguous range between the
source and destination index, not the whole list).

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `bunx tsc -p tsconfig.json`
- Lint passes: `bun run lint`
- Build succeeds: `bun run build`
- Dependency installed: `grep '"@dnd-kit/core"' package.json`

#### Manual Verification:

- Long-press a row (~400ms) and drag it to a new position — confirm it
  moves, other rows shift to make room, and a quick tap (no hold) on a
  different row still just toggles it (not a drag).
- Fast horizontal swipe on a row (no pause) — confirm swipe-to-delete
  still reveals/commits normally, not intercepted by the drag sensor.
- Reload the page after a reorder — confirm the new order persisted
  (survives a fresh `GET /shopping-items` sync), including across a
  done/pending mix (an item can now sit anywhere regardless of its done
  state).
- Toggle an item done — confirm it no longer jumps to the bottom (grouping
  removed, matches the confirmed decision).

---

## Testing Strategy

No automated test framework exists in this repo (confirmed during prior
work on this codebase — no vitest/jest/playwright). Every phase's
automated gate is `tsc` + `eslint` + `bun run build`; correctness of the
interaction changes is verified manually per phase's Manual Verification
list, using Chrome devtools mobile emulation (per the confirmed
verification-method decision) plus, where noted, a real-device spot-check
recommended before considering the layout fixes (Phase 1) fully done.

### Manual Testing Steps (full flow, after all phases):

1. Open `/shopping` in a mobile-emulated viewport with a non-zero
   safe-area inset (e.g. iPhone 14 Pro preset).
2. Add several items via the bottom inline slot, chaining Enter presses.
3. Tap a name to rename it; tap a checkbox to toggle it; confirm neither
   interferes with the other.
4. Toggle two items in quick succession and confirm no mis-tap.
5. Long-press and drag an item to reorder; reload and confirm it stuck.
6. Open "Edytuj zadanie" on a maintenance task from the Dom tab with the
   on-screen keyboard toggled open then closed — confirm the sheet content
   is fully visible/scrollable throughout.

## Performance Considerations

`@dnd-kit` is tree-shakeable and only loaded on the `/shopping` route
(route-level code splitting already exists via TanStack Router's file-based
routes) — no expected impact on other routes' bundle size.

## Migration Notes

None required on the frontend — `sort_order` is already backfilled
server-side for all existing rows (confirmed with the peer session).

## References

- Backend contract confirmation: cross-session message from
  `deploy-homecraft-api-aws-bref`, 2026-09-30 (sort_order field + PATCH
  support, already implemented and tested backend-side).
- Existing partial-update pattern to follow: `src/lib/store.tsx`'s
  `dismissWarning`.
- Existing swipe gesture to compose with: `src/hooks/use-swipe-to-delete.ts`.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Edit-task Drawer scroll fix

#### Automated

- [x] 1.1 Typecheck passes: `bunx tsc -p tsconfig.json` — f68484c
- [x] 1.2 Lint passes: `bun run lint` — f68484c
- [x] 1.3 Build succeeds: `bun run build` — f68484c

#### Manual

- [x] 1.4 Full sheet content reachable/scrollable on a small mobile preset — f68484c
- [x] 1.5 Drag handle/header behavior acceptable while scrolling — f68484c

### Phase 2: `sort_order` data model + append-to-bottom fix

#### Automated

- [x] 2.1 Typecheck passes: `bunx tsc -p tsconfig.json` — f0ebd6c
- [x] 2.2 Lint passes: `bun run lint` — f0ebd6c
- [x] 2.3 Build succeeds: `bun run build` — f0ebd6c

#### Manual

- [x] 2.4 Items added in quick succession appear in typed order at the bottom — f0ebd6c
- [x] 2.5 Toggling an item moves it to the bottom of the done group — f0ebd6c

### Phase 3: iOS-Reminders-style inline add flow

#### Automated

- [x] 3.1 Typecheck passes: `bunx tsc -p tsconfig.json`
- [x] 3.2 Lint passes: `bun run lint`
- [x] 3.3 Build succeeds: `bun run build`

#### Manual

- [ ] 3.4 Tapping empty slot opens focused input
- [ ] 3.5 Enter saves and chains to a fresh focused input, repeatable
- [ ] 3.6 Tapping away from an empty input collapses it back to idle
- [ ] 3.7 Add row never obscured by the tab bar in mobile emulation

### Phase 4: Inline edit on tap (name only)

#### Automated

- [ ] 4.1 Typecheck passes: `bunx tsc -p tsconfig.json`
- [ ] 4.2 Lint passes: `bun run lint`
- [ ] 4.3 Build succeeds: `bun run build`

#### Manual

- [ ] 4.4 Checkbox tap toggles without entering edit mode
- [ ] 4.5 Label tap opens inline edit
- [ ] 4.6 Enter commits and exits without chaining
- [ ] 4.7 Escape cancels without saving
- [ ] 4.8 Swipe-to-delete still works unaffected

### Phase 5: Debounced re-sort on toggle

#### Automated

- [ ] 5.1 Typecheck passes: `bunx tsc -p tsconfig.json`
- [ ] 5.2 Lint passes: `bun run lint`
- [ ] 5.3 Build succeeds: `bun run build`

#### Manual

- [ ] 5.4 Fast second tap lands on the still-visually-present item
- [ ] 5.5 List settles into correct order after ~400ms

### Phase 6: Drag-and-drop reorder (persisted)

#### Automated

- [ ] 6.1 Typecheck passes: `bunx tsc -p tsconfig.json`
- [ ] 6.2 Lint passes: `bun run lint`
- [ ] 6.3 Build succeeds: `bun run build`
- [ ] 6.4 Dependency installed: `grep '"@dnd-kit/core"' package.json`

#### Manual

- [ ] 6.5 Long-press-and-drag reorders; quick tap still just toggles
- [ ] 6.6 Fast swipe still deletes, not intercepted by drag sensor
- [ ] 6.7 Reorder persists across reload
- [ ] 6.8 Toggling done no longer moves an item (grouping removed)
