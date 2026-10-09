<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Sync-Queue Watchdog Implementation Plan

- **Plan**: context/changes/shopping-live-sync-no-poll/plan.md
- **Scope**: Phase 1 of 2 and Phase 2 of 2 (full plan)
- **Date**: 2026-10-09
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — Watchdog sentinel class currently unused for differentiated handling

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/api/client.ts:136,170
- **Detail**: `FlushWatchdogTimeout` is the only custom `Error` subclass in the codebase. Plan allowed it "so the watchdog path is distinguishable... if that distinction is ever needed" — currently the `catch` block treats it identically to any other fetch failure (break, keep queued). Matches plan intent exactly; flagged only as a forward-looking note, not a defect.
- **Fix**: None needed now. If watchdog-specific telemetry/logging is wanted later, `instanceof FlushWatchdogTimeout` is already available.
- **Decision**: FIXED + ACCEPTED-AS-RULE: Introduce a sentinel Error subclass only when a consumer distinguishes it — removed the unused `FlushWatchdogTimeout` class, watchdog now rejects a plain `Error`.

### F2 — Watchdog `setTimeout` not explicitly cleared when fetch wins the race

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/api/client.ts:159-161
- **Detail**: No `clearTimeout` when `fetch()` settles first. Not a functional leak — the timer is scoped to the async IIFE's closure, fires at most once into an already-settled race (no-op), then is GC'd — but it's a minor tidiness gap.
- **Fix**: Optionally capture the timer id and `clearTimeout` it in a `finally` around the race, for cleanliness (no behavior change).
- **Decision**: FIXED

### F3 — Abandoned fetch promise confirmed non-leaking

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/api/client.ts:148-162
- **Detail**: Verified `Promise.race` attaches internal handlers to all input promises, so the losing `fetch()`'s eventual settlement (success or rejection) is swallowed safely — no unhandled-rejection risk. Confirms the plan's own stated assumption; no issue found.
- **Fix**: None needed.
- **Decision**: SKIPPED (verified clean, no action needed)

### F4 — Pre-existing duplicate-replay risk on abandoned non-idempotent mutations (not introduced by this change)

- **Severity**: OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/api/client.ts:139-172 (loop's `catch { break; }` path, pre-existing)
- **Detail**: When the watchdog fires, the abandoned fetch may still land server-side later for a non-idempotent mutation; the queued item is retried on the next flush, risking a duplicate server-side effect. This risk already existed for any dropped/timed-out fetch before the watchdog (same `catch { break; }` path for network errors) — the watchdog only bounds *how long* a hang can wedge the lock, it doesn't introduce or change this semantics. Plan's "What We're NOT Doing" explicitly deferred retry-count/dead-lettering.
- **Fix**: None required for this change — already out of scope per plan. Worth a future lesson/backlog item if duplicate-replay is ever observed in practice.
- **Decision**: SKIPPED
