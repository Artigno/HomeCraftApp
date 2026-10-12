# Household Event Push Notifications (Frontend) — Plan Brief

> Full plan: `context/changes/household-event-push-notifications/plan.md`
> Research: `context/changes/household-event-push-notifications/research.md`

## What & Why

Backend (HomeCraftApi, change B-05) shipped a complete Web Push contract —
VAPID key, subscription CRUD, preferences CRUD, server-side event
collapsing and self-exclusion. The frontend needs to request permission,
subscribe, let users manage preferences, and handle incoming pushes so
household members actually get notified when someone else adds a shopping
item, finishes shopping, logs a habit, or adds a recipe.

## Starting Point

Zero existing push/notification code — fully greenfield. The service
worker (`public/sw.js`) only does app-shell caching today. The codebase
does have reusable precedent for everything else: a synchronous (non-
offline-queued) fetch-wrapper idiom, a uniform settings-section pattern in
`account.tsx`, and a domain-agnostic `syncFromBackend()` that already
pulls every data type in one pass.

## Desired End State

A user opens Account → "Powiadomienia", toggles which of the 4 event
types they want, and taps "Włącz powiadomienia" once. From then on they
get a native OS notification when another household member does one of
those 4 things, clicking it lands them on the relevant screen, and if they
already have the app open it silently refreshes within seconds — no
manual reload needed.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Badge icon | Add dedicated `badge-96.png` | User wants correct Android status-bar look over zero extra work | Plan (user chose over reusing icon-192) |
| Logout | Call `DELETE /push/subscriptions` before clearing token | Stops a stale subscription tied to the previous user from lingering on a shared device | Plan |
| Live reaction | Add `BroadcastChannel` for open-tab resync | User wants immediate refresh, not a wait for the next focus/visibilitychange | Plan |
| iOS non-standalone | Show "add to home screen" instructions | Push silently fails outside standalone on iOS — instructions beat a dead button | Plan |
| Opt-in surface | Settings-page only, no proactive banner | Matches the user-gesture requirement cleanly and keeps scope minimal | Plan |
| Notification click target | Route by `event_type` (`/shopping`, `/`, `/cookbook`) | Lands the user where the change actually is, not just the app root | Plan |
| API call shape | Synchronous direct-`fetch()`, not `enqueue()` | A `PushSubscription` is tied to the live session; durable offline-replay risks acting on a stale one | Research |

## Scope

**In scope:**
- SW `push`/`notificationclick` handlers + `BroadcastChannel` broadcast
- 5 new API client functions + `NotificationPreferences` type
- "Powiadomienia" settings section: 4 toggles, subscribe/unsubscribe button, iOS messaging
- Logout-time unsubscribe
- Open-tab live-refresh via `BroadcastChannel` receiver

**Out of scope:**
- Proactive enable-notifications banner/prompt
- Generic SW↔page messaging abstraction (one narrow channel only)
- Client-side push dedup/batching (backend already collapses within 5s)
- In-app notification history/center
- Automated tests (none exist in this repo)

## Architecture / Approach

Four independent phases: (1) service worker gets push-handling and a
broadcast-on-receive; (2) API client gets the five wrapper functions,
following the existing synchronous-fetch idiom exactly; (3) settings UI
wires those functions into account.tsx, including platform detection and
logout cleanup; (4) `store.tsx`'s existing mount effect gains one more
listener (the `BroadcastChannel` receiver) that calls the
already-existing, already-domain-agnostic `syncFromBackend()` — no new
fetch logic needed there at all.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Service worker | push/notificationclick handlers, click routing, broadcast, badge asset | Badge asset must be generated at implementation time (no image tool in repo today) |
| 2. API client | 5 wrapper functions + type | Low risk — mechanical, matches existing precedent exactly |
| 3. Settings UI | Powiadomienia section, subscribe flow, iOS messaging, logout unsubscribe | User-gesture requirement — permission request must stay inline in the click handler, not hoisted into an effect |
| 4. Live-refresh | BroadcastChannel receiver → syncFromBackend | None significant — reuses existing, already-working function |

**Prerequisites:** Backend (B-05) already live in prod — confirmed by the
cross-session contract. No other blockers.
**Estimated effort:** ~2 sessions across 4 phases.

## Open Risks & Assumptions

- Badge asset generation depends on whatever image tooling is available
  at implementation time (PIL confirmed present in this environment via
  `python3`); if unavailable, reusing `icon-192.png` as a fallback badge
  is an acceptable last resort, just not the first choice.
- iOS install-to-home-screen detection (`navigator.standalone`) is a
  documented but informal API — behavior should be spot-checked on a real
  iOS device during Phase 3 manual verification, not just trusted from
  research.
- Multi-device/multi-account manual testing (Phase 3/4 and the overall
  Testing Strategy) requires at least two real devices or browser
  profiles logged in as different household members — flag this early so
  it's available when manual verification time comes.

## Success Criteria (Summary)

- A household member's shopping/habit/recipe action produces a correctly
  routed, correctly titled native notification on every other member's
  subscribed device, respecting their individual preference toggles.
- An open tab resyncs within seconds of a push, with no manual reload.
- Logging out or explicitly disabling notifications reliably stops them.
