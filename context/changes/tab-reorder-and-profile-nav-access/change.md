---
change_id: tab-reorder-and-profile-nav-access
title: Reorder main tabs and add profile access from every tab (sprint-1 #1, #8)
status: implemented
created: 2026-10-07
updated: 2026-10-07
archived_at: null
---

## Notes

Sprint 1 items #1 and #8, bundled because both touch the main nav
(`src/routes/__root.tsx`):

- **#1**: reorder bottom tabs to Zakupy, Przepisy, Dom, Budżet. Budżet tab
  doesn't exist yet (ships with #6, backend-owned, separate change) — decide
  whether to reserve a stub/disabled slot now or defer the full reorder until
  #6 lands.
- **#8**: profile/account currently reachable only from "Dom" tab. Add a
  dedicated middle nav button so it's reachable from every tab
  (`src/routes/account.tsx` is the target route).

See `context/foundation/roadmap.md` for full sprint-1 item list and the
frontend/backend split agreed with the HomeCraftApi session.
