---
change_id: budget-product-linking
title: Correct receipt-line-to-shopping-item matches in the budget tab
status: implemented
created: 2026-10-14
updated: 2026-10-15
archived_at: null
---

## Notes

In the Budget tab, let users view and correct which shopping-list item a
receipt line is matched to, so future AI suggestions improve.

Sprint 2, item 2 (frontend half). Backend contract lives in the sibling
repo HomeCraftApi, `context/changes/budget-product-linking/plan.md`
(status: planned, not yet implemented):

- `GET /purchases` (existing, extended): each purchase line gains
  `shopping_item_id: string|null`, `shopping_item_name: string|null`.
- `PATCH /purchases/{purchaseId}/lines/{lineId}` body
  `{shopping_item_id: string|null}` -> 200 updated line, 422 cross-household
  id, 404 mismatched ids.
- No endpoint yet exists to list the household's shopping items for a
  picker — reuse whatever already backs the shopping-list screen
  (`GET /shopping-items`), or flag as a needed new backend endpoint if
  nothing fits.
- Correction is NOT retroactive (future receipts only) — UI copy should set
  that expectation.

This change is blocked on that backend contract shipping — plan accordingly.

## Completion (2026-10-15)

Backend shipped (commits `77d90a0`, `a1d2b74`). Frontend implemented both
phases in `545b32a`: `PurchaseDetailModal` now shows each line's matched
shopping-item name and a picker to correct/unlink it, with optimistic
update + rollback on 422/404. Typecheck/lint/build all clean — manual
click-through in the live app left for the user.
