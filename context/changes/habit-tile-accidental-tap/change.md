---
change_id: habit-tile-accidental-tap
title: Fix accidental-tap logging on habit tiles (sprint-1 #3)
status: implemented
created: 2026-10-08
updated: 2026-10-08
archived_at: null
---

## Notes

Sprint 1, item #3 (`../HomeCraftDocs/Sprint_1/Issue na sprint 1.md`):

> Poprawić działanie nawyków na jakieś bardziej UX, obecnie użytkownicy
> skarżą się że mogą przypadkowo klikąć w kafelek i odnotować akcję a nie
> chcieli tego zrobić, trzeba to jakoś poprawić.

Confirmed in code: `src/routes/index.tsx` `TaskTile`'s `onClick` (lines
197-202) calls `logTask(task.id)` immediately on any tap that isn't a
long-press (edit) or in edit mode — no confirm step, no undo window, no
debounce. A single accidental tap logs the habit as done right away.

Per `context/foundation/roadmap.md` (`## Open questions`): "#3: which
accidental-tap mitigation (confirm/undo/long-press-to-log)? Needs product
input before `/10x-plan`." — the roadmap explicitly deferred the UX
decision and flagged this as needing a product call before planning,
rather than picking one unilaterally. This change starts that decision
process.

Roadmap also sequenced #3 last among the five frontend-only items (#1,
#3, #8, #9, #10) specifically because of this open UX decision — #1 and
#8 are already done (archived: `context/archive/2026-10-07-tab-reorder-and-profile-nav-access/`).
