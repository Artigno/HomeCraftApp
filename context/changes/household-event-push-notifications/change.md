---
change_id: household-event-push-notifications
title: Web push notifications for household events (frontend)
status: preparing
created: 2026-10-12
updated: 2026-10-12
archived_at: null
---

## Notes

Backend (HomeCraftApi, other Claude session, change B-05) is done, impl-reviewed,
deployed. Full contract sent cross-session:

**Auth**: all routes inside `auth:sanctum` (not `household.approved` — a pending
member can register a subscription/preferences before approval).

1. `GET /push/vapid-public-key` → `{"public_key": "..."}` — pass to
   `PushManager.subscribe()`.
2. `POST /push/subscriptions` — body `{"endpoint": "...", "keys": {"p256dh": "...",
   "auth": "..."}}`. Upserts by `endpoint` (re-subscribing same endpoint updates
   in place, no duplicates).
3. `DELETE /push/subscriptions` — body `{"endpoint": "..."}`. Call on
   unsubscribe/logout.
4. `GET /notification-preferences` → `{"shopping_item_added": bool,
   "shopping_finished": bool, "habit_logged": bool, "recipe_added": bool}`.
   Auto-creates all-true defaults on first read.
5. `PATCH /notification-preferences` — body: any subset of those 4 booleans
   (partial update, only send what changed).

**Event types** (same 4 strings, also in push payload's `data.event_type`):
`shopping_item_added`, `shopping_finished`, `habit_logged`, `recipe_added`.

**Server-side behavior to design around**:
- Rapid activity collapses into one push within a 5s window server-side — no
  client-side dedupe needed.
- Acting member never gets notified for their own action.
- Push payload: `{title, body, data: {event_type}}` via standard Web Push.
- Dead/expired subscriptions pruned server-side automatically (404/410) — no
  client action needed.

**Frontend scope** (this change): request notification permission, register
SW push subscription against `/push/subscriptions` using the VAPID key from
endpoint 1, build settings UI against endpoints 4/5, handle/display push in
the service worker (`public/sw.js`).

Full server-side detail if needed: `HomeCraftApi/context/changes/household-event-push-notifications/plan.md`
(Phase 2-6) and `.../reviews/impl-review.md`.
