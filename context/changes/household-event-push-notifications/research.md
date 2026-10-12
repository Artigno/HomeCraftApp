---
date: 2026-10-12T17:44:13+0000
researcher: Claude Sonnet 5
git_commit: 67f7a8f6f95dcda62a25caaeaaeebc3d48aef3ba
branch: main
repository: Artigno/HomeCraftApp
topic: "Frontend wiring for household-event-push-notifications (Web Push)"
tags: [research, codebase, service-worker, push-notifications, pwa]
status: complete
last_updated: 2026-10-12
last_updated_by: Claude Sonnet 5
---

# Research: Frontend wiring for household-event-push-notifications (Web Push)

**Date**: 2026-10-12T17:44:13+0000
**Researcher**: Claude Sonnet 5
**Git Commit**: 67f7a8f6f95dcda62a25caaeaaeebc3d48aef3ba
**Branch**: main
**Repository**: Artigno/HomeCraftApp

## Research Question

Backend (HomeCraftApi, change B-05) shipped a complete Web Push contract
(VAPID key endpoint, subscription CRUD, notification preferences CRUD). What
does the frontend need to understand about its own codebase and about the
Web Push platform APIs before a plan can safely wire this in — specifically:
how is the service worker registered and structured today, what's the
established pattern for synchronous (non-queued) API calls, where does
settings UI for similar preferences live, and what are the hard platform
constraints (iOS Safari, user-gesture requirements) that would shape the UX?

## Summary

The codebase has **zero existing push/notification code** — this is a
greenfield integration. The service worker (`public/sw.js`) is hand-written
(no vite-plugin-pwa/workbox), currently does caching only, and has never done
SW↔page messaging. There IS a clear, reusable precedent for everything else
needed:

- A **synchronous (non-offline-queued) fetch wrapper** idiom already used for
  exactly this class of call (`apiProfile`, `apiRegenerateShareCode`,
  `apiApprovePendingMember` in `src/lib/api/client.ts`) — subscribe/
  unsubscribe/preferences calls should follow this pattern, NOT the
  `enqueue()`/offline-queue idiom used for shopping-item mutations, because a
  `PushSubscription` object is tied to a live browser API object that can't
  be durably replayed later.
- A **settings-UI section pattern** in `src/routes/account.tsx` (Profile /
  Domownicy / Aktywność sections) to model a new "Powiadomienia" section
  after.
- An **SW lifecycle/registration pattern** in `src/routes/__root.tsx:172-206`
  that already handles `self.registration.scope`-relative paths (GH Pages
  subpath support) and uses `sonner`'s `toast()` for SW-related UX — the
  natural place to extend for the permission-request flow and to hook
  `pushManager.subscribe()` after `navigator.serviceWorker.ready`.
- **No badge icon exists** — only `icon-192.png`/`icon-512.png` (maskable,
  for the manifest) and `favicon.ico`. A dedicated small monochrome
  `badge` PNG would need to be added, or the plan can explicitly scope that
  out and reuse `icon-192.png` for both `icon` and `badge`.

Platform constraints that materially shape the plan:
- **iOS Safari requires the PWA to be installed to the home screen first**
  (iOS 16.4+) — Web Push simply doesn't work in a normal Safari tab, even
  post-permission-grant. The UI must detect standalone mode
  (`window.matchMedia('(display-mode: standalone)')` /
  `navigator.standalone`) and show install instructions instead of a broken
  permission prompt when not installed.
- **`Notification.requestPermission()` must be called from a direct
  user-gesture handler** (a button's `onClick`), not from a `useEffect` or
  async callback — Safari/Firefox enforce this.
- VAPID key conversion (base64url → `Uint8Array`) is a small, well-known
  utility with no existing equivalent in this repo — needs to be added once.

## Detailed Findings

### Service worker — current state

- `public/sw.js:1-38` — the entire file. Caching only: `install` pre-caches
  the app shell (`SHELL = [SCOPE, manifest, favicon]`), `activate` purges
  stale cache versions and calls `self.clients.claim()`, `fetch` is
  network-first with cache-fallback for same-origin GETs. **No `push` or
  `notificationclick` listener exists today** — these are net-new additions.
- `public/sw.js:3` — `CACHE = "homesync-v1"`, a non-versioned cache name
  (bumped manually when cache-busting is needed; not relevant to push but
  notable for anyone touching this file).
- `public/sw.js:4` — `SCOPE = self.registration.scope`, used instead of a
  hardcoded `/` specifically because the app also builds for a GH Pages
  subpath (`build:gh-pages` in `package.json`). **Any new code referencing
  icon paths for `showNotification` must do the same** — do not hardcode
  `/icon-192.png`.

### SW registration and lifecycle (main-thread side)

- `src/routes/__root.tsx:172-206` — `RootComponent`'s first `useEffect`.
  Registers the SW at `${import.meta.env.BASE_URL}sw.js` (line 205).
  Listens for the native `controllerchange` event (line 192) to detect a new
  SW version and shows a `sonner` toast with an "Odśwież" action
  (lines 194-203) — deliberately not an automatic reload, to avoid
  interrupting in-progress typing. `hadController` (line 190) guards against
  firing that toast on first install (no prior controller to compare
  against).
- This is the only place `serviceWorker` is touched on the main-thread side
  in the entire codebase (confirmed via subagent search — no other
  `navigator.serviceWorker` references exist).
- **No `postMessage`/`BroadcastChannel`/`self.clients.postMessage` usage
  anywhere in `src/` or `public/sw.js`** — bidirectional SW↔page messaging
  is a completely new pattern for this codebase. This matters if the plan
  wants the page to react live to an incoming push (e.g. refresh a list)
  rather than relying on the next natural sync — there's no existing helper
  to reuse, but also nothing to conflict with.
- The natural hook point for calling
  `navigator.serviceWorker.ready.then(reg => reg.pushManager.subscribe(...))`
  is after registration succeeds in this same effect, or lazily on-demand
  when the user clicks an "enable notifications" button (see the
  user-gesture constraint below — the actual `subscribe()`/
  `requestPermission()` call should NOT happen inside this effect itself).

### API client — synchronous-call idiom vs. offline-queue idiom

Two distinct patterns coexist in `src/lib/api/client.ts`, and picking the
right one matters:

- **Offline-queued (`enqueue()`)** — used for durable data mutations that
  must survive being offline (shopping items, purchases). Backed by a
  localStorage FIFO (`src/lib/api/client.ts:106-121`), replayed by
  `flushQueue()` (`:130-168`) whenever connectivity allows. **Wrong fit for
  push subscriptions**: a `PushSubscription` object/endpoint is tied to the
  current browser session's live push service registration; queuing a stale
  subscribe/unsubscribe call for later replay risks acting on a
  subscription that's no longer valid (the plan notes the backend already
  self-heals via 404/410 pruning, but the frontend still shouldn't durably
  queue these).
- **Synchronous direct-fetch wrappers** — the right fit. Precedent:
  - `apiProfile` (`:280-292`) — `PATCH` with JSON body, returns
    `{ok, status}`.
  - `apiRegenerateShareCode` (`:295-306`) — `POST`, no body, returns a typed
    success/failure union.
  - `apiApprovePendingMember` / `apiRejectPendingMember`
    (`:309-328`) — `POST`, no body, owner-gated.
  - `apiGet<T>` (`:185-202`) — generic `GET` with a fallback value on any
    failure (offline, 401, non-OK), handles `401` via
    `handleUnauthorized()` and `checkPending()` (waitroom-pending-member
    gate) uniformly.
  All of these: explicit `fetch()`, `Accept`/`Content-Type` headers via
  `authHeaders()`, `signal: AbortSignal.timeout(10_000)`. New functions
  `apiGetVapidPublicKey`, `apiSubscribePush`, `apiUnsubscribePush`,
  `apiGetNotificationPreferences`, `apiPatchNotificationPreferences` should
  follow this exact shape — no new wrapper abstraction needed.

### Settings UI precedent

- `src/routes/account.tsx` — the only settings-style page in the app.
  Structured as `<section>` blocks under one `PageHeader`: "Profil"
  (`:195-208`), "Domownicy" (`:210-308`, includes per-member
  `joined_with_code` display and pending-member approval, added in the
  immediately preceding change), "Aktywność" (`:310-331`), then a logout
  button. A new "Powiadomienia" section (toggle switches wired to
  `GET`/`PATCH /notification-preferences`, plus an "Enable notifications"
  button wired to the subscribe flow) fits this same `<section>` convention
  — `h2.text-sm.font-semibold.text-muted-foreground` heading, same spacing
  (`mt-2 flex flex-col gap-...`).
- Toast feedback (`sonner`'s `toast.success`/`toast.error`) is the
  established pattern for async-action feedback throughout this file (every
  handler in `account.tsx` uses it) — the subscribe/unsubscribe/preference-
  save flows should use the same idiom, not a different feedback mechanism.
- `haptic(25)` (`src/lib/store.tsx:390`, imported from a shared haptics
  helper) is used elsewhere in the store for tactile feedback on
  significant user actions (e.g. `completePurchase`) — worth considering
  for the "enable notifications" button tap, though not load-bearing.

### Manifest / icon assets

- `public/manifest.webmanifest:11-24` — only two icons declared,
  `icon-192.png` and `icon-512.png`, both `purpose: "any maskable"`,
  referenced with relative paths (`./icon-192.png`) under `scope: "./"`.
- `public/` contains exactly: `favicon.ico`, `icon-192.png` (192×192),
  `icon-512.png` (512×512), `manifest.webmanifest`, `sw.js`, `robots.txt`.
  **No dedicated `badge` asset** (Chrome's recommendation for
  `Notification`'s `badge` option is a small, mostly-transparent monochrome
  PNG, distinct from the maskable app icon). The plan should either scope in
  adding a new badge asset or explicitly decide to reuse `icon-192.png` for
  both `icon` and `badge` as a v1 simplification.

### Auth / token storage (for subscription ownership)

- `src/lib/auth.ts` — Sanctum bearer token in `localStorage`
  (`getAuthToken`/`setAuthToken`/`clearAuthToken`). `authHeaders()` (used by
  every `api*` function in `client.ts`) presumably reads this to build the
  `Authorization` header — the push endpoints are inside `auth:sanctum` per
  the backend contract, so the existing `authHeaders()` helper is sufficient
  for all five new endpoints with no new auth plumbing.
- Relevant for logout: `clearAuthToken()` (`:22-28`) does NOT currently call
  `DELETE /push/subscriptions` — if a device logs out, its push
  subscription will linger server-side (tied to the old user) unless the
  plan adds that call to the logout flow (`src/routes/account.tsx:183-186`,
  `onLogout`).

### Platform constraints (Web Push API, from external research)

- **VAPID key conversion** — `GET /push/vapid-public-key` returns a
  base64url string; `pushManager.subscribe({applicationServerKey})` needs a
  `Uint8Array`. Standard conversion utility (no library needed):
  ```js
  function urlBase64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
    return outputArray;
  }
  ```
- **iOS Safari**: Web Push requires iOS 16.4+ AND the PWA must be installed
  to the home screen and launched from that icon — it does not work in a
  normal Safari tab even after permission is granted. Detect standalone
  mode via `window.matchMedia('(display-mode: standalone)').matches` (and/or
  the iOS-specific `navigator.standalone === true`) before showing the
  "enable notifications" UI; show "Add to Home Screen first" messaging
  otherwise rather than letting `subscribe()` silently fail.
- **User-gesture requirement**: `Notification.requestPermission()` (and by
  extension the `pushManager.subscribe()` chain that follows it) must be
  invoked synchronously from within a direct user-gesture event handler
  (e.g. a button's `onClick`) — not from a `useEffect`, `setTimeout`, or a
  `.then()` several hops removed from the click. Safari and Firefox enforce
  this; Chrome is currently lenient but the spec direction is the same, so
  the plan should design the "enable notifications" button's handler to do
  the whole permission+subscribe+POST chain inline.
- **Service worker `push`/`notificationclick` handlers** — standard,
  minimal shape (nothing exotic needed):
  ```js
  self.addEventListener('push', (event) => {
    let data = {};
    try { data = event.data ? event.data.json() : {}; }
    catch { data = { title: 'HomeSync', body: event.data ? event.data.text() : '' }; }
    event.waitUntil(self.registration.showNotification(data.title || 'HomeSync', {
      body: data.body || '',
      icon: `${self.registration.scope}icon-192.png`,
      data: data.data || {},
    }));
  });
  self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil(
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
        const existing = list[0];
        return existing ? existing.focus() : self.clients.openWindow(self.registration.scope);
      }),
    );
  });
  ```
  (Icon path adjusted here to use `self.registration.scope`, consistent
  with the existing `SCOPE` convention in `sw.js:4` — the raw snippets from
  external sources use a hardcoded `/icon-192.png`, which would break under
  the GH Pages subpath build.)

## Code References

- `public/sw.js:1-38` — entire current service worker (caching only, no push handlers)
- `src/routes/__root.tsx:172-206` — SW registration + update-toast lifecycle
- `src/lib/api/client.ts:106-121` — `enqueue()` offline-queue (wrong pattern for push subs)
- `src/lib/api/client.ts:130-168` — `flushQueue()`
- `src/lib/api/client.ts:185-202` — `apiGet<T>` generic GET wrapper pattern
- `src/lib/api/client.ts:280-292` — `apiProfile` — synchronous PATCH precedent
- `src/lib/api/client.ts:295-306` — `apiRegenerateShareCode` — synchronous POST precedent
- `src/lib/api/client.ts:309-328` — `apiApprovePendingMember`/`apiRejectPendingMember` — synchronous POST precedent
- `src/lib/auth.ts:1-73` — token storage, `authHeaders()` consumer, `clearAuthToken()` (logout — doesn't unsubscribe push today)
- `src/routes/account.tsx:195-336` — settings-page section pattern to extend ("Powiadomienia" section)
- `public/manifest.webmanifest:11-24` — only icon assets available (no badge icon)
- `package.json` — confirmed no `web-push`/`vite-plugin-pwa`/`workbox-*` dependency exists

## Architecture Insights

- This codebase strictly separates **durable offline-queued mutations**
  (shopping items, purchases — `enqueue()`/`flushQueue()`) from
  **synchronous direct-fetch calls** (profile, share-code, member
  approval — plain `fetch()` wrappers). Push subscribe/unsubscribe and
  notification-preferences read/write belong firmly in the second category;
  mixing them into the offline queue would be a pattern violation with real
  correctness risk (a stale subscribe/unsubscribe replayed later against a
  since-rotated `PushSubscription`).
- The app already has one well-established "field path under GH Pages
  subpath" discipline (`self.registration.scope` in `sw.js`,
  `import.meta.env.BASE_URL` in `__root.tsx`) that every new path reference
  (icon URLs in `showNotification`, any `clients.openWindow` target) must
  continue to respect — this has bitten past work before (see
  `shopping-live-sync-no-poll/frame.md`'s SW-scope discussion) and is worth
  calling out explicitly in the plan's "Changes Required" so it isn't missed.
- Settings-page sections in `account.tsx` are intentionally uniform
  (`<section><h2>...</h2>...</section>`) — a new "Powiadomienia" section
  should match that shape rather than introducing a new settings-page
  layout convention.

## Historical Context (from prior changes)

- `context/changes/shopping-live-sync-no-poll/frame.md:112-118` — the only
  other place in `context/changes/**`/`context/archive/**` that discusses
  the service worker in any depth, in the context of ruling out the SW as
  the cause of a sync-hang bug (confirmed unrelated — the SW's `fetch`
  handler was read and cleared). No prior push/notification/PWA-installability
  work exists in this repo's change history — this is genuinely new ground.
- The immediately preceding change,
  `context/archive/...-household-member-login-codes` (frontend side landed
  as commit `052d1ae`), established the current "Domownicy" section shape
  in `account.tsx` that this change's settings UI should sit alongside.

## Related Research

- None — no prior `research.md` in this repo touches push notifications or
  service-worker messaging.

## Open Questions

- **Badge icon**: add a new dedicated monochrome asset, or explicitly scope
  v1 to reuse `icon-192.png` for both `icon` and `badge`? (Low stakes,
  cosmetic — a plan decision, not a research gap.)
- **Logout unsubscribe**: should `clearAuthToken()`'s call site
  (`account.tsx:183-186`, `onLogout`) also call
  `DELETE /push/subscriptions` for the current device's endpoint before
  clearing the token? The backend contract says "call on unsubscribe/
  logout" — this needs an explicit decision in the plan, since today's
  `onLogout` doesn't await anything async.
- **In-app live reaction to a received push**: do we want the open app tab
  to react immediately (e.g. refetch the shopping list) when a push lands
  while the tab is foregrounded, via a new `postMessage`/`BroadcastChannel`
  channel from the SW's `push` handler to the page? This is a genuinely new
  pattern for the codebase (confirmed above) and should be an explicit
  scope decision — "not doing this in v1, rely on existing sync triggers"
  is a reasonable default per the backend's note that acting members never
  get notified for their own actions, and other members already have
  `visibilitychange`/focus-triggered incremental sync.
- **iOS not-installed UX copy**: exact Polish-language messaging for "add
  to home screen first" is a plan/implementation detail, not something this
  research needs to resolve.
