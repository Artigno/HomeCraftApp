# Tab Reorder & Profile Nav Access Implementation Plan

## Overview

Sprint-1 items #1 and #8. Reorder the bottom tab bar to Zakupy, Przepisy, Dom,
Budżet, and add a dedicated profile-access button to the tab bar so `/account`
is reachable from any tab, removing the current single-entry-point link.

## Current State Analysis

- Bottom tab bar lives in `src/routes/__root.tsx` — a `TABS` array (lines
  139-144) rendered by `TabBar` (lines 146-165), mounted in `RootComponent`
  (line 243) when the route isn't public.
- Current order: `/` (Dom), `/cookbook` (Przepisy), `/shopping` (Zakupy),
  `/insights` (Budżet). "Budżet" is a fully built page already
  (`src/routes/insights.tsx`), not a stub — no backend/#6 dependency for this
  change.
- Profile (`/account`) is reachable today only via a `UserCircle` icon `Link`
  in the Dom tab's `PageHeader` action slot (`src/routes/index.tsx:70-76`),
  imported directly from `lucide-react`. No other entry point exists anywhere
  in `src/`.
- All 4 tabs render as identical equal-width flex children
  (`flex-1` on each `Link`, `__root.tsx:155`) inside a `flex max-w-lg
  items-stretch` row (`__root.tsx:149`). No raised/FAB or icon-only variant
  exists today — every tab has an icon + text label.
- `/account` is already a registered TanStack Router route
  (`routeTree.gen.ts`), so linking to it from the tab bar needs no routing
  changes, only a new `TABS` entry.

## Desired End State

Tab bar shows, left to right: Zakupy, Przepisy, Profil (icon-only, no label),
Dom, Budżet. The Profil button uses the `UserCircle` icon, gets the same
active-state styling as the other 4 tabs when the current route is
`/account`, and is reachable from every screen the tab bar renders on. The
old `UserCircle` link in the Dom tab's header is removed — `/account` has
exactly one entry point.

### Key Discoveries:

- `src/routes/__root.tsx:139-144` — the `TABS` array is the single source of
  truth for both order and membership; no other file needs to change for
  routing/registration.
- `src/routes/__root.tsx:146-165` — `TabBar`'s `.map()` assumes every item has
  a `label` rendered under the icon; the Profil entry needs a variant that
  skips the label while keeping the same active-state class logic.
- `src/routes/index.tsx:70-76` — the only other place referencing `/account`;
  removing this is a pure deletion, no replacement needed since `PageHeader`'s
  `action` slot still carries the "Edytuj"/"+" buttons (lines 77-87) untouched.

## What We're NOT Doing

- Not touching `/insights` (Budżet) content or behavior — it's already built.
- Not adding a new route, page, or component — `/account` already exists.
- Not building a raised/FAB-style visual treatment — per user decision, the
  Profil button sits in the same flat row, icon-only.
- Not adding E2E coverage for this change — typecheck/lint + manual
  verification only, per user decision (low-risk, pure nav/UI, no business
  logic).
- Not touching #3, #9, #10, or any backend-joint item (#2,4,5,6,7) — those are
  separate changes.

## Implementation Approach

Single file carries both phases' core logic (`__root.tsx`); `index.tsx` gets
one deletion in phase 2. Phase 1 lands the reorder alone (verifiable and
shippable on its own). Phase 2 adds the 5th tab entry and removes the old
link, so if phase 2 needs rework it doesn't block the already-correct
reorder.

## Phase 1: Reorder bottom tabs

### Overview

Change tab order from (Dom, Przepisy, Zakupy, Budżet) to (Zakupy, Przepisy,
Dom, Budżet). Pure array reorder, no new entries.

### Changes Required:

#### 1. Tab order

**File**: `src/routes/__root.tsx`

**Intent**: Reorder the `TABS` array entries so the rendered tab bar matches
the target order (Zakupy, Przepisy, Dom, Budżet) specified in sprint-1 item
#1.

**Contract**: The `TABS` array (lines 139-144) keeps its existing 4 object
shapes (`{ to, label, Icon }`) unchanged — only the array's element order
changes. No other code references `TABS` by index, so no downstream updates
are needed.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npm run typecheck` (or project's equivalent script)
- Lint passes: `npm run lint`

#### Manual Verification:

- Open the app on a route with the tab bar visible; confirm tabs render
  left-to-right as Zakupy, Przepisy, Dom, Budżet
- Tapping each tab navigates to its existing route unchanged (`/shopping`,
  `/cookbook`, `/`, `/insights`)

---

## Phase 2: Add profile nav button, remove old header link

### Overview

Add a 5th, icon-only entry to the tab bar for `/account` in the middle
position (between Przepisy and Dom), matching the existing active-state
pattern, and delete the now-redundant `UserCircle` link from the Dom tab's
header.

### Changes Required:

#### 1. Profile tab entry

**File**: `src/routes/__root.tsx`

**Intent**: Add `/account` as a tab-bar entry positioned between Przepisy and
Dom (final order: Zakupy, Przepisy, Profil, Dom, Budżet), reusing the
`UserCircle` icon from the link it replaces.

**Contract**: Extend the `TABS` array/render logic to support an entry with
no visible text label (icon-only) while preserving the same active-state
class logic the other 4 entries use (i.e., whatever class toggle currently
keys off the current route matching `to` must apply identically to this
entry). `UserCircle` needs importing from `lucide-react` in `__root.tsx` (not
yet imported there).

#### 2. Remove old header link

**File**: `src/routes/index.tsx`

**Intent**: Delete the `UserCircle` `Link` to `/account` (lines 70-76) now
that the tab bar provides the only entry point. Leave the rest of the
`PageHeader` `action` slot (the "Edytuj"/"Gotowe" toggle and "+" button,
lines 77-87) untouched.

**Contract**: `PageHeader`'s `action` prop renders one fewer child; no other
prop or layout change required.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npm run typecheck`
- Lint passes: `npm run lint`

#### Manual Verification:

- Profil button appears between Przepisy and Dom, icon-only, on every route
  where the tab bar renders
- Tapping it navigates to `/account`
- While on `/account`, the Profil button shows the same active-state styling
  the other tabs show on their own active route
- Dom tab's header no longer shows the old UserCircle icon; "Edytuj"/"Gotowe"
  and "+" buttons still work as before

---

## Testing Strategy

### Unit Tests:

- None added — no business logic introduced.

### Manual Testing Steps:

1. Load the app, confirm tab order and labels match target.
2. Tap each of the 5 tab-bar entries from a non-active state; confirm correct
   navigation and active-state highlight.
3. Confirm Dom tab's header no longer has a profile icon, and its other two
   header buttons still function.
4. Spot-check on a small-width viewport that 5 equal-width items (vs. the
   previous 4) don't visually break (icon sizes/truncation).

## Performance Considerations

None — static nav change, no new data fetching or re-renders beyond the
existing route-based active-state check.

## Migration Notes

None — no data model or persisted state involved.

## References

- Sprint source: `../HomeCraftDocs/Sprint_1/Issue na sprint 1.md` (#1, #8)
- Roadmap: `context/foundation/roadmap.md`
- Change notes: `context/changes/tab-reorder-and-profile-nav-access/change.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Reorder bottom tabs

#### Automated

- [x] 1.1 Typecheck passes — 8008996
- [x] 1.2 Lint passes — 8008996

#### Manual

- [x] 1.3 Tabs render in target order (Zakupy, Przepisy, Dom, Budżet) — 8008996
- [x] 1.4 Each tab navigates to its existing route unchanged — 8008996

### Phase 2: Add profile nav button, remove old header link

#### Automated

- [x] 2.1 Typecheck passes — 5eeade8
- [x] 2.2 Lint passes — 5eeade8

#### Manual

- [x] 2.3 Profil button appears between Przepisy and Dom, icon-only, on every tab-bar route — 5eeade8
- [x] 2.4 Tapping Profil navigates to /account — 5eeade8
- [x] 2.5 Profil shows active-state styling while on /account — 5eeade8
- [x] 2.6 Dom header no longer shows old UserCircle icon; Edytuj/+ buttons still work — 5eeade8
