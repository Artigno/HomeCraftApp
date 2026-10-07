# Shopping-List Since-Cursor Reconciliation — Plan Brief

> Full plan: `context/changes/shopping-list-since-cursor-reconciliation/plan.md`
> Research: `context/changes/shopping-list-since-cursor-reconciliation/research.md`

## What & Why

HomeCraftApi shipped a `since`-cursor contract for `GET /shopping-items` that can now return done items, so the client's local 6-hour TTL workaround for "zombie" checked-off items (`local_marked_done_at`, commit `72819ba`) is no longer needed — it was a hack around an endpoint limitation that's now fixed. This change wires up the real cursor-based reconciliation and deletes the workaround.

## Starting Point

`syncFromBackend` (`src/lib/store.tsx:95-162`) does one bare `GET /shopping-items` per sync with no query params; the legacy endpoint only returns `done=false` items, so the client stamps a client-clock timestamp on toggle and keeps "done" items visible for 6h past that stamp before silently dropping them. No cursor, no `updated_at` field on the type, no query-string support in `apiGet`.

## Desired End State

Every shopping-items fetch now passes an explicit `since` value — a far-past epoch on mount/login (full resync, catches cross-device deletes by absence) or the stored cursor on visibility/focus (incremental, upserts only what changed). A pending `/toggle` PATCH still in the offline queue always wins over a stale fetch, in either direction. The TTL field and its logic are gone entirely.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Architecture | Incremental since-merge (not "just widen the filter") | Matches the backend's actual delta design and sets the pattern for the other 4 endpoints' future rollout | Plan |
| Cross-device deletes | Periodic full resync (mount/login, epoch-anchored) instead of a tombstone | Backend gives no delete signal under `since`; full resync bounds staleness using triggers that already exist | Plan |
| Cursor storage | Shopping-items-only `localStorage` key, not a generic multi-resource map | Matches this change's explicit single-endpoint scope; avoids guessing at 4 endpoints not yet researched | Plan |
| In-flight PATCH race | Trust the actual offline queue (`readQueue()`), not a done-flag heuristic | Works symmetrically in both toggle directions, unlike today's done:true-only trust | Plan |
| 422 / invalid cursor | Drop cursor, retry once as a full epoch fetch | Self-healing, matches the existing try/catch-and-ignore-corruption idiom already used for the offline queue | Plan |
| Two-PATCH ordering race (toggle + sort_order) | Out of scope, noted as follow-up | Pre-existing issue, not caused by or required for this change's goal | Plan |

## Scope

**In scope:**
- `since`-cursor plumbing: `updated_at` on `ShoppingItem`, cursor storage helpers, a dedicated since-aware fetch function
- Rewiring `syncFromBackend`'s shopping-items path: epoch full resync on mount/login, incremental merge on visibility/focus
- Queue-aware reconciliation replacing the TTL/`reconciled` blocks
- Deleting `local_marked_done_at` and all its references

**Out of scope:**
- The other 4 `since`-enabled endpoints (purchases, maintenance-tasks, maintenance-logs, recipes)
- The two-PATCHes-per-toggle ordering race
- Any new polling/timer infrastructure
- Automated tests (none exist in this repo today)

## Architecture / Approach

`syncFromBackend` gains an `{ incremental?: boolean }` mode. Mount/login always resolve `since` to a far-past epoch constant (full resync — because the backend's "since absent" mode is the *legacy* done-excluding behavior, not a way to get everything). Visibility/focus resolve `since` to the stored cursor. A new `apiGetShoppingItems(since)` in `client.ts` distinguishes a 422 (invalid `since`) from other failures so the caller can clear a corrupted cursor and retry once. After merge, any id with a pending `/toggle` PATCH in `readQueue()` has its `done` forced to the pre-sync local value — this one check replaces both old TTL blocks.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Plumbing | `updated_at` field, cursor storage, since-aware fetch — fully inert | None — no behavior change yet |
| 2. Rewire sync | Epoch full resync + incremental merge + queue-override wired into `syncFromBackend` | The actual behavior change; races (in-flight PATCH, 422 recovery) must hold up under manual testing with no test suite as a backstop |
| 3. Cleanup | Delete `local_marked_done_at` and its last references | Low — Phase 2 already stopped relying on it |

**Prerequisites:** Backend contract already shipped and green (162 tests) per `homecraftapi-30`'s message — no blocking dependency.
**Estimated effort:** ~1 session across 3 phases; Phase 2 is the bulk of the work.

## Open Risks & Assumptions

- No automated test suite exists anywhere in this repo — all verification in Phase 2/3 is manual, on a change that touches real race conditions.
- Assumes the backend's `since` ordering guarantee (ascending by `updated_at`) holds, since the cursor-advancement logic takes the last element's `updated_at` as the new cursor.
- Cross-device deletes are only caught at the next full resync (mount/login), not instantly — accepted per the "periodic full resync" decision above, not a bug.

## Success Criteria (Summary)

- Checked-off items survive indefinitely without a TTL — visible correctly whether toggled seconds or days ago, with no zombie-drop logic anywhere
- A second device sees another device's toggle (and eventual delete) show up within one resync cycle, without manual reload tricks
- `grep -rn "local_marked_done_at" src/` returns nothing after Phase 3
