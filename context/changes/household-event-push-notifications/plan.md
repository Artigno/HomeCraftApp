# Household Event Push Notifications (Frontend) Implementation Plan

## Overview

Wire the frontend to the already-shipped backend contract (B-05,
HomeCraftApi) for Web Push: request notification permission, register a
push subscription against the backend, let the user manage per-event-type
preferences, and handle incoming pushes (both as native OS notifications
and as a live in-app resync trigger) in the service worker.

## Current State Analysis

- `public/sw.js:1-38` — hand-written SW, caching only. No `push` or
  `notificationclick` listener. Uses `self.registration.scope` (not a
  hardcoded `/`) for every path reference, because the app also builds for
  a GH Pages subpath (`build:gh-pages` in `package.json`).
- `src/routes/__root.tsx:172-206` — the only place `serviceWorker` is
  touched on the main-thread side: registers `sw.js`, listens for
  `controllerchange` to show an update toast. No `postMessage`/
  `BroadcastChannel` usage anywhere in the codebase today.
- `src/lib/api/client.ts` — two call idioms coexist: durable
  `enqueue()`/`flushQueue()` (`:106-168`, for shopping-item mutations that
  must survive being offline) and synchronous direct-`fetch()` wrappers
  (`apiProfile` `:280-292`, `apiRegenerateShareCode` `:295-306`,
  `apiApprovePendingMember`/`apiRejectPendingMember` `:309-328`). Push
  subscribe/unsubscribe and preferences read/write belong in the second
  category — a `PushSubscription` is tied to the current browser session's
  live push registration, so queuing it for delayed offline replay risks
  acting on a stale/rotated subscription.
- `src/lib/auth.ts:22-28` — `clearAuthToken()` is synchronous today and
  does not touch push subscriptions.
- `src/routes/account.tsx:195-336` — the only settings page. Uniform
  `<section><h2 class="text-sm font-semibold text-muted-foreground">...`
  blocks (Profil / Domownicy / Aktywność), each with its own local state
  and `toast.success`/`toast.error` feedback via `sonner`.
- `src/lib/store.tsx:104-140` — `syncFromBackend()` already fetches
  **everything** (`tasks`, `recipes`, `shopping`, `purchases`, `tins`) in
  one `Promise.all` pass, regardless of which domain changed. The existing
  mount effect (`:239-269`) already calls
  `syncFromBackend({ incremental: true })` on `visibilitychange`/`focus`.
  This means "react to an incoming push while the tab is open" needs no
  new per-event-type fetch logic — just another call site for the same
  function.
- `public/manifest.webmanifest:11-24` — only `icon-192.png`/`icon-512.png`
  exist (maskable, for the app icon). No dedicated small monochrome
  `badge` asset.
- Routes confirmed for click-through targets: `/` (maintenance/habit
  dashboard, `src/routes/index.tsx:28` — title "HomeSync — konserwacja
  domu"), `/shopping` (`src/routes/shopping.tsx:53`), `/cookbook`
  (`src/routes/cookbook.index.tsx:12` — title "Przepisy — HomeSync").
- `src/components/ui/switch.tsx` exists (shadcn `Switch`, standard
  `checked`/`onCheckedChange` props) but is currently unused anywhere in
  the app — first real use will be the four preference toggles.
- No test framework configured in this repo; verification is
  typecheck + lint + manual, consistent with every prior change.

## Desired End State

A user can open Account → "Powiadomienia" and toggle any of the four
event-type preferences (persisted via `PATCH /notification-preferences`).
The same section has an "Włącz powiadomienia" button that — on click —
requests `Notification` permission, subscribes via `PushManager`, and
registers the subscription with the backend (`POST /push/subscriptions`);
once subscribed, the button becomes "Wyłącz powiadomienia" and calls
`DELETE /push/subscriptions` on click. Logging out also calls `DELETE
/push/subscriptions` for the current device before clearing the token. On
iOS Safari running outside of a home-screen install, the section shows an
instructional message instead of the button (push is unsupported there,
full stop). A received push shows a native OS notification (via the
service worker's `push` handler) and, if the app has any tab open at the
time, triggers an immediate `syncFromBackend({ incremental: true })` in
that tab via a new `BroadcastChannel`. Clicking a notification focuses an
existing tab (or opens one) and navigates it to the route matching the
event type.

**Verification**: subscribe on a device, trigger each of the four backend
event types from another household member's account, confirm a native
notification appears with the correct title/body, confirm clicking it
lands on the right route, confirm an already-open tab silently refreshes
its data within a couple seconds of the push arriving (visible via a
network request in dev tools, not just by the push itself). Toggle a
preference off, confirm that event type's pushes stop arriving while
others continue. Log out, confirm (via backend inspection or the next
subscribe attempt) the subscription was removed.

### Key Discoveries:

- `src/lib/store.tsx:104-140` — `syncFromBackend` is domain-agnostic; no
  new fetch logic needed for the live-refresh phase, only a new trigger.
- `src/lib/api/client.ts:280-328` — exact synchronous-fetch shape to copy
  for all five new `api*` functions.
- `public/sw.js:4` — `SCOPE = self.registration.scope` convention; every
  new path reference (notification icon/badge, `clients.openWindow`
  target) must build off this, not a hardcoded path, to keep working under
  the GH Pages subpath build.
- `src/routes/account.tsx` section pattern — new "Powiadomienia" section
  slots in after "Domownicy", before "Aktywność", matching the existing
  `<section>`/`<h2>` shape exactly.

## What We're NOT Doing

- Not adding a proactive "enable notifications" banner/prompt on first
  login — opt-in only, discovered via Account → Powiadomienia (user
  decision, confirmed during planning).
- Not building a generic SW↔page messaging abstraction — one narrow
  `BroadcastChannel` channel, one message shape, one listener. No retry/
  ack semantics; a missed message just means the tab resyncs on its next
  natural trigger (focus/visibilitychange) instead of immediately, which
  is a no-worse-than-today fallback.
- Not deduping or batching pushes client-side — the backend already
  collapses rapid activity into one push per 5s window.
- Not building a custom in-app notification center / history list — only
  native OS notifications plus the existing toast system for action
  feedback (subscribe/unsubscribe/preference-save results).
- Not handling browsers without `PushManager` support with a polyfill —
  the "Enable notifications" button and section are simply hidden when
  `!("serviceWorker" in navigator) || !("PushManager" in window)`.
- Not adding automated/unit tests — no test framework exists in this repo;
  manual verification only, consistent with every prior change.

## Implementation Approach

Four phases, each independently verifiable:

1. **Service worker** gets the new `push`/`notificationclick` listeners
   plus a `BroadcastChannel` post on every push, and a new badge asset is
   added to `public/`.
2. **API client** gets the five new synchronous wrapper functions and a
   `NotificationPreferences` type.
3. **Settings UI** wires those functions into a new "Powiadomienia"
   section in `account.tsx`, including the iOS-unsupported-context
   messaging and the logout-time unsubscribe.
4. **Live-refresh** adds the `BroadcastChannel` *receiver* in
   `store.tsx`'s existing mount effect, calling the already-domain-agnostic
   `syncFromBackend({ incremental: true })`.

## Critical Implementation Details

### Timing & lifecycle

`Notification.requestPermission()` (and the `pushManager.subscribe()` call
that follows it) must execute synchronously within the "Włącz
powiadomienia" button's `onClick` handler — not inside a `useEffect`,
`setTimeout`, or a `.then()` several hops removed from the click. Safari
and Firefox reject/ignore permission requests not tied to a direct user
gesture; this is why the whole permission→subscribe→register chain must
live in one inline async handler attached directly to the button.

### Platform detection

iOS Safari supports Web Push only when the PWA is installed to the home
screen and launched from that icon (iOS 16.4+); it doesn't work in a plain
browser tab at all, even post-permission-grant. Detect "running installed"
via `window.matchMedia("(display-mode: standalone)").matches ||
(navigator as unknown as { standalone?: boolean }).standalone === true`.
Detect "is iOS" via a `userAgent` check (`/iPhone|iPad|iPod/`). When iOS is
true and standalone is false, render the instructional message instead of
the button — this is the one combination where the button would otherwise
silently fail.

### Badge asset generation

`public/badge-96.png` doesn't exist yet and isn't derivable from existing
tooling in this repo (no ImageMagick/sharp dependency). Generate it as a
one-off at implementation time — a 96×96 transparent-background PNG with a
simple white monochrome silhouette derived from the existing app icon
(`public/icon-512.png`), using whatever image tool is available in the
implementation environment (e.g. Python's PIL, if present, or an
equivalent). This is a generated asset, not hand-authored code — no
specific tool is mandated, only the output shape (96×96, transparent,
monochrome white).

## Phase 1: Service worker — push handling, click routing, live-refresh broadcast

### Overview

Give the service worker the ability to receive a push, show a native
notification, route a click to the right in-app page, and notify any open
tab so it can resync immediately.

### Changes Required:

#### 1. `push` event listener

**File**: `public/sw.js`

**Intent**: Parse the push payload and show a native notification, using
the scope-relative icon/badge paths (consistent with the existing `SCOPE`
constant), then broadcast the event to any open tab.

**Contract**: Payload shape from the backend is
`{title, body, data: {event_type}}` (per the backend contract). Add a
`self.addEventListener("push", ...)` that:
- Safely parses `event.data.json()` (try/catch, falling back to a generic
  title/body if parsing fails or `event.data` is absent).
- Calls `event.waitUntil(self.registration.showNotification(title, {
  body, icon: `${SCOPE}icon-192.png`, badge: `${SCOPE}badge-96.png`, data
  }))`.
- Also posts the parsed payload to all open clients via a
  `BroadcastChannel("homesync-push")` (or `self.clients.matchAll()` +
  `client.postMessage(...)` — either works; `BroadcastChannel` is simpler
  since the page-side listener doesn't need a `MessagePort` reference).
  Wrap this in the same `event.waitUntil` as the notification so the SW
  isn't killed mid-broadcast.

#### 2. `notificationclick` event listener

**File**: `public/sw.js`

**Intent**: Close the notification and route to the page matching the
event type, focusing an existing tab if one is open rather than always
opening a new one.

**Contract**: Add `self.addEventListener("notificationclick", ...)` that
closes the notification (`event.notification.close()`) then, inside
`event.waitUntil`, resolves a target path from `event.notification.data.
event_type` via a small lookup (`shopping_item_added` and
`shopping_finished` → `` `${SCOPE}shopping` ``, `habit_logged` → `SCOPE`,
`recipe_added` → `` `${SCOPE}cookbook` ``, with `SCOPE` itself as the
fallback for an unrecognized/missing event type), then either focuses the
first matching open client (`self.clients.matchAll({type: "window",
includeUncontrolled: true})`, `client.focus()`) or opens a new one
(`self.clients.openWindow(targetPath)`) if none exist.

#### 3. New badge asset

**File**: `public/badge-96.png` (new)

**Intent**: Provide the small monochrome icon Chrome/Android use for the
notification's status-bar badge, distinct from the maskable app icon.

**Contract**: 96×96 PNG, transparent background, white monochrome
silhouette derived from `public/icon-512.png`. See "Critical
Implementation Details → Badge asset generation" above.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npx tsc --noEmit`
- Lint passes: `npm run lint`

#### Manual Verification:

- With the dev server's SW registered, manually trigger a test push via
  the browser's devtools (Application → Service Workers → Push) with a
  `{title, body, data: {event_type: "shopping_item_added"}}` payload —
  confirm a native notification appears with the icon/badge visible.
- Click the notification — confirm it opens/focuses a tab and lands on
  `/shopping` (or the GH-Pages-subpath equivalent).
- Repeat with `habit_logged` → lands on `/`, `recipe_added` → lands on
  `/cookbook`.

**Implementation Note**: After completing this phase and all automated
verification passes, pause here for manual confirmation from the human
that the manual testing was successful before proceeding to the next
phase.

---

## Phase 2: API client — subscribe, preferences, types

### Overview

Add the five synchronous wrapper functions the backend contract needs, plus
the shared `NotificationPreferences` type.

### Changes Required:

#### 1. `NotificationPreferences` type

**File**: `src/lib/api/types.ts`

**Intent**: Mirror the backend's preferences shape for typed use in the
settings UI.

**Contract**: `export interface NotificationPreferences { shopping_item_added: boolean; shopping_finished: boolean; habit_logged: boolean; recipe_added: boolean; }`

#### 2. Five new synchronous API wrappers

**File**: `src/lib/api/client.ts`

**Intent**: Cover the backend's five push/preferences endpoints, following
the exact synchronous direct-`fetch()` shape already used by `apiProfile`/
`apiRegenerateShareCode`/`apiApprovePendingMember` — not the
`enqueue()`/offline-queue idiom (see Current State Analysis for why).

**Contract**:
- `apiGetVapidPublicKey(): Promise<string | null>` — `GET
  /push/vapid-public-key`, returns `data.public_key` on success, `null` on
  any failure (mirrors `apiGet`'s fallback-on-failure shape, but this one
  has no natural fallback value other than `null` since there's no cached
  local copy to fall back to).
- `apiSubscribePush(subscription: { endpoint: string; keys: { p256dh: string; auth: string } }): Promise<{ ok: boolean; status: number }>`
  — `POST /push/subscriptions`, JSON body is the subscription object
  as-is (the caller passes `pushSubscription.toJSON()`'s relevant fields).
- `apiUnsubscribePush(endpoint: string): Promise<{ ok: boolean; status: number }>`
  — `DELETE /push/subscriptions`, JSON body `{ endpoint }`.
- `apiGetNotificationPreferences(): Promise<NotificationPreferences | null>`
  — `GET /notification-preferences`, `null` on failure.
- `apiPatchNotificationPreferences(patch: Partial<NotificationPreferences>): Promise<{ ok: boolean; status: number }>`
  — `PATCH /notification-preferences`, JSON body is `patch` as-is (partial
  update, only send what changed — matches the backend's `sometimes`
  validation).

All five follow the existing `AbortSignal.timeout(10_000)` + `authHeaders()`
+ `Accept`/`Content-Type` header convention from the neighboring functions.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npx tsc --noEmit`
- Lint passes: `npm run lint`

#### Manual Verification:

- N/A — this phase has no independently-observable UI; verified
  transitively by Phase 3's manual checks.

**Implementation Note**: After completing this phase and all automated
verification passes, pause here for manual confirmation from the human
that the manual testing was successful before proceeding to the next
phase.

---

## Phase 3: Settings UI — Powiadomienia section

### Overview

Add the "Powiadomienia" section to `account.tsx`: four preference toggles,
an enable/disable-notifications button with the full permission→subscribe→
register chain, iOS-unsupported-context messaging, and logout-time
unsubscribe.

### Changes Required:

#### 1. New "Powiadomienia" section

**File**: `src/routes/account.tsx`

**Intent**: Let the user manage per-event-type push preferences and
subscribe/unsubscribe this device, following the existing settings-page
section pattern exactly (same `<section><h2>` shape as "Domownicy").

**Contract**: New section placed after "Domownicy", before "Aktywność".
On mount, load `apiGetNotificationPreferences()` into local state and (if
push is supported and the device isn't the iOS-non-standalone case) check
`navigator.serviceWorker.ready` → `registration.pushManager.
getSubscription()` to determine the current subscribed/unsubscribed
button state. Render:
- If `!("serviceWorker" in navigator) || !("PushManager" in window)`: omit
  the section entirely.
- Else if iOS and not standalone (see Critical Implementation Details →
  Platform detection): show an instructional message ("Aby włączyć
  powiadomienia na iPhonie/iPadzie, najpierw dodaj aplikację do ekranu
  głównego...") instead of the button; preference toggles still render
  (harmless to set ahead of subscribing).
- Else: render the four `Switch` toggles (one per
  `NotificationPreferences` key, each `onCheckedChange` calling
  `apiPatchNotificationPreferences({ [key]: value })` and updating local
  state optimistically, with a `toast.error` + revert on failure — same
  shape as every other handler in this file) and a button toggling
  between "Włącz powiadomienia" / "Wyłącz powiadomienia" based on
  subscription state.
- Enable handler (inline `onClick`, per the user-gesture requirement):
  request `Notification.requestPermission()` → if granted, fetch the
  SW registration via `navigator.serviceWorker.ready`, call `
  registration.pushManager.subscribe({ userVisibleOnly: true,
  applicationServerKey: <converted VAPID key> })` (VAPID key fetched via
  `apiGetVapidPublicKey()` and converted via a small
  `urlBase64ToUint8Array` helper — see research.md for the standard
  implementation), then `apiSubscribePush(subscription.toJSON())`. On any
  failure, `toast.error(...)`; on success, `toast.success(...)` and flip
  the button state.
- Disable handler: fetch the current subscription via
  `registration.pushManager.getSubscription()`, call
  `apiUnsubscribePush(subscription.endpoint)`, then
  `subscription.unsubscribe()` (browser-side), flip button state.

#### 2. Logout unsubscribe

**File**: `src/routes/account.tsx`

**Intent**: Clear this device's push subscription before clearing the
auth token, so a different user logging in on the same device doesn't
inherit a stale subscription tied to the previous account.

**Contract**: `onLogout` (`:183-186`) becomes `async`: before calling
`clearAuthToken()`, best-effort fetch the current subscription (if push
was supported and the SW is ready) and call `apiUnsubscribePush(endpoint)`
if one exists — swallow any failure (offline logout shouldn't be blocked
by this), then proceed with the existing `clearAuthToken()` +
`router.navigate(...)` regardless of outcome. The button's `onClick` wraps
this in `void onLogout()` same as other async handlers in this file.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npx tsc --noEmit`
- Lint passes: `npm run lint`

#### Manual Verification:

- On a supported desktop browser: open Account, see the four toggles
  (all on by default) and an "Włącz powiadomienia" button.
- Click the button, grant permission in the browser prompt — button
  flips to "Wyłącz powiadomienia", success toast shown.
- Toggle one preference off, reload the page — confirm it's still off
  (persisted server-side).
- Click "Wyłącz powiadomienia" — button flips back, confirm (via a second
  subscribe attempt or backend check) the subscription was removed.
- Log out — confirm (via backend check) the subscription tied to this
  device was removed as part of logout, not just via the explicit disable
  button.
- On iOS Safari, not installed to home screen: confirm the instructional
  message appears instead of the button, and the four toggles still work.

**Implementation Note**: After completing this phase and all automated
verification passes, pause here for manual confirmation from the human
that the manual testing was successful before proceeding to the next
phase.

---

## Phase 4: Live-refresh on push while a tab is open

### Overview

When a push arrives while at least one tab has the app open, trigger an
immediate incremental resync in that tab instead of waiting for the next
`visibilitychange`/`focus` event.

### Changes Required:

#### 1. `BroadcastChannel` receiver in the existing mount effect

**File**: `src/lib/store.tsx`

**Intent**: React to the service worker's push broadcast (Phase 1) by
calling the already-domain-agnostic `syncFromBackend` — no new per-event-
type logic needed, since that function already pulls every domain
(`tasks`/`recipes`/`shopping`/`purchases`/`tins`) in one pass.

**Contract**: Inside the existing mount `useEffect` (`:239-269`, alongside
the `visibilitychange`/`focus`/`homesync:auth`/`homesync:queue` listener
registrations), open a `new BroadcastChannel("homesync-push")`, add an
`onmessage` handler that calls `void syncFromBackend({ incremental: true
})` (ignore the message payload entirely — any push means "something
changed, resync"), and close the channel in the effect's cleanup alongside
the existing `removeEventListener` calls. Guard with the same
`isAuthenticated()` check `syncFromBackend` itself already does internally
— no extra guard needed here since `syncFromBackend` is a no-op when not
authenticated.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npx tsc --noEmit`
- Lint passes: `npm run lint`

#### Manual Verification:

- With the app open in one tab (visible, focused) and a second household
  member's action triggering a push (e.g. adding a shopping item from a
  second account/device), confirm the open tab's shopping list updates
  within a couple seconds — visible as a new `/shopping-items` (or
  equivalent) request firing in the Network tab — without the user
  switching tabs or refreshing.
- Repeat with the tab in the background (not focused) — confirm the
  native OS notification still appears (Phase 1) even without this
  broadcast being "seen" by the user.

**Implementation Note**: After completing this phase and all automated
verification passes, pause here for manual confirmation from the human
that the manual testing was successful before proceeding to the next
phase.

---

## Testing Strategy

### Unit Tests:

- None added — no test framework in this repo; manual verification only.

### Integration Tests:

- None added.

### Manual Testing Steps:

1. Subscribe on Device A. From Device B (different household member),
   add a shopping item, mark an item done ("Zakończ zakupy"), log a habit,
   and add a recipe — confirm Device A gets a native notification for
   each event type it has enabled, with correct title/body and routing on
   click.
2. On Device A, toggle one preference off; repeat its corresponding
   action from Device B — confirm that notification no longer arrives
   while the others still do.
3. With Device A's tab open and focused, repeat step 1 — confirm the open
   tab silently resyncs (visible in Network tab) in addition to the
   native notification.
4. Unsubscribe via the settings button; repeat step 1 — confirm no
   notification arrives on Device A.
5. Subscribe again, then log out on Device A; log back in as a different
   household member on the same device/browser — confirm no stale
   notifications meant for the previous user arrive.
6. On an iOS device, open the site in plain Safari (not installed) —
   confirm the instructional message appears instead of a broken/silent
   permission prompt. Install to home screen, relaunch from the icon,
   confirm the button now appears and works.

## Performance Considerations

None beyond one additional `BroadcastChannel` message per received push
(negligible) and the existing cost of `syncFromBackend`'s `Promise.all`
fetch, already triggered at the same frequency by `visibilitychange`/
`focus` today.

## Migration Notes

None — no data model or local-storage schema changes. Existing users will
see the new "Powiadomienia" section on their next visit with all four
preferences defaulting to `true` server-side (backend auto-creates on
first `GET`), and no subscription until they explicitly opt in.

## References

- Research: `context/changes/household-event-push-notifications/research.md`
- Backend contract: cross-session message from `homecraftapi-30` (change
  B-05, `HomeCraftApi/context/changes/household-event-push-notifications/`)
- Synchronous-fetch pattern precedent: `src/lib/api/client.ts:280-328`
- Settings-section pattern precedent: `src/routes/account.tsx:195-336`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a
> step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Service worker — push handling, click routing, live-refresh broadcast

#### Automated

- [x] 1.1 Typecheck passes: `npx tsc --noEmit` — c1fda29
- [x] 1.2 Lint passes: `npm run lint` — c1fda29

#### Manual

- [x] 1.3 Test push via devtools shows native notification with icon/badge
- [x] 1.4 Click routes to `/shopping` for shopping event types
- [x] 1.5 Click routes to `/` for habit_logged, `/cookbook` for recipe_added

### Phase 2: API client — subscribe, preferences, types

#### Automated

- [x] 2.1 Typecheck passes: `npx tsc --noEmit` — f1a43f4
- [x] 2.2 Lint passes: `npm run lint` — f1a43f4

### Phase 3: Settings UI — Powiadomienia section

#### Automated

- [x] 3.1 Typecheck passes: `npx tsc --noEmit` — 06042ff
- [x] 3.2 Lint passes: `npm run lint` — 06042ff

#### Manual

- [x] 3.3 Toggles visible, default on, persist across reload
- [x] 3.4 Enable button requests permission, subscribes, flips state
- [x] 3.5 Disable button unsubscribes, flips state back
- [x] 3.6 Logout removes this device's subscription server-side
- [x] 3.7 iOS non-standalone shows instructional message, not the button

### Phase 4: Live-refresh on push while a tab is open

#### Automated

- [x] 4.1 Typecheck passes: `npx tsc --noEmit`
- [x] 4.2 Lint passes: `npm run lint`

#### Manual

- [x] 4.3 Open/focused tab resyncs within seconds of a push arriving
- [x] 4.4 Backgrounded tab still shows the native notification
