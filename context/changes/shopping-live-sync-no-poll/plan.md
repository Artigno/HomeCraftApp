# Sync-Queue Watchdog Implementation Plan

## Overview

Fix `flushQueue()`'s unbounded hang: a single in-flight `fetch()` that never
resolves or rejects (observed: mobile/PWA tab backgrounding suspending the
request without the browser firing `AbortSignal.timeout`'s abort) leaves the
module-level `flushPromise` singleton stuck forever, silently freezing the
entire offline-sync queue for the rest of the page session — no further
requests fire, the "N zmian czeka na synchronizację" banner only grows, and
nothing in the console or backend logs shows a trace of it. Add an
independent watchdog so a hang can't wedge the queue past a bounded window,
plus a defensive extra unblock attempt at the moment a hang is most likely
to have occurred.

## Current State Analysis

- `flushQueue()` (`src/lib/api/client.ts:130-168`) is a strict-FIFO loop
  guarded by a module-level `flushPromise` singleton (`:128`) so concurrent
  callers share one in-flight run. The `finally { flushPromise = null; }`
  (`:163-165`) is the *only* place that resets the lock — if the `await
  fetch(...)` at `:140-148` never settles, that `finally` never runs, and
  every subsequent `enqueue()`'s fire-and-forget `void flushQueue()`
  (`:119`) hits the early-return at `:132` (`if (flushPromise) return
  flushPromise;`) and does nothing — no new network attempt, no console
  output.
- The only per-request timeout today is `signal: AbortSignal.timeout(10_000)`
  passed to `fetch()` itself (`:148`) — this is a *cooperative* timeout
  that depends on the browser's timer/abort machinery actually firing. It
  is not independent of whatever caused the hang.
- `window.addEventListener("online", () => void flushQueue())` (`:426`) and
  the `"homesync:auth"` listener (`:432-442`) are the other two triggers
  that call `flushQueue()` — both would hit the same stuck-lock
  early-return while wedged.
- `src/lib/store.tsx:255-259`'s `onReturnToApp` already calls
  `syncFromBackend({ incremental: true })` on `visibilitychange`/`focus`
  but does not currently also kick `flushQueue()`.
- No test runner is configured in this repo (`package.json` scripts:
  `dev`, `build`, `build:dev`, `build:gh-pages`, `preview`, `lint`,
  `format` — no `test`). Automated verification for this plan is
  typecheck + lint, consistent with `shopping-sync-queue-refactor`'s
  Phase 2.

## Desired End State

`flushQueue()`'s lock (`flushPromise`) always resets within a bounded time
window, even if the underlying `fetch()` call hangs indefinitely. A hung
request is treated the same way an exception or 5xx is treated today: the
item stays queued, the loop stops for this run, and the *next* call to
`flushQueue()` tries again from the (same) head. A tab returning from the
background gets one additional, immediate chance to unblock the queue
rather than waiting out the full watchdog window.

**Verification**: with `fetch` monkey-patched in the browser console to
return a promise that never settles, enqueue a mutation, confirm the
watchdog fires within its bound and `flushPromise` resets (a later,
unrelated `flushQueue()` call — e.g. from a second, normal action —
proceeds instead of silently no-op'ing); restore `fetch` and confirm the
queue drains.

### Key Discoveries:

- `client.ts:128,163-165` — `flushPromise`'s only reset path is the
  `finally` block; no independent timeout backs it.
- `client.ts:148` vs the observed hang — `AbortSignal.timeout(10_000)` did
  not fire (or its rejection was lost) in the reported session; relying on
  it alone is insufficient.
- `store.tsx:255-259` — natural, low-risk place to add a defensive
  `flushQueue()` kick at the moment a suspended fetch is most likely to
  need abandoning.

## What We're NOT Doing

- Not changing the per-request `AbortSignal.timeout(10_000)` value or
  mechanism — it stays as the first line of defense; the watchdog is a
  second, independent line.
- Not adding a retry-count/dead-letter mechanism for timed-out requests
  (decided: leave queued, retry on next `flushQueue()` call — same
  treatment as today's exception/5xx branch). No `QueuedRequest` schema
  change.
- Not adding a polling/push-based live-sync mechanism — ruled out by
  `frame.md`'s investigation; this was never a polling-gap problem.
- Not touching backend code — ruled out by `homecraftapi-30`'s log check
  (zero Lambda invocations for the stuck request).
- Not adding new event listeners beyond the one line in the existing
  `onReturnToApp` handler.

## Implementation Approach

Wrap each per-item `fetch()` call inside `flushQueue()`'s loop in a
`Promise.race()` against an independent hard timer. If the timer wins, the
loop treats it exactly like the existing `catch { break; }` branch (item
stays queued, loop exits, `finally` resets `flushPromise`). The abandoned
`fetch()` promise is left to settle on its own in the background — if it
eventually resolves, nothing is listening to it as a result object (it's
not assigned past the race), so it cannot retroactively dequeue or
otherwise mutate state after the fact. Pick a watchdog bound longer than
the existing 10s `AbortSignal.timeout` (so the normal abort path gets a
chance to fire first) — 15 seconds.

Phase 2 adds one line to the existing tab-return handler so a returning
tab gets an immediate extra chance to unblock the queue rather than
waiting out the full 15s watchdog.

## Phase 1: Watchdog timeout in `flushQueue()`

### Overview

Give `flushQueue()`'s per-item fetch an independent hard timeout so a hang
can't permanently wedge `flushPromise`.

### Changes Required:

#### 1. Race each fetch attempt against a hard timeout

**File**: `src/lib/api/client.ts`

**Intent**: Bound how long a single queue iteration can wait on `fetch()`,
independent of whether `AbortSignal.timeout` itself fires, so
`flushPromise` always eventually resets even if the request hangs forever.

**Contract**: Introduce a module-level constant `FLUSH_WATCHDOG_MS = 15_000`
(above the existing per-fetch `10_000` abort timeout). Inside the loop's
inner `try` block (`:139-159`), replace the bare `await fetch(...)` with a
`Promise.race` between the existing `fetch(...)` call and a promise that
rejects after `FLUSH_WATCHDOG_MS` with a distinct sentinel (e.g. throw a
small `class FlushWatchdogTimeout extends Error {}` or a plain tagged
object) so the watchdog path is distinguishable from a genuine fetch
rejection in the `catch` block if that distinction is ever needed for
logging — functionally, both fall into the same `catch { break; }` branch
today, so no behavior change beyond breaking out instead of hanging. The
abandoned `fetch()` promise is not awaited further; no `.then`/`.catch` is
attached to it beyond what's already inside `fetch()`'s own machinery, so
its eventual settlement (if any) is inert.

### Success Criteria:

#### Automated Verification:

- Frontend typecheck passes: `npx tsc --noEmit`
- Lint passes: `npm run lint`

#### Manual Verification:

- In the browser console, monkey-patch `window.fetch` to return a promise
  that never settles (`window.fetch = () => new Promise(() => {})`),
  trigger an action that enqueues a mutation, and confirm (via a `console.log`
  temporarily added, or by observing a subsequent unrelated action's
  request firing) that `flushPromise` resets within ~15s instead of
  staying wedged indefinitely
- Restore `window.fetch` (reload the page) and confirm the queue drains
  normally with no leftover stuck state

**Implementation Note**: After completing this phase and all automated
verification passes, pause here for manual confirmation from the human
that the manual testing was successful before proceeding to the next
phase.

---

## Phase 2: Defensive flush kick on tab-return

### Overview

Give a tab returning from the background (the point at which a suspended
fetch most plausibly needs abandoning) an immediate extra chance to
unblock the queue, rather than only waiting out Phase 1's watchdog window.

### Changes Required:

#### 1. Kick `flushQueue()` from the existing return-to-app handler

**File**: `src/lib/store.tsx`

**Intent**: `onReturnToApp` (`:255-259`) already exists specifically to
react to a tab regaining focus/visibility; extend it to also nudge the
sync queue, not just the backend resync.

**Contract**: Inside `onReturnToApp`'s `document.visibilityState ===
"visible"` branch, alongside the existing `void syncFromBackend({
incremental: true })` call, add `void flushQueue();` (import `flushQueue`
from `./api/client` if not already imported in this file — check existing
imports first, since `enqueue`/`readQueue`/etc. are already imported from
the same module).

### Success Criteria:

#### Automated Verification:

- Frontend typecheck passes: `npx tsc --noEmit`
- Lint passes: `npm run lint`

#### Manual Verification:

- Background the tab (switch tabs or minimize) while a mutation is
  queued/in-flight, then return to the tab; confirm a `flushQueue()`
  attempt is visible in the Network tab shortly after return (not only
  after the full watchdog window)

**Implementation Note**: After completing this phase and all automated
verification passes, pause here for manual confirmation from the human
that the manual testing was successful before proceeding to the next
phase.

---

## Testing Strategy

### Unit Tests:

- N/A — no test runner configured in this repo (see Current State
  Analysis). Verification is typecheck + lint + manual browser testing.

### Integration Tests:

- N/A, same reason.

### Manual Testing Steps:

1. Monkey-patch `window.fetch` to hang forever, enqueue a mutation,
   confirm the watchdog fires (~15s) and the queue is not permanently
   wedged — a later action's request fires once the watchdog window
   passes
2. Restore `fetch`, confirm the queue drains and no stuck state persists
3. Background the tab while something is queued, return to it, confirm
   `flushQueue()` is kicked immediately (Phase 2) rather than waiting the
   full watchdog window
4. Regression: normal online flow (no hang) still enqueues, flushes, and
   dequeues exactly as before — no behavior change for the non-hung path

## Performance Considerations

None beyond the two described timers — the watchdog only matters on the
already-degenerate hung-request path; the happy path is unaffected.

## Migration Notes

No data migration. Purely a client-side robustness fix; existing queued
requests (including any currently-stuck one, like the known
`5af1cc82-...` DELETE) will be retried and can succeed normally once this
ships and the watchdog unwedges a user's stuck session (or a reload does,
as it does today).

## References

- Frame brief: `context/changes/shopping-live-sync-no-poll/frame.md`
- Related: `context/changes/shopping-sync-queue-refactor/` (sibling change,
  separate bug — epoch-sentinel full-resync fix, already shipped)
- `context/foundation/lessons.md` (pure-setState-updater lesson — not
  directly implicated here, `flushQueue()` has no `setState` involvement,
  but worth a glance per project convention)

## Open Risks & Assumptions

- **Root cause of the original hang is inferred, not reproduced**: the
  frame brief's mobile-tab-backgrounding explanation is a strong prior
  (literature-backed, consistent with all observed evidence) but wasn't
  independently reproduced in this session. This plan's fix is
  mechanism-agnostic — it bounds *any* hang regardless of cause, so it
  doesn't depend on that inference being exactly right.
- **15s watchdog bound is a judgment call**: chosen to sit above the
  existing 10s `AbortSignal.timeout` so the normal abort path gets first
  chance to fire. If real-world hangs recur with the watchdog in place
  (i.e. 15s turns out insufficient for some network condition), that's a
  signal to revisit the bound, not to add retry-count/dead-lettering
  (explicitly deferred, see What We're NOT Doing).

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when
> a step lands. Do not rename step titles. See
> `references/progress-format.md`.

### Phase 1: Watchdog timeout in flushQueue()

#### Automated

- [x] 1.1 Frontend typecheck passes: `npx tsc --noEmit` — 1f066da
- [x] 1.2 Lint passes: `npm run lint` — 1f066da

#### Manual

- [x] 1.3 Monkey-patched hung `fetch` confirms watchdog fires (~15s) and
      `flushPromise` resets instead of staying wedged — 1f066da
- [x] 1.4 Restored `fetch` confirms queue drains normally afterward — 1f066da

### Phase 2: Defensive flush kick on tab-return

#### Automated

- [x] 2.1 Frontend typecheck passes: `npx tsc --noEmit`
- [x] 2.2 Lint passes: `npm run lint`

#### Manual

- [x] 2.3 Backgrounding then returning to the tab triggers an immediate
      `flushQueue()` attempt visible in Network, not only after the
      watchdog window
