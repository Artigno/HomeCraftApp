# Sync-Queue Watchdog — Plan Brief

> Full plan: `context/changes/shopping-live-sync-no-poll/plan.md`
> Frame brief: `context/changes/shopping-live-sync-no-poll/frame.md`

## What & Why

`flushQueue()`'s offline-sync queue can get permanently wedged: when a
single `fetch()` call hangs (observed cause — mobile/PWA tab backgrounding
suspending an in-flight request without the browser firing its own
`AbortSignal.timeout`), the module-level `flushPromise` lock never resets,
and every later sync attempt for the rest of the page session silently
does nothing. The sync-status banner only grows, with no console error and
no backend trace — confirmed by `homecraftapi-30`'s log check (zero Lambda
invocations for the stuck request).

## Starting Point

`flushQueue()` (`src/lib/api/client.ts:130-168`) processes a FIFO
localStorage queue, guarded by a single `flushPromise` that only resets in
a `finally` block. The only per-request timeout is a cooperative
`AbortSignal.timeout(10_000)` inside `fetch()` itself — if that fails to
fire, nothing else bounds the wait.

## Desired End State

A hung request can no longer wedge the queue indefinitely — `flushPromise`
always resets within a bounded window (15s), and the item stays queued for
a normal retry on the next sync attempt, same treatment as today's
exception/5xx handling. A tab returning from the background gets an
immediate extra chance to unblock the queue instead of waiting out the
full window.

## Key Decisions Made

| Decision                      | Choice                                      | Why                                                                         | Source |
| ------------------------------ | -------------------------------------------- | ---------------------------------------------------------------------------- | ------ |
| Problem framing                | FIFO queue has no independent hang bound, not a polling gap or backend bug | Confirmed by browser evidence (localStorage, Network tab) + backend log check | Frame  |
| Watchdog mechanism             | `Promise.race` per-fetch against a hard 15s timer | Works even when `AbortSignal.timeout` itself fails to fire; small, local change | Plan   |
| Timed-out item handling        | Leave queued, retry on next `flushQueue()` call | Same treatment as existing exception/5xx branch; no schema change, no data loss | Plan   |
| Defensive tab-return trigger   | Add `flushQueue()` kick to existing `onReturnToApp` | Immediate unblock chance right when a suspended fetch is most likely      | Plan   |

## Scope

**In scope:**
- Independent watchdog timeout inside `flushQueue()`'s per-item fetch
- One-line defensive `flushQueue()` kick on tab-return (`store.tsx`)

**Out of scope:**
- Retry-count/dead-letter mechanism for timed-out requests
- Any backend change (ruled out by logs)
- Polling/push-based live-sync mechanism (ruled out by frame)
- Reproducing the exact mobile-backgrounding mechanism itself

## Architecture / Approach

`flushQueue()`'s loop already has a `catch { break; }` branch for any
fetch failure, which correctly resets `flushPromise` via `finally`. The
fix slots into that same shape: race the fetch against a timer, and let a
timeout fall into the same break/finally path a real exception already
uses. No new state, no new queue semantics — just a second, independent
bound on the wait.

## Phases at a Glance

| Phase                              | What it delivers                                      | Key risk                                                |
| ----------------------------------- | ------------------------------------------------------- | -------------------------------------------------------- |
| 1. Watchdog timeout in flushQueue() | Hung fetch can no longer wedge the queue past ~15s      | 15s bound is a judgment call, not empirically tuned      |
| 2. Defensive flush kick on tab-return | Faster unblock on the most-likely-hang-recovery moment | Pure addition; low risk, one line in an existing handler |

**Prerequisites:** None — standalone frontend-only fix.
**Estimated effort:** ~1 session, 2 small phases.

## Open Risks & Assumptions

- Root cause (mobile tab backgrounding) is inferred from evidence, not
  independently reproduced — the fix is mechanism-agnostic so this doesn't
  block it.
- 15s watchdog bound may need revisiting if hangs recur in the wild; not a
  reason to add retry-count/dead-lettering now (explicitly deferred).

## Success Criteria (Summary)

- A hung `fetch()` (simulated via monkey-patched `window.fetch`) no longer
  leaves the queue permanently stuck — a later action's request fires
  after the watchdog window instead of silently no-op'ing
- Returning to a backgrounded tab triggers an immediate flush attempt
