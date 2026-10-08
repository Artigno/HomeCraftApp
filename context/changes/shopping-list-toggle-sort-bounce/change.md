---
change_id: shopping-list-toggle-sort-bounce
title: Shopping list sort order bounces on toggle
status: impl_reviewed
created: 2026-10-07
updated: 2026-10-08
archived_at: null
---

## Notes

Peer-reported (HomeCraftApi session `homecraftapi-30`, relaying a user report):

> User-reported bug in the frontend app's shopping list sorting: checked
> (done) items always sink to the bottom, and unchecking an item makes it
> jump back above the still-checked items — sort order bounces around on
> toggle instead of staying stable.
>
> This is a frontend display/sort concern (backend only returns
> done=false items by default from GET /shopping-items, ordered by
> sort_order — it doesn't dictate checked-item placement). Worth checking
> the local sort/merge logic in store.tsx or wherever the list is
> rendered — likely resorting by done-status on every toggle instead of
> preserving a stable order.

Peer flagged this while `shopping-list-since-cursor-reconciliation` was
in flight, in case it was related to the merge logic there — it isn't;
that change only touches preserving `done`/`sort_order` through sync, not
the toggle action's own reorder.

Initial look during triage: `toggleShoppingItem` (`src/lib/store.tsx`)
moves the toggled item's `sort_order` to `max(sort_order) + 1` — i.e. the
very end of the whole list — on every toggle, in either direction, by
design (see the comment at that call site). `src/routes/shopping.tsx:93-97`
already has a "freeze the rendered order briefly after a toggle" mechanism
(`frozenOrder`) specifically to paper over the resulting visual reflow,
referencing a prior change's "Phase 5 manual verification" correction
(likely `shopping-drag-reorder-fix` or `shopping-list-ux-fixes` —
not yet confirmed which).

Open question for `/10x-frame`: is the bug a gap in the existing freeze
mechanism (e.g. doesn't cover the uncheck direction, or a timing window),
or is "move to end of list on every toggle" itself the wrong behavior now
that free drag-reorder exists and should instead preserve the item's
position within its done/not-done group? The symptom and the likely fix
are not yet disentangled — that's exactly what framing should resolve
before planning.
