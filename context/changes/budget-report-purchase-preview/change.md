---
change_id: budget-report-purchase-preview
title: Preview purchase lines and receipt photo from the budget report
status: implemented
created: 2026-10-14
updated: 2026-10-15
archived_at: null
---

## Notes

From the budget/purchases report, let users preview the purchased product
lines and the original receipt photo for a purchase.

Sprint 2, item 3 (frontend half). Backend contract lives in the sibling
repo HomeCraftApi, `context/changes/budget-report-purchase-preview/plan.md`
(status: planned, not yet implemented):

- `GET /purchases` (existing, extended) response per purchase: adds
  `receipt_image_url: string|null` (short-lived ~10min signed URL, null if
  no photo was stored e.g. manual entry — don't cache beyond current page
  load) and each line gains `qty`, `unit_price` alongside existing
  `name`/`price`.

Note: `src/components/PurchaseDetailModal.tsx` and the `Purchase`/
`PurchaseLine` types already implement the receipt-photo + lines-list +
re-fetch-on-open parts of this from an earlier pass — this change is
scoped to the remaining gap: surfacing per-line `qty`/`unit_price` once the
backend ships them.

This change is blocked on that backend contract shipping — plan accordingly.

## Completion (2026-10-15)

Backend already exposed `qty`/`unit_price` on purchase lines. Frontend
added the breakdown rendering in `0459906` — typecheck/lint/build clean,
manual click-through left for the user.
