---
change_id: edit-modal-focus-fixes
title: Fix edit-modal focus bugs (sprint-1 #9 + #10)
created: 2026-10-08
updated: 2026-10-09
status: implemented
archived_at: null
---

## Notes

Sprint 1, items #9 and #10 (`../HomeCraftDocs/Sprint_1/Issue na sprint 1.md`),
tracked together in `context/foundation/roadmap.md` under "Suggested order"
as a pair — same autofocus-bug root-cause class.

**#9 — Long-press "Dom" tile modal: fix auto-selected first word**
- Long-pressing a "Dom" tile opens an edit modal, but the tile name's first
  word comes pre-selected (bug) in the input.
- Likely surface: `src/hooks/use-long-press.ts` trigger path + whatever
  edit-modal component it opens (name input autofocus/select behavior) —
  likely `TaskWizard.tsx` per `src/routes/index.tsx`'s edit-actions flow.
- Acceptance: opening the edit modal via long-press leaves the name field
  unselected (cursor placement or no focus), no pre-highlighted text.

**#10 — Edit modals open without auto-showing keyboard**
- "Edytuj" and "Edytuj datę wydarzenia" modals auto-focus an input on open,
  forcing the keyboard up immediately — disruptive.
- Likely surface: shared modal components (`TaskWizard.tsx` and similar) —
  wherever autofocus is set on mount.
- Acceptance: opening either modal does not trigger the on-screen keyboard;
  keyboard only appears once user taps an input.

Both are low-risk, isolated to input focus/select handling in edit modals.
Roadmap flags them as likely sharing a root cause — worth checking whether
one input-focus fix in a shared component resolves both.
