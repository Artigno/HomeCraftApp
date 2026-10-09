# Frame Brief: Shopping sync "queue-first architecture" vs. actual toggle-vanish bug

> Framing step before /10x-plan. This document captures what is *actually*
> at issue, separated from what was initially assumed.

## Reported Observation

After `toggleShoppingItem`, a shopping item sometimes disappears/goes stale
in the UI — reported leading repro: toggle around a reload/hard-refresh.
User confirmed (narrowing answer) the item **is** present in the backend
DB with `done: true` — this is a client-display problem, not data loss.
Two prior sibling fixes (per-id DELETE wiring on discard/complete-purchase,
stale-bulk-DELETE purge) did not resolve it, and the user reports it even
for fresh toggles unrelated to those two call sites.

## Initial Framing (preserved)

- **User's stated cause or approach**: the queue-first architecture itself
  (every mutation durably queued to localStorage + best-effort flush,
  instead of an online-first default) is the root cause.
- **User's proposed direction**: refactor so the queue only activates when
  offline; default path becomes immediate backend sync.
- **Pre-dispatch narrowing**: leading repro = toggle around reload/hard-refresh
  (not multi-device, not fresh-online-single-device). Symptom shape = item
  is correctly `done: true` server-side but wrong/absent client-side, not
  an actual DB deletion.

## Dimension Map

The observation could originate at any of these dimensions in the
toggle → enqueue → flush → resync chain (`src/lib/store.tsx`,
`src/lib/api/client.ts`, backend `ShoppingItemController.php`):

1. **Queue-vs-online-first architecture itself** — durable queue + flush
   model is inherently unsafe vs. a direct request.           ← user's framing
2. **Full-resync merge logic** (`syncFromBackend`, non-incremental path) —
   wholesale-replaces `shopping` from the GET response; could clobber an
   optimistic toggle if the override guard has a gap.
3. **Incremental-resync cursor exclusion** — `since`-cursor uses strict
   `>` on `updated_at`; a same-second write could be permanently excluded
   from future incremental fetches.
4. **Partial dual-PATCH flush** — `toggleShoppingItem` enqueues two
   separate PATCHes (`/toggle`, then a plain `/shopping-items/{id}` for
   `sort_order`); a 5xx on the first blocks the second indefinitely
   (FIFO queue), leaving a half-applied toggle.
5. **Backend `index()` done-item filtering** — GET `/shopping-items` could
   be silently excluding `done: true` rows on a full or incremental fetch.

## Hypothesis Investigation

| Hypothesis | Evidence | Verdict |
| --- | --- | --- |
| 1: Queue architecture itself is unsafe | `syncFromBackend`'s `applyQueueOverride` (store.tsx:174-178) explicitly re-applies the pre-sync local `done`/`sort_order` for any id with a matching pending PATCH still in the queue — purpose-built to stop exactly the "resync clobbers an unflushed toggle" failure mode the user is describing. `unflushedLocalCreates` (store.tsx:205-207) does the equivalent for not-yet-flushed creates. This is deliberately engineered anti-revert logic, not an accidental side effect of having a queue. | WEAK — the queue model has a real, non-trivial merge surface, but the specific "clobber on resync" failure this architecture would predict is independently guarded against by code that already exists and (per `shopping-duplicate-stale-sync`'s shipped Phase 2, commit `4c62522`) was manually regression-tested through the add→refresh→toggle→refresh cycle with no duplicate/loss. |
| 5: Backend omits done items from GET | Read `HomeCraftApi/app/Http/Controllers/ShoppingItemController.php:22-37` directly. `index()` has **no `where('done', ...)` filter** in either the `since`-present branch (`where('updated_at', '>', $since)`) or the full-list branch — both return every row for the household regardless of `done`. For a hard-refresh (`since = EPOCH_SINCE`, 1970), virtually every real row satisfies `updated_at > 1970-01-01`, so a full resync fetches the item unconditionally. | NONE — directly ruled out by reading the backend controller; this was the frontend sub-agent's leading suspicion but it doesn't hold once the actual query is read. |
| 2: Full-resync merge clobber | `base = shopping.map(applyQueueOverride)` (store.tsx:189-190) takes the backend's full fetched list (confirmed complete per #5) and only overrides items with a matching queue entry. If the toggle's PATCHes have already flushed (dequeued) *and* the backend write is correctly visible to the immediately-following GET (no read-after-write race — not independently verified, same DB connection/request cycle in Laravel, no read replica in this stack), the fetched row already has the correct `done: true` and no override is needed. No code gap found for the plain hard-refresh case. | WEAK — no concrete gap found; would require a genuine backend read-after-write inconsistency to manifest, which isn't present in this stack's architecture (single MySQL/Postgres connection, synchronous write-then-read). |
| 3: Incremental cursor strict-`>` exclusion | `GET` index() uses `where('updated_at', '>', $since)` (controller:29) and the frontend advances the cursor to `max(updated_at)` of each fetched batch (store.tsx:222-227). A same-second write (the toggle's own two back-to-back PATCHes, or a write landing in the same second a cursor was set from a different item) would be permanently excluded from *future incremental* fetches for that id. This only affects the focus/visibility-triggered incremental path, not the hard-refresh (always-epoch) full-resync path. | WEAK-MODERATE for the incremental path specifically; NONE for the hard-refresh repro as literally described (full resync always re-fetches everything from epoch, cursor logic doesn't apply). |
| 4: Partial dual-PATCH flush (FIFO head-of-line blocking) | `flushQueue` (client.ts:130-168) processes strictly FIFO and only dequeues after a response; a 5xx on `/toggle` `break`s and leaves the trailing `sort_order` PATCH (and anything enqueued after it, from any other action) stuck behind it indefinitely until the first succeeds. This is a real, confirmed code path — but a 5xx on `/toggle` would leave the item still showing the *correct* `done` value optimistically in local state (never cleared on failure), and doesn't drop the item from view; it would, at most, leave `sort_order` momentarily unapplied. | WEAK — real bug class (head-of-line blocking on retry), but doesn't match "item vanishes" since local optimistic state is never rolled back on a queued-but-failed-flush PATCH. |

## Narrowing Signals

- User confirmed the backend DB is correct (`done: true` persisted) —
  this single fact rules out every "actual data loss" mechanism (DELETE
  wiring bugs, bulk-delete replay) and reframes the investigation as
  strictly a client-display/sync-merge problem.
- Direct read of `ShoppingItemController::index()` rules out a
  server-side done-item filter — the frontend sub-agent's strongest
  candidate does not survive contact with the actual backend code.
- The duplicate-item sibling investigation (`shopping-duplicate-stale-sync`)
  already manually regression-tested the exact "add → hard refresh →
  toggle → hard refresh" sequence post-fix (commit `4c62522`, Progress
  2.3-2.7) with no duplicate/loss observed — meaning whatever the user is
  now seeing is either a *new* manifestation, a narrower edge case (same-
  second cursor collision, FIFO head-of-line block) not covered by that
  regression pass, or needs a fresh repro with network/console logging to
  pin down — the same gap that frame.md left LOW-confidence for its own
  (different) symptom.

## Cross-System Convention

This is the third framing pass on this general subsystem
(`shopping-list-since-cursor-reconciliation`, `shopping-duplicate-stale-sync`,
now this one) — each time, the specific mechanism has required direct
code/evidence reading rather than a plausible-sounding architectural
story, and each time a "the whole area needs a rewrite" framing turned
out to be addressable with a narrower, already-partially-guarded fix.
`context/foundation/lessons.md`'s one recorded lesson (pure-setState-
updater requirement) is exactly this pattern: an architecture-level worry
("replaying the enqueue is disappearing the item") turned out to be a
one-line hoist-out-of-updater fix, not a rewrite.

## Reframed (or Confirmed) Problem Statement

> **The actual problem to plan around is**: not "the queue-first
> architecture is unsafe" — the merge/override logic that would need to
> exist regardless of queue-vs-online-first is already present and
> deliberately engineered against the exact failure the user suspects.
> The real, still-open candidates are narrower: (a) the incremental-sync
> cursor's strict `>` comparison can permanently exclude a same-second
> write from future focus/visibility-triggered syncs, and (b) the FIFO
> queue's head-of-line blocking on a failed PATCH can delay (not drop) a
> trailing sort_order update. Neither requires replacing the queue model;
> both are fixable within it (cursor to `>=` with a tie-breaker, or
> decoupling independent PATCHes so one failure doesn't block the other).

Switching to an online-first default would not, by itself, fix either
candidate: an online-first write still needs the same cursor-based GET
reconciliation to pick up other tabs'/sessions' changes, and the
same-second collision is a backend query-comparison issue independent of
whether the client queues or sends immediately.

## Decisive Evidence (live reproduction)

User hit the deployed endpoint directly:
`GET https://297ky93ajj.execute-api.eu-central-1.amazonaws.com/api/shopping-items?since=1970-01-01T00:00:00Z`
→ **returns an empty array**, despite the household having shopping items
in the DB (confirmed `done: true` present server-side earlier in this
session).

This is the mount-time full-resync call verbatim (`EPOCH_SINCE =
"1970-01-01T00:00:00Z"`, store.tsx:40; `apiGetShoppingItems(since)` never
omits `since`). Backend: `ShoppingItemController::index()` (controller:29)
runs `where('updated_at', '>', $since)` against a MySQL `TIMESTAMP` column
(migration `2026_09_25_131535_create_shopping_items_table.php:21`, `strict
=> true` in `config/database.php:60,80`). **MySQL's `TIMESTAMP` type's
valid range starts at `1970-01-01 00:00:01` UTC — one second after the
Unix epoch, not at `:00`.** `1970-01-01T00:00:00Z` is below that minimum
and not a value MySQL can represent in that column type; under strict
mode the comparison against this boundary/malformed value most plausibly
evaluates to `NULL` (falsy) for every row, producing the empty result
observed live — rather than "greater than everything," as the code's
intent assumes.

Consequence in the frontend: every **full resync** (every mount / hard
refresh — exactly the user's leading repro) fetches `shopping: []`.
Because `backendHasData` sums all five resource types (store.tsx:149-150),
and `tasks`/`recipes`/`purchases`/`tins` are non-empty, the reseed branch
is skipped — so `syncFromBackend` proceeds to wholesale-replace
`shopping` with `[]` plus only still-queued-create carryovers
(store.tsx:189-209). **Every already-synced shopping item — done or not —
is wiped locally on every hard refresh**, regardless of whether it was
just toggled. This is a single, mechanical, reproducible bug — not an
architectural flaw in the queue, and not limited to toggled/done items
(toggling just made the vanish more noticeable/first-reported).

## Confidence

- **HIGH** — root cause pinned to a specific line and a specific,
  well-known MySQL `TIMESTAMP` boundary/strict-mode behavior, confirmed by
  a live request against the deployed API returning the exact empty
  result the mechanism predicts. No further reproduction needed before
  planning; optionally confirm server-side with `SELECT * FROM
  shopping_items WHERE updated_at > '1970-01-01T00:00:00Z'` (or the
  equivalent Eloquent/tinker call) against the same DB to see the literal
  empty result and rule out an API-Gateway-level cache as an alternative
  explanation (unlikely — the user's own household has rows now, cache
  would have to be per-query-string and stale since before seeding, but
  worth a 30-second check: hit the same URL twice and see if the response
  changes, or check for `Cache-Control`/`X-Cache` response headers).

## What Changes for /10x-plan

Do not plan a queue-vs-online-first architectural refactor — the queue's
merge/override logic is not implicated. Plan a narrow backend fix: change
`EPOCH_SINCE`/the full-resync sentinel to a value MySQL's `TIMESTAMP`
column can actually represent (e.g. `1970-01-01T00:00:01Z`, or switch the
full-list branch to not filter by `since` at all when it's the epoch
sentinel, or change `index()` to treat a missing/sentinel `since` as "no
filter" explicitly — `ShoppingItemController::index()` already has an
unfiltered branch at controller:34-36 for when `since` is absent entirely,
which is the simpler fix: have the frontend omit `since` for a full
resync instead of sending the epoch sentinel). Also worth a defensive
fix regardless of which path is chosen: `index()`'s `since` branch should
not be able to silently return zero rows for a household that has data —
consider `updated_at >= $since` or validating `$since` is representable
before using it in the query. Candidates 3/4 (cursor same-second
exclusion, FIFO head-of-line blocking) remain real but secondary; worth a
mention in the plan's risk register but not blocking given the epoch bug
alone fully explains the reported symptom.

## References

- Source files: `src/lib/store.tsx:110-231` (`syncFromBackend`),
  `:347-370` (`toggleShoppingItem`), `src/lib/api/client.ts:106-168`
  (`enqueue`/`flushQueue`), `:190-209` (cursor read/write)
- Backend: `HomeCraftApi/app/Http/Controllers/ShoppingItemController.php:22-37`
  (`index`, confirmed no done-filter), `:66-71` (`toggle`)
- Related changes: `context/changes/shopping-duplicate-stale-sync/frame.md`
  and `plan.md` (prior investigation + shipped fix for the adjacent
  duplicate-item symptom, regression-tested the toggle/refresh cycle),
  `context/changes/shopping-list-since-cursor-reconciliation/` (cursor
  mechanism's own origin), `context/foundation/lessons.md` (pure-setState-
  updater lesson from the same subsystem)
