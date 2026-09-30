---
change_id: receipt-parse-and-categorize
title: Wire up AI receipt parse and shopping-list categorize
status: implementing
created: 2026-09-30
updated: 2026-09-30
archived_at: null
---

## Notes

Frontend side of ISSUE_TO_FIX.md items #1 and #8, relayed from the
`deploy-homecraft-api-aws-bref` peer session. Backend already shipped and
committed both endpoints (`c7a8741`, `7b1c506`):

- `POST /receipts/parse` — multipart image upload, AI-read receipt draft
  (read-only, doesn't persist).
- `POST /shopping-items/categorize` — AI aisle-order sort, persists
  `sort_order` for all `done=false` items.

Peer session wants to do a real end-to-end pass once this UI exists —
ping them when Phase 2/3 are both done.
