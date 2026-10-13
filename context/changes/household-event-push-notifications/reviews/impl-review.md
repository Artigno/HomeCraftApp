<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Household Event Push Notifications (Frontend)

- **Plan**: context/changes/household-event-push-notifications/plan.md
- **Scope**: Phase 4 of 4 (full plan)
- **Date**: 2026-10-13
- **Verdict**: NEEDS ATTENTION
- **Findings**: 1 critical, 2 warnings, 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | FAIL |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Findings

### F1 — Logout leaves browser-level push subscription intact (cross-user leakage on shared device)

- **Severity**: CRITICAL
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/routes/account.tsx:310-321 (`onLogout`)
- **Detail**: `onDisableNotifications` (lines 293-308) calls both `apiUnsubscribePush(endpoint)` and `subscription.unsubscribe()`. `onLogout` only calls `apiUnsubscribePush` — never `subscription.unsubscribe()`. The browser-level `PushSubscription` survives logout. If the best-effort server call fails (network error, caught and swallowed per plan's own "offline logout" intent), the device keeps receiving the previous household's push payloads regardless of who logs in next, since the service worker is global to the origin. Even when the server call succeeds, the next user's mount-time check (`getCurrentPushSubscription()`) finds the stale browser subscription and renders the UI as already-subscribed for an account that has no server-side registration. The plan's own stated intent ("so a different user logging in on the same device doesn't inherit a stale subscription") is not fully met.
- **Fix**: In `onLogout`, after the best-effort `apiUnsubscribePush` call, also call `await subscription.unsubscribe()` — matching `onDisableNotifications`'s sequence. Keep it inside the existing try/catch so an unsubscribe failure still doesn't block logout.
- **Decision**: FIXED — added `await subscription.unsubscribe()` in `onLogout`.

### F2 — `notificationclick`'s existing-tab match is exact-URL equality, likely never matches

- **Severity**: WARNING
- **Impact**: MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Pattern Consistency
- **Location**: public/sw.js:73-85
- **Detail**: `targetPath` (`${SCOPE}shopping` etc.) is compared via strict equality (`c.url === targetPath`) against each open client's `c.url`. In an SPA with client-side routing, the live tab's `c.url` can differ from this scope-relative path (trailing slash, query string from TanStack Router, hash) even when it's showing the right page. If it never matches, the "focus existing tab" branch is dead code and every notification click opens a new window instead of reusing an open tab — contradicts the plan's explicit intent ("focus an existing tab... rather than always opening a new one") and Phase 1's manual verification step is exactly where this would be caught.
- **Fix A ⭐ Recommended**: Compare pathnames instead of full URLs — `new URL(c.url).pathname === new URL(targetPath).pathname`.
  - Strength: Robust to query string/hash differences; minimal, local change.
  - Tradeoff: None meaningful — same cost as current comparison.
  - Confidence: HIGH — standard fix for this exact class of SW client-matching bug.
  - Blind spot: Haven't manually triggered a real push-click in a browser to confirm today's behavior is actually broken (vs. the router's current output happening to match exactly).
- **Fix B**: Skip the match, always `client.navigate(targetPath)` on the first open client if any exist, else `openWindow`.
  - Strength: Also fixes the case where the open tab is on the wrong route.
  - Tradeoff: Slightly larger behavior change — reuses *any* open tab, navigating it away from whatever the user was looking at.
  - Confidence: MEDIUM — plan didn't ask for cross-route navigation of an unrelated open tab.
  - Blind spot: Whether navigating away from an unrelated open tab is acceptable UX wasn't discussed in the plan.
- **Decision**: FIXED via Fix A — compare `new URL(c.url).pathname` against `new URL(targetPath).pathname`.

### F3 — `onTogglePreference` doesn't catch thrown errors, breaking the file's error-handling convention

- **Severity**: WARNING
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/routes/account.tsx:248-255
- **Detail**: Every other mutating handler in this file (`onSaveName`, `onRegenerate`, `onApprove`, `onReject`, `onRemoveMember`) wraps its API call in try/catch with a `toast.error(...)` fallback. `onTogglePreference` only handles `!res.ok` — a thrown error (network failure, timeout) is unhandled, the optimistic `setPrefs` update is never reverted, and the caller (`void onTogglePreference(...)`) surfaces no feedback to the user.
- **Fix**: Wrap the `await apiPatchNotificationPreferences(...)` call in try/catch, revert the optimistic state and show the same error toast used elsewhere in this file on failure.
- **Decision**: FIXED — wrapped in try/catch, revert + toast.error on thrown error.

### F4 — DELETE with a JSON body is a new convention in this client

- **Severity**: OBSERVATION
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/api/client.ts:368-383 (`apiUnsubscribePush`)
- **Detail**: Existing DELETE calls (`apiRemoveMember`) send no body; this is the first DELETE with a JSON body in the client. Matches the backend contract as documented in change.md, so not a defect — just worth confirming the backend middleware parses DELETE bodies (already true per the cross-session backend handoff).
- **Fix**: No action needed — informational only.
- **Decision**: SKIPPED — informational observation, no action per report.

### F5 — No `.catch` on the SW's `showNotification(...)` promise

- **Severity**: OBSERVATION
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: public/sw.js:57-70
- **Detail**: If `showNotification` rejects, the chained `.then()` that posts to `BroadcastChannel` never runs, so the live-refresh broadcast silently never fires for that push — low-probability (API rarely rejects) but currently invisible if it happens.
- **Fix**: Add a `.catch(() => {})` or move the broadcast outside the `.then()` chain so it fires regardless of notification-display outcome.
- **Decision**: SKIPPED — informational observation, no action per report.

### F6 — Unguarded bracket lookup on payload-controlled key

- **Severity**: OBSERVATION
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: public/sw.js:76
- **Detail**: `PUSH_ROUTES[eventType]` indexes with a push-payload-supplied string. Risk is low since pushes are VAPID-authenticated and `PUSH_ROUTES` has no inherited-prototype gadget value reachable this way, but it's a prototype-pollution-shaped pattern worth a defensive habit.
- **Fix**: No action needed — informational only; `Object.hasOwn` guard would be more defensive if this pattern is reused elsewhere.
- **Decision**: SKIPPED — informational observation, no action per report.

### F7 — No timeout guard on browser Push API calls

- **Severity**: OBSERVATION
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/routes/account.tsx:62-65, 257-308
- **Detail**: Unlike every backend `fetch` (10s `AbortSignal.timeout`), `navigator.serviceWorker.ready` / `pushManager.subscribe`/`getSubscription` have no timeout guard, so a pathological SW-activation stall could leave `subLoading` stuck indefinitely.
- **Fix**: No action needed for MVP — informational only; add a `Promise.race` timeout if this becomes an observed issue.
- **Decision**: SKIPPED — informational observation, no action per report.

## Automated Verification

- `npx tsc --noEmit` — PASS
- `npm run lint` — PASS (0 errors, 11 pre-existing warnings unrelated to this change)

## Plan Drift Summary

All four phases MATCH the plan exactly — no missing implementation, no unplanned scope creep. All 6 changed files (public/sw.js, public/badge-96.png, src/lib/api/types.ts, src/lib/api/client.ts, src/routes/account.tsx, src/lib/store.tsx) are accounted for in the plan's "Changes Required" sections.
