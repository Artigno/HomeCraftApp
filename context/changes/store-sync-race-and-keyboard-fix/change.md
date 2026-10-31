---
change_id: store-sync-race-and-keyboard-fix
title: Fix recipe/task/purchase/tin vanish-after-add race + shopping-list keyboard tick
created: 2026-10-31
updated: 2026-10-31
status: implemented
archived_at: null
---

## Notes

User-reported bug: a household member adds a recipe, it shows up briefly,
then disappears. Root-caused via systematic-debugging to `syncFromBackend()`
in `src/lib/store.tsx` — it wholesale-replaces `recipes`/`tasks`/`purchases`/
`tins` with the server GET response on every resync trigger (mount,
focus/visibilitychange, push broadcast, pull-to-refresh), with no guard for
a locally-created row whose POST hasn't flushed yet through the offline
queue. `addRecipe()` does an optimistic insert + enqueue, and
`cookbook.new.tsx` navigates away immediately — a resync (most likely the
focus/visibilitychange listener firing on return to `/cookbook`) lands
before the create reaches the backend and wipes the optimistic row.

`fetchItemsForTag` (same file, shopping-items) already has the fix for this
exact race (carry-forward unflushed local creates + pendingIds override for
in-flight PATCHes), with a comment documenting the failure mode. No
equivalent guard exists for recipes, tasks, purchases, or tins.

Second, unrelated issue bundled in here at user's request: the shopping-list
"add product" input (`AddItemRow` in `src/routes/shopping.tsx`) shows a
checkmark/tick-style return key on mobile, but tapping it only blurs the
input (no commit) when the field is non-empty — only the physical Enter
keydown calls `commit()`. The icon looks like confirm but doesn't act like
it.

No test runner exists in this repo (no vitest/jest, no `test` script) — this
plan adds a minimal vitest setup as its first phase to get one regression
test in place for the merge logic.
