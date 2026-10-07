---
project: HomeCraftApp (frontend)
source: ../HomeCraftDocs/Sprint_1/Issue na sprint 1.md
scope: sprint-1
numbering: shared with HomeCraftApi/context/foundation/roadmap.md — item numbers are 1:1 across both repos
counterpart_repo: HomeCraftApi (homecraftapi-30 session owns backend-relevant items #2,4,6,7,5-backend-half)
---

# Sprint 1 Roadmap — Frontend-only items

Items #2,4,5,6,7 are joint (frontend+backend) and tracked separately once their
backend contracts land (see cross-session coordination log — `since` cursor +
`updated_at` contract for #7/#5 agreed with HomeCraftApi, pending
implementation). This roadmap covers the five items that are frontend-only
end-to-end: **#1, #3, #8, #9, #10**.

## #1 — Tab reorder (Zakupy, Przepisy, Dom, Budżet)

- **What**: current tab order doesn't match target (Zakupy, Przepisy, Dom, Budżet).
- **Likely surface**: `src/routes/__root.tsx` (tab bar), `src/router.tsx`.
- **Acceptance**: bottom nav renders tabs in that exact order; deep links/routes unchanged, only visual/order change.
- **Risk**: low. No backend dependency.
- **Note**: Budżet tab doesn't exist yet — item #6 (budget search/filter) will introduce it; this slice should reserve its position in the order even if the tab is a stub until #6 ships.

## #3 — Habit tile accidental-tap fix

- **What**: users accidentally tap a habit tile on "Dom" and log an action unintentionally. Needs better UX (confirm step, tap-and-hold, debounce, or undo).
- **Likely surface**: "Dom" tab (home/habits view — `src/routes/index.tsx`?), `src/hooks/use-long-press.ts` if long-press is reused for this.
- **Acceptance**: a single accidental tap no longer registers a habit action; user has a clear way to confirm or undo within a short window.
- **Risk**: low-medium — needs a UX decision (undo toast vs. confirm-on-tap vs. press-and-hold-to-log). Flag for product call before implementing if ambiguous.

## #8 — Profile tab reachable from anywhere (middle nav button)

- **What**: profile currently reachable only from "Dom" tab. Proposal: dedicated middle button on main nav.
- **Likely surface**: `src/routes/__root.tsx` (nav bar), `src/routes/account.tsx` (target route).
- **Acceptance**: profile/account screen reachable from every tab via one tap, independent of current tab.
- **Risk**: low. Changes nav layout — check it doesn't collide with #1's reordering (same file, sequence these two slices together).

## #9 — Long-press "Dom" tile modal: fix auto-selected first word

- **What**: long-pressing a "Dom" tile opens an edit modal, but the tile name's first word comes pre-selected (bug) in the input.
- **Likely surface**: `src/hooks/use-long-press.ts` trigger path + whatever edit-modal component it opens (name input autofocus/select behavior).
- **Acceptance**: opening the edit modal via long-press leaves the name field unselected (cursor placement or no focus), no pre-highlighted text.
- **Risk**: low, isolated to one input's focus/select handling.

## #10 — Edit modals open without auto-showing keyboard

- **What**: "Edytuj" and "Edytuj datę wydarzenia" modals auto-focus an input on open, forcing the keyboard up immediately — disruptive.
- **Likely surface**: shared modal components (`src/components/*Modal.tsx`, `TaskWizard.tsx`) — wherever autofocus is set on mount.
- **Acceptance**: opening either modal does not trigger the on-screen keyboard; keyboard only appears once user taps an input.
- **Risk**: low. Likely a shared `autoFocus` prop/pattern — fix once, check all modals using same pattern don't regress.

## Suggested order

1. **#1 + #8** together (same nav file, avoid double-touching `__root.tsx`)
2. **#9 + #10** together (same modal-focus bug class, likely shared root cause)
3. **#3** last — needs a UX decision before implementation, don't block the other four on it.

## Open questions

- #3: which accidental-tap mitigation (confirm/undo/long-press-to-log)? Needs product input before `/10x-plan`.
- #1: confirm Budżet tab should appear as a stub/disabled entry now, or wait until #6 ships the real tab.
