---
change_id: shopping-sync-queue-refactor
title: Refactor offline-queue sync so default path is immediate backend sync
status: planned
created: 2026-10-09
updated: 2026-10-09
archived_at: null
---

## Notes

Refactor offline-queue sync so it only activates when the client is
offline; default path is immediate backend sync. Fixes disappearing/stale
"done" shopping items.

Context: `shopping-done-items-clear-wiring` (sibling change) wired
`DELETE /shopping-items/${id}` into `discardCompletedShoppingItems()` and
`completePurchase()`, plus a one-time purge of a stale queued bulk-DELETE
request. Deployed twice; user still reports items disappearing after
checking them off (toggleShoppingItem), even for fresh toggles unrelated to
discard/complete-purchase. The user's own diagnosis: the queue-first
architecture (every mutation always goes through a durable localStorage
queue + best-effort flush, instead of a direct online-first request) is
itself the root cause, not just the two call sites already patched.

Not yet investigated in this session: whether the symptom is actually the
queue architecture itself, or something narrower (e.g. the known separate
"sync only works after hard refresh" bug, a flush-ordering issue, or
something else entirely). Frame this before planning the refactor.
