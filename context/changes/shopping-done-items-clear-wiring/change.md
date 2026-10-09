---
change_id: shopping-done-items-clear-wiring
title: Wire shopping-list done-items clear into DELETE /shopping-items/done
status: implementing
created: 2026-10-09
updated: 2026-10-09
archived_at: null
---

## Notes

Backend (HomeCraftApi, other Claude session) shipped and deployed to prod:

1. `GET /shopping-items` (default, no `since` param) now returns the FULL
   household list including `done=true` items, matching the since-branch's
   behavior. Every household member now sees the true current shared state,
   not just their own toggles. No param change needed on the frontend — this
   is a behavior fix on the existing default call.
2. New: `DELETE /shopping-items/done` — bulk-deletes all `done=true` rows for
   the caller's household in one call. Returns `204 No Content` (same
   convention as the existing per-item DELETE).

Why this is needed: now that done items are actually visible in the default
list (fix #1), the two "finish shopping" actions need to call this to clear
them, otherwise checked items will pile up permanently in every user's
"Zakończone" section:

- `discardCompletedShoppingItems()` ("Wyczyść zaznaczone bez zapisu do
  budżetu") — currently only does local `setState`, zero network calls.
  Should now also call `DELETE /shopping-items/done`.
- `completePurchase()` ("Zakończ zakupy" with budget save) — currently only
  filters local state + POSTs `/receipts/process`. Should also call
  `DELETE /shopping-items/done` after the purchase POST succeeds.

Also noted by backend: `discardCompletedShoppingItems()` never called the
backend at all before this fix — so pre-fix, "items disappearing from my
phone but still being in the DB" was expected prior behavior (local-only
clear), not data loss. Items were always still in the DB, just hidden by the
old `done=false` filter (now fixed).

Backend-side: full suite green (174 backend tests), implementation review
done (0 critical findings). This change is the frontend wiring half.
