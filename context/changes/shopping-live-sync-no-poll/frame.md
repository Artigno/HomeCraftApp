# Frame Brief: "Sync still broken" after the epoch-sentinel fix

> Framing step before /10x-plan. This document captures what is *actually*
> at issue, separated from what was initially assumed.

## Reported Observation

After the `shopping-sync-queue-refactor` epoch-sentinel fix shipped and was
manually verified (hard refresh preserves toggled/added items — confirmed),
the user reported sync via the API/DB "still doesn't work right" — framed
initially as "needs a hard refresh to work; should work live."

## Initial Framing (preserved)

- **User's stated cause or approach**: sync should happen "na bieżąco"
  (live/on the fly) without a manual refresh.
- **User's proposed direction**: none stated — asked to frame before
  planning.
- **Pre-dispatch narrowing**: initial answer said the symptom occurs in the
  *same tab, same action* (not cross-device), and that the second
  tab/device was continuously focused/visible throughout — ruling out the
  "no polling trigger" framing a `visibilitychange`/`focus`-only sync model
  would predict. Follow-up narrowing (outside the formal pre-dispatch
  round, but decisive) revealed the actual symptom: a sync-status banner
  ("N zmian czeka na synchronizację z serwerem", `PageHeader.tsx:25-31`)
  whose count only grows, never shrinks.

## Dimension Map

The observation ("sync status never clears, grows forever") could
originate at any of these dimensions in the queue→flush→dequeue chain
(`src/lib/api/client.ts`):

1. **No polling/push trigger** — sync only fires on mount/auth/focus/
   visibilitychange, never periodically. ← user's initial framing
2. **`navigator.onLine` false positive** — `flushQueue()` early-returns
   with zero attempts if the browser's online signal is wrong.
3. **FIFO head-of-line blocking** — a request at the front of the queue
   that keeps failing (`break` on 401/403-pending/5xx/exception) blocks
   every request behind it indefinitely, since `flushQueue()` always
   starts from `queue[0]`.
4. **Dead-lettering not firing** — a 4xx should `recordFailed` and still
   dequeue; if that path were broken, failed items would also pile up.

## Hypothesis Investigation

| Hypothesis | Evidence | Verdict |
| --- | --- | --- |
| 1: No polling trigger | User confirmed same-tab, continuously-focused scenario — `visibilitychange`/`focus` never needed to fire for this repro, so a missing poll interval can't explain it. The complaint also turned out to be about a status banner, not the data itself. | NONE |
| 2: `navigator.onLine` false positive | User ran `navigator.onLine` in console during the test: returned `true`. `flushQueue()`'s only early-return guard is `!isBrowser() \|\| !navigator.onLine` (`client.ts:131`) — ruled out directly. | NONE |
| 3: FIFO head-of-line blocking | User ran `JSON.parse(localStorage.getItem('homesync.request-queue')).length` → **13**, and inspected `[0]`: `{"method":"DELETE","path":"/shopping-items/5af1cc82-0cfe-4f0d-8277-bd2518975c53","queued_at":"2026-10-09T11:32:54.761Z"}`. A fresh action produced **no new network request at all** (Network tab, filtered for the new action's path) — exactly what `flushQueue()` (`client.ts:130-168`) predicts: it always starts at `queue[0]`, and if that `DELETE` keeps hitting a `break` branch (401 / pending-403 / 5xx / thrown exception), the loop exits before ever reaching index 1+, so newer items enqueued behind it are never attempted, call after call. | **STRONG** |
| 4: Dead-lettering broken | Not applicable here — the stuck item is at the front and (per hypothesis 3) never reaches the dequeue/record-failed line at all; a 4xx on it would `recordFailed` + dequeue (`client.ts:156,160-161`), which would NOT reproduce "queue only grows." The observed behavior is consistent with the head item hitting a `break` branch, not the record-failed branch. | NONE (consistent with, not competing against, #3) |

## Narrowing Signals

- `navigator.onLine === true` during the test — rules out hypothesis 2
  outright.
- Queue length (13) and a visibly stale `queued_at` (11:32:54, well before
  the test) on the head item — the item has been stuck for a meaningful
  span while 12 other requests piled up behind it.
- "No new request fires for a fresh action" is the signature of strict
  FIFO processing blocked at the head, not of a dead/no-op flush loop (a
  genuinely dead loop would also never retry the head item, which is
  consistent — but combined with console being clean, points to the head
  item's own request either erroring silently in the `catch` block or
  returning a 5xx, both of which `break` without logging anything to
  console).
- This exact candidate was already named and explicitly deferred in the
  prior frame (`context/changes/shopping-sync-queue-refactor/frame.md`,
  hypothesis 4: "FIFO head-of-line blocking... Not fixed here (deferred
  per user decision)... if a user reports a narrower symptom post-deploy,
  this is the next thing to investigate") — this is that follow-up.

## Cross-System Convention

Every framing pass on this subsystem so far
(`shopping-list-since-cursor-reconciliation`, `shopping-duplicate-stale-sync`,
`shopping-sync-queue-refactor`, now this one) has resolved to a narrow,
mechanical cause rather than an architecture-level rewrite. This one fits
the pattern again: the queue model itself is sound, but it has no
circuit-breaker for a permanently-failing head request.

## Resolution Update (post-backend-log check)

Backend logs (CloudWatch + Lambda invocation metrics, checked by
`homecraftapi-30`) show **zero invocations** for the Lambda in the entire
window around and after `2026-10-09T11:32:54Z`, and **zero matches** for
`shopping_item_id = 5af1cc82-...` across the full window — not even a
failed attempt. This rules out hypothesis 3 as originally stated ("backend
keeps rejecting this request") and ruled out a backend bug entirely: the
request never reached AWS.

Follow-up frontend reproduction then found: after a full page reload, **12
different queued requests fired immediately** (varying statuses), the
queue drained, and a fresh action afterward fired instantly — no stuck
state recurred. This is the decisive signal: the request wasn't
permanently un-sendable (reload sent it fine) — something in that specific
page session's JS state prevented `flushQueue()` from ever attempting it.

**Revised hypothesis 3**: `flushQueue()`'s module-level `flushPromise`
singleton (`client.ts:128`) never reset to `null` within that session. The
head item's `fetch()` call (`client.ts:140-148`) neither resolved nor
rejected — it hung forever, so the `finally { flushPromise = null; }`
(`client.ts:163-165`) never ran. Every subsequent `enqueue()`'s
fire-and-forget `void flushQueue()` (`client.ts:119`) hit the `if
(flushPromise) return flushPromise;` early-return (`client.ts:132`) and
did nothing — no new fetch, no console output, queue only grows. A full
reload creates a fresh JS module instance (fresh `flushPromise = null`),
which is why the backlog drained instantly on reload with no code change.

Why the `fetch()` itself would hang past its own `AbortSignal.timeout(10_000)`:
most likely mobile/PWA tab backgrounding suspending the in-flight network
request without the browser ever firing the abort or rejecting the
promise — a known class of issue for long-lived SPAs on mobile
Safari/PWA contexts. This app registers a service worker
(`src/routes/__root.tsx:179-205`, `public/sw.js`) and is mobile-first
(haptics, swipe-to-delete), consistent with this usage pattern. The
service worker itself is ruled out as the hang's source — its `fetch`
listener explicitly ignores non-GET and cross-origin requests
(`public/sw.js:27`), and this is a same-origin-irrelevant cross-origin
`DELETE` to `API_BASE`.

## Reframed (or Confirmed) Problem Statement

> **The actual problem to plan around is**: `flushQueue()` has no upper
> bound on how long a single in-flight request may hang before giving up
> and resetting `flushPromise` — `AbortSignal.timeout(10_000)` is supposed
> to provide that bound but did not fire (or its rejection was lost) in
> this session, most likely due to mobile tab backgrounding suspending the
> fetch. Because `flushPromise` is a long-lived module singleton with no
> independent watchdog, one hung request freezes the entire queue
> indefinitely — not just the item behind it, but every future call to
> `flushQueue()` for the rest of the page's lifetime, until a full reload.

This is not "sync needs to be live/poll-based" (the original framing) and
not "the backend rejects this request" (the first-pass reframe) — neither
survives the evidence. What's missing is a **hard, independent watchdog**
on `flushQueue()`'s own promise (not just the per-fetch abort signal it
currently relies on alone), so a hang can't permanently wedge the queue
for the rest of the session.

## Confidence

- **HIGH** — the zombie-`flushPromise` mechanism is now confirmed by: (a)
  backend logs showing the request never left the browser, (b) a full
  reload clearing the stuck state and draining the entire backlog
  instantly with no code change, and (c) code inspection showing
  `flushPromise` has exactly one reset path (`finally`) and no independent
  timeout of its own. The remaining open question is strictly *why* the
  `fetch()` call hung past its 10s abort signal in this session — the
  mobile-tab-backgrounding explanation is a strong, literature-backed
  prior but not independently reproduced here.

## What Changes for /10x-plan

Plan a frontend-only fix (no backend change needed — ruled out by logs):
give `flushQueue()`'s overall promise its own hard timeout/watchdog
independent of the per-fetch `AbortSignal.timeout`, so that if a single
iteration hangs past a bound, `flushPromise` still resets to `null` and
the queue can keep moving (either by abandoning that iteration and
retrying later, or by force-resetting the lock). Secondary, smaller
consideration: should `onReturnToApp`'s `visibilitychange`/`focus`
handler (`store.tsx:255-259`) also nudge `flushQueue()` as a defensive
reset point, since "tab returns from background" is exactly when a
suspended fetch would most likely need to be abandoned and retried. Do
NOT plan a polling/push-based live-sync mechanism or a backend fix — the
evidence does not support either.

## References

- Source files: `src/lib/api/client.ts:130-168` (`flushQueue`), `:95-121`
  (`enqueue`/`writeQueue`), `src/components/PageHeader.tsx:14-31`
  (sync-status banner), `src/lib/store.tsx:239-266` (sync trigger surface)
- Backend: `HomeCraftApi/app/Http/Controllers/ShoppingItemController.php:80-85`
  (`destroy`), `database/migrations/2026_09_30_000002_add_shopping_item_id_to_purchase_lines_table.php`
  (`shopping_item_id` FK is `nullOnDelete`, ruling out a simple FK-violation
  500 on delete — the actual backend-side cause is still unconfirmed)
- Related: `context/changes/shopping-sync-queue-refactor/frame.md`
  (hypothesis 4, originally deferred), `context/changes/shopping-sync-queue-refactor/plan.md`
  Open Risks (same candidate flagged there)
- Evidence: user-run console checks (`navigator.onLine`, localStorage
  queue inspection) during this session, 2026-10-09
