# Tab Reorder & Profile Nav Access — Plan Brief

> Full plan: `context/changes/tab-reorder-and-profile-nav-access/plan.md`

## What & Why

Sprint-1 items #1 and #8: reorder the bottom tab bar to Zakupy, Przepisy, Dom,
Budżet, and make the profile page reachable from every tab instead of only
from Dom's header icon.

## Starting Point

4 tabs today in `src/routes/__root.tsx` (`Dom, Przepisy, Zakupy, Budżet` —
"Budżet" is already the fully-built `/insights` page, not a stub). Profile
(`/account`) has exactly one entry point: a `UserCircle` icon link in Dom's
header (`src/routes/index.tsx:70-76`).

## Desired End State

Tab bar reads Zakupy, Przepisy, Profil, Dom, Budżet left to right. Profil is
icon-only (no text label), uses the same `UserCircle` icon and the same
active-state highlight logic as the other 4 tabs. Dom's header no longer has
the old profile icon — one entry point, in the nav.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Profile button position | Literal middle (between Przepisy and Dom) | Matches sprint text "przycisk środkowy" | Plan (user Q&A) |
| Old header link | Removed | Avoid two entry points doing the same thing | Plan (user Q&A) |
| Profile button style | Icon-only, no label | Visually signals it's a different action type than section nav | Plan (user Q&A) |
| Icon | Reuse `UserCircle` | Already associated with profile by users | Plan (user Q&A) |
| Active-state styling | Same pattern as other 4 tabs | Consistency — user should see they're on /account | Plan (user Q&A) |
| Automated test scope | Typecheck/lint + manual only, no E2E | Pure nav/UI change, no business logic, low risk | Plan (user Q&A) |

## Scope

**In scope:** reordering the 4 existing tabs; adding a 5th icon-only
profile tab; removing the now-redundant header link in `index.tsx`.

**Out of scope:** `/insights` (Budżet) content, any new route/page, FAB-style
visual treatment, E2E tests, items #3/#9/#10, any backend-joint item.

## Architecture / Approach

Everything routes through the existing `TABS` array in `__root.tsx` — no new
routing registration needed since `/account` is already a generated TanStack
Router route. Two phases: (1) pure reorder of the 4 existing entries, (2) add
the profile entry + delete the old link, so phase 1 ships independently of
phase 2.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Reorder bottom tabs | Tab order matches Zakupy, Przepisy, Dom, Budżet | None — pure array reorder |
| 2. Add profile nav button | 5th icon-only tab + old link removed | Icon-only variant must not break the existing label-rendering `.map()` logic or active-state class |

**Prerequisites:** none — no backend dependency, `/account` route already exists.
**Estimated effort:** ~1 session, single file for phase 1, two files for phase 2.

## Open Risks & Assumptions

- 5 equal-width tabs may look cramped on narrow viewports vs. today's 4 — flagged for manual check in phase 2 (testing step 4).
- Assumes `TabBar`'s active-state class logic is a simple route-match check reusable as-is for an icon-only item; if it's more entangled with the label rendering, phase 2's implementer may need to refactor slightly more than described.

## Success Criteria (Summary)

- Tab bar order visually matches Zakupy, Przepisy, Dom, Budżet.
- Profile reachable with one tap from any tab-bar screen, via the new middle icon.
- No duplicate profile entry point remains.
