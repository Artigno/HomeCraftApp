---
change_id: shopping-live-sync-no-poll
title: Shopping items don't sync without a hard refresh
status: impl_reviewed
created: 2026-10-09
updated: 2026-10-09
archived_at: null
---

## Notes

Follow-up to `shopping-sync-queue-refactor` (epoch-sentinel full-resync fix,
shipped: HomeCraftApi `0d37544`, HomeCraftApp `8075d3e`). User confirmed that
fix via manual testing, but reports sync still requires a hard refresh to
pick up changes — expected it to work "na biezaco" (live/on the fly).

Current trigger surface (`src/lib/store.tsx:239-266`): `syncFromBackend()`
fires on mount, on auth, and on `visibilitychange`/`focus`. There is no
polling interval, no websocket, no push mechanism. If a tab stays focused/
visible the whole time (no tab-switch, no app backgrounding), nothing
re-syncs until a manual reload.

This is distinct from the epoch-sentinel bug already fixed — that bug made
*every* full resync wipe the list; this is about *when* a resync is
triggered at all. Frame before planning: confirm whether the fix is a
periodic polling interval, a push mechanism, or something narrower (e.g.
candidate 3 from `shopping-sync-queue-refactor/frame.md` — incremental
cursor's strict `>` comparison permanently excluding same-second writes —
logged there as an Open Risk, not yet investigated).
