# Shopping Items Vanish-on-Resync — Plan Brief

> Full plan: `context/changes/shopping-sync-queue-refactor/plan.md`
> Frame brief: `context/changes/shopping-sync-queue-refactor/frame.md`

## What & Why

Shopping items vanish from the client after a hard refresh — not a data-loss
bug (backend DB is confirmed correct), a client-display bug. The frontend's
full-resync path sends `since=1970-01-01T00:00:00Z` as an "give me
everything" sentinel, but MySQL's `TIMESTAMP` column can't represent a value
below `1970-01-01 00:00:01` UTC. The comparison silently matches zero rows,
and the full resync then wholesale-replaces local `shopping` state with that
empty result.

## Starting Point

`ShoppingItemController::index()` already has an unfiltered branch (no
`since` param → full list, done items included, confirmed by an existing
passing test) — it's just never used by the frontend, which always sends
some `since` value. Live reproduction confirmed the exact failure: hitting
the deployed API with the epoch sentinel returns `[]` for a household that
has rows.

## Desired End State

A hard refresh always shows the household's full, correct shopping list
(done and pending). Any out-of-range `since` value fails loudly (422)
instead of silently wiping data, protecting against this exact class of bug
recurring from any caller.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Fix scope | Both backend + frontend | Frontend fix alone leaves a silent-wrong-answer footgun in the backend query; backend fix alone would break the existing (now-broken) retry flow unless frontend also stops sending the sentinel | Plan |
| Secondary candidates (cursor `>` exclusion, FIFO blocking) | Risk register only, not implemented | Unconfirmed, don't match the reported symptom as cleanly as the epoch bug; keep this plan focused on the proven root cause | Plan |
| Verification | Backend unit test + manual repro | Locks in regression coverage for the exact boundary value that broke in production, plus confirms the real-world symptom is gone | Plan |
| Stale comment at `store.tsx:36-39` | Remove/rewrite | Describes a backend done-filter removed in commit `01ebf97` — actively misleading, same pattern that's required 3 framing passes on this subsystem already | Plan |
| Deploy order | Backend first, then frontend | Backend validation alone already stops the silent-empty-result outcome; frontend change completes the fix immediately after | Plan |

## Scope

**In scope:**
- Backend: defensive validation on `since`, rejecting MySQL-`TIMESTAMP`-unrepresentable values with 422
- Backend: regression test for the exact sentinel value that broke in production
- Frontend: full resync omits `since` entirely; incremental-with-no-cursor also falls back to full resync instead of the epoch sentinel
- Frontend: remove stale comment and now-dead `EPOCH_SINCE` constant

**Out of scope:**
- Cursor same-second `>` exclusion fix (secondary candidate, risk register only)
- FIFO head-of-line blocking fix for the toggle's dual-PATCH (secondary candidate, risk register only)
- Any offline-queue architecture refactor (ruled out by frame — queue's merge logic isn't implicated)

## Architecture / Approach

Two independent repos, one coordinated fix. `HomeCraftApi`'s `index()`
already has the correct unfiltered branch — the bug is purely in which
branch gets hit and how the filtered branch fails. Backend adds a
validation floor; frontend stops triggering the filtered branch for a full
resync and routes the "no cursor yet" edge case through the same safe path.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Backend defensive validation | `since` below MySQL's representable floor now 422s, with a regression test locking in the exact sentinel value | Must ship together with Phase 2 — alone, it breaks the existing invalid-since retry loop (would 422 twice, give up silently) |
| 2. Frontend full-resync fix | Full resync omits `since`; no-cursor incremental also omits it; stale comment + dead constant removed | None significant — routes through an already-tested backend branch |
| 3. End-to-end manual verification | Confirms live repro (epoch GET → 422, toggle → hard-refresh → item persists) against deployed stack | Backend-then-frontend deploy window must actually be sequenced, not simultaneous |

**Prerequisites:** none — no new dependencies, no schema changes, no access requirements beyond normal deploy to both repos.
**Estimated effort:** ~1 session, 3 small phases (backend validation + test, frontend query-param + fallback change, manual verification pass).

## Open Risks & Assumptions

- Cursor same-second exclusion and FIFO head-of-line blocking remain real but secondary candidates, logged for future investigation if a narrower symptom surfaces post-fix.
- Assumes no other caller of `GET /shopping-items` depends on the current silent-empty-result behavior for an out-of-range `since` — not verified beyond this codebase.

## Success Criteria (Summary)

- A toggled-then-hard-refreshed shopping item stays visible and correctly marked done
- The live epoch-sentinel request returns 422 instead of `[]` post-deploy
- A fresh, unrelated toggle also survives a hard refresh (proving the fix isn't scoped to the two previously-patched call sites)
