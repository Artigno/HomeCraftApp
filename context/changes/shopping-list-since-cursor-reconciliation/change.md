---
change_id: shopping-list-since-cursor-reconciliation
title: Wire up since-cursor reconciliation, drop local TTL workaround
status: implemented
created: 2026-10-07
updated: 2026-10-07
archived_at: null
---

## Notes

HomeCraftApi (backend session `homecraftapi-30`) finalized the contract for
`shopping-list-done-state-bug` (sprint-1 #7 + #5/B-04 merge):

1. **Toggle endpoint (idempotent)**: `PATCH /shopping-items/{shoppingItem}/toggle`
   body now REQUIRED: `{ "done": boolean }`. Setting the same value repeatedly
   is a true no-op at the data level (`updated_at` still bumps). Missing
   `done` → 422. Frontend already sends this (commit `4f784f5` in this repo,
   `src/lib/store.tsx` `toggleShoppingItem`) — verify it matches exactly once
   scoped.

2. **`since` cursor** added to 5 list endpoints: `GET /shopping-items`,
   `/purchases`, `/maintenance-tasks`, `/maintenance-logs`, `/recipes`.
   Optional query param `?since=<ISO8601>`:
   - Present: returns all household rows with `updated_at > since`, ordered
     by `updated_at`, INCLUDING `done=true` shopping items (no more
     `done=false`-only filtering when `since` is set).
   - Absent: unchanged legacy behavior (shopping-items still `done=false`
     only, others full current list) — fully backward compatible.
   - Invalid/unparsable `since` value → 422.

3. Every affected Resource (`ShoppingItemResource`, `PurchaseResource`,
   `MaintenanceTaskResource`, `MaintenanceLogResource`, `RecipeResource`) now
   exposes `updated_at` in ISO8601, alongside existing fields — advance the
   local cursor from this field after each fetch.

This should let us drop the 6h `local_marked_done_at` TTL workaround
(`src/lib/store.tsx`, introduced in commit `72819ba`,
`fix(shopping-list): expire stuck checked-off items instead of keeping them
forever`) and reconcile the cache correctly via `since` instead.

Backend status per their message: full test suite green (162 tests), lint
clean. They're waiting on us to wire this in frontend-side so they can close
out their plan's final manual check — ping `homecraftapi-30` once done.

Scope for this change: shopping-items reconciliation only (the TTL
workaround currently only exists for shopping items). Rolling the same
`since`-cursor pattern to purchases/maintenance-tasks/maintenance-logs/
recipes polling (if we even poll those today) is a separate decision —
investigate during planning/research whether any of those currently use
full-refetch-and-diff logic that would benefit, or whether this is
shopping-items-only for now.
