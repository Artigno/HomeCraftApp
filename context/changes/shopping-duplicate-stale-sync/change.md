---
change_id: shopping-duplicate-stale-sync
title: Shopping list item duplicates on refresh; server sync only happens on reload
status: impl_reviewed
created: 2026-10-08
updated: 2026-10-08
archived_at: null
---

## Notes

User-reported, during manual testing of `shopping-list-toggle-sort-bounce`:

Repro for the duplicate:
1. Add a product.
2. Hard refresh the page.
3. Toggle (check) that product.
4. Hard refresh again.
5. Now two identical products exist on the list.

Second, related complaint: server sync only seems to apply on a hard
refresh — it should happen live/continuously instead. User says this
whole area ("synchronizacja") needs a thorough look and fix, not just
the duplicate symptom.

Likely relevant: `shopping-list-since-cursor-reconciliation` (recently
shipped sync/merge logic) and `shopping-list-toggle-sort-bounce`
(just-shipped toggle/sort-order logic) both touch this path — the
duplicate could be a sync-merge id-matching bug, an optimistic-add not
getting reconciled with the server's assigned id, or something toggle-
specific interacting with the add-then-refresh-then-toggle-then-refresh
sequence. Not yet diagnosed — this is a raw symptom report, not a
root-caused fix.
