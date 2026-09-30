---
change_id: shopping-list-ux-fixes
title: Shopping list UX fixes
status: implementing
created: 2026-09-30
updated: 2026-09-30
archived_at: null
---

## Notes

Post-test fixes relayed from the `deploy-homecraft-api-aws-bref` peer session
(user tested a build, found these). Backend team is separately handling
receipt parse/save and an AI-categorize endpoint (not in scope here).

`sort_order` field on `ShoppingItem` (integer, `PATCH /shopping-items/{id}`
accepts `sort_order: sometimes|integer|min:0`) was added by the peer session
mid-planning, specifically for Phase 6 (drag-and-drop) — see
`plan.md`'s Phase 2 and Phase 6 for how it's consumed.
