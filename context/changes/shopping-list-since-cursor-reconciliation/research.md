---
date: 2026-10-07T13:17:35+02:00
researcher: Claude Sonnet 5
git_commit: 4f784f51127e1e2ca6849c17b8061c931df87f10
branch: main
repository: HomeCraftApp
topic: "Wire up since-cursor reconciliation, drop local TTL workaround"
tags: [research, codebase, shopping-list, store, offline-queue, sync, reconciliation]
status: complete
last_updated: 2026-10-07
last_updated_by: Claude Sonnet 5
---

# Research: Wire up since-cursor reconciliation, drop local TTL workaround

**Date**: 2026-10-07T13:17:35+02:00
**Researcher**: Claude Sonnet 5
**Git Commit**: 4f784f51127e1e2ca6849c17b8061c931df87f10
**Branch**: main
**Repository**: HomeCraftApp

## Research Question

HomeCraftApi finalized a backend contract: `GET /shopping-items?since=<ISO8601>` now returns all household rows with `updated_at > since` (including `done=true` items), and `PATCH /shopping-items/{id}/toggle` now requires an explicit `{ done: boolean }` body. How does the current frontend sync shopping-list data, where does the existing 6h `local_marked_done_at` TTL workaround live, and what would wiring up `since`-cursor reconciliation in its place need to account for? Scope: shopping-items only (not the other 4 endpoints that also got `since` support).

## Summary

The frontend fetches the whole shopping list with a bare, unfiltered `GET /shopping-items` (no query params at all today) from a single call site inside `syncFromBackend` (`src/lib/store.tsx:95-103`), triggered on mount, on login, and on return-to-app (visibility/focus) — there is no polling interval. Because the legacy endpoint only ever returns `done=false` items, the client built a local workaround: `local_marked_done_at` (a client-clock timestamp, `src/lib/api/types.ts:63-66`) stamped by `toggleShoppingItem` and read by a 6-hour TTL window (`INPROGRESS_TTL_MS`, `src/lib/store.tsx:136`) inside `syncFromBackend`'s merge logic — a "zombie" done item is kept visible for 6h past its local toggle, then silently dropped. A second, independent reconciliation block (`reconciled`, `store.tsx:148-151`) force-trusts the local `done:true` flag over a stale `done:false` GET response for any item this device believes it already toggled, covering the specific race where a `PATCH .../toggle` is still queued/in-flight when a GET lands.

Moving to `since`-cursor reconciliation removes the structural reason the workaround exists (the endpoint can now return done items), but introduces new problems the current full-replace model doesn't have to solve: (a) hard-deletes become invisible to a second device polling incrementally, since an absent row carries no signal under `since` (today's full-fetch model handles deletes for free by implicit absence); (b) the existing `reconciled` block's logic (`fetchedIds.has(i.id)` meaning "impossible for a done item" today) changes meaning once done items are a normal, expected part of the response; (c) a cursor computed from client `Date.now()` rather than from the last `updated_at` actually received from the server is exposed to clock-skew risk that today's code — which only ever compares client-clock against client-clock — has never had to deal with. There's an established `localStorage` read/write idiom already in the codebase (`readQueue`/`writeQueue` in `src/lib/api/client.ts:31-44`, and the `STORAGE_KEY` pattern in `store.tsx`) that a cursor value can reuse directly. No automated test suite exists anywhere in `src/` — this lands with manual/behavioral verification only.

`ShoppingItem` (`src/lib/api/types.ts:50-67`) has no `updated_at` field today — that's a required additive change to the type, not something already half-present.

## Detailed Findings

### Current fetch/sync trigger points

- Single GET call site: `apiGet<ShoppingItem[] | null>("/shopping-items", null)` inside a `Promise.all` alongside tasks/recipes/purchases/tins — [src/lib/store.tsx:100](https://github.com/Artigno/HomeCraftApp/blob/4f784f51127e1e2ca6849c17b8061c931df87f10/src/lib/store.tsx#L100).
- `syncFromBackend` definition — [src/lib/store.tsx:95-162](https://github.com/Artigno/HomeCraftApp/blob/4f784f51127e1e2ca6849c17b8061c931df87f10/src/lib/store.tsx#L95-L162).
- Four triggers, all inside the mount effect [src/lib/store.tsx:164-200](https://github.com/Artigno/HomeCraftApp/blob/4f784f51127e1e2ca6849c17b8061c931df87f10/src/lib/store.tsx#L164-L200):
  - Mount: `src/lib/store.tsx:173`.
  - `"homesync:auth"` window event (fired post-login from `client.ts:376`): `src/lib/store.tsx:182-183`.
  - `visibilitychange` (when visible): `src/lib/store.tsx:189-192`.
  - `focus`: `src/lib/store.tsx:193`.
- No `setInterval`/polling anywhere in `store.tsx` or `client.ts` — purely event-driven. `focus` + `visibilitychange` can fire together with no debounce, triggering two concurrent `syncFromBackend()` calls.
- `apiGet` (`src/lib/api/client.ts:169-185`) takes no query-string parameter today — adding `since` means extending this helper's signature, not just the call site.

### The `local_marked_done_at` TTL workaround — full mechanics

- Field declared on `ShoppingItem` with an explanatory comment — [src/lib/api/types.ts:63-66](https://github.com/Artigno/HomeCraftApp/blob/4f784f51127e1e2ca6849c17b8061c931df87f10/src/lib/api/types.ts#L63-L66).
- Set on toggle-to-done, stripped on toggle-to-not-done — [src/lib/store.tsx:287-293](https://github.com/Artigno/HomeCraftApp/blob/4f784f51127e1e2ca6849c17b8061c931df87f10/src/lib/store.tsx#L287-L293).
- TTL constant and the "in-progress" retention filter — [src/lib/store.tsx:136-142](https://github.com/Artigno/HomeCraftApp/blob/4f784f51127e1e2ca6849c17b8061c931df87f10/src/lib/store.tsx#L136-L142):
  ```ts
  const INPROGRESS_TTL_MS = 6 * 60 * 60 * 1000;
  const fetchedIds = new Set(shopping.map((i) => i.id));
  const inProgress = s.shopping.filter((i) => {
    if (!i.done || fetchedIds.has(i.id)) return false;
    const markedAt = i.local_marked_done_at ? Date.parse(i.local_marked_done_at) : NaN;
    return Number.isFinite(markedAt) && Date.now() - markedAt < INPROGRESS_TTL_MS;
  });
  ```
- Second, independent reconciliation block — forces `done:true` back onto a fetched item if the local state already believes it's done but the GET still says `false` (covers an in-flight/queued toggle PATCH) — [src/lib/store.tsx:148-151](https://github.com/Artigno/HomeCraftApp/blob/4f784f51127e1e2ca6849c17b8061c931df87f10/src/lib/store.tsx#L148-L151):
  ```ts
  const localDoneIds = new Set(s.shopping.filter((i) => i.done).map((i) => i.id));
  const reconciled = shopping.map((i) =>
    localDoneIds.has(i.id) && !i.done ? { ...i, done: true } : i,
  );
  ```
- Final merge: `shopping: [...reconciled, ...inProgress]` fully replaces local `shopping` state — [src/lib/store.tsx:152-161](https://github.com/Artigno/HomeCraftApp/blob/4f784f51127e1e2ca6849c17b8061c931df87f10/src/lib/store.tsx#L152-L161).
- Today's model has no `updated_at`/cursor exchange with the backend at all — the whole mechanism exists purely to compensate for "server excludes done items + optimistic local writes," using only client-side timestamps.

### `toggleShoppingItem` — current state (already patched this session)

- Full function — [src/lib/store.tsx:272-297](https://github.com/Artigno/HomeCraftApp/blob/4f784f51127e1e2ca6849c17b8061c931df87f10/src/lib/store.tsx#L272-L297). Confirmed current code sends `enqueue("PATCH", \`/shopping-items/${id}/toggle\`, { done: !current?.done })` (line 281), matching the backend's new required-body contract — no further change needed here for the toggle body shape itself.
- Two independent PATCHes are enqueued per toggle (`/toggle` for done-state, a separate plain PATCH for `sort_order`) — they can land out of order or partially since each is a separate queue entry.

### Offline queue mechanics (client.ts)

- `enqueue` — builds a `QueuedRequest`, persists via `writeQueue`, kicks `flushQueue()` fire-and-forget (not awaited) — [src/lib/api/client.ts:105-120](https://github.com/Artigno/HomeCraftApp/blob/4f784f51127e1e2ca6849c17b8061c931df87f10/src/lib/api/client.ts#L105-L120).
- `flushQueue` — strict FIFO, one request at a time; dedupes concurrent callers via a shared module-level `flushPromise` — [src/lib/api/client.ts:129-167](https://github.com/Artigno/HomeCraftApp/blob/4f784f51127e1e2ca6849c17b8061c931df87f10/src/lib/api/client.ts#L129-L167).
- **Head-of-line blocking**: any `break` (offline, 5xx, pending-household 403, network exception) stops the entire loop — every subsequent queued request, including unrelated shopping-item PATCHes, stays stuck behind it until the next successful flush pass.
- `readQueue`/`writeQueue` persist to `localStorage` key `homesync.request-queue` and dispatch a `"homesync:queue"` CustomEvent — [src/lib/api/client.ts:31-44](https://github.com/Artigno/HomeCraftApp/blob/4f784f51127e1e2ca6849c17b8061c931df87f10/src/lib/api/client.ts#L31-L44). This is the established `localStorage` read/write idiom (`try { JSON.parse(...) } catch { fallback }`) a `since` cursor should reuse — e.g. a new `homesync.shopping-cursor` key, same wrapper shape.

### Race conditions a `since`-based rewrite must address (none of these are hypothetical — each is grounded in the code above)

1. **Hard deletes become invisible under `since`.** Today's full-replace (`shopping: [...reconciled, ...inProgress]`) drops anything absent from the GET response — deletes work "for free." Under `since`, a server-side hard delete produces no row at all (backend contract gives no tombstone), so a second device polling incrementally would never learn the item was deleted; only the device that issued the `DELETE` (via its own optimistic `removeShoppingItem`, [src/lib/store.tsx:298-301](https://github.com/Artigno/HomeCraftApp/blob/4f784f51127e1e2ca6849c17b8061c931df87f10/src/lib/store.tsx#L298-L301)) removes it locally.
2. **In-flight/queued PATCH not yet flushed.** If `syncFromBackend` runs while a toggle's PATCH is still sitting in the offline queue (device offline, or stuck behind a blocked earlier request per the head-of-line issue above), a `since` GET reflects pre-PATCH server state — the item's `updated_at` hasn't moved yet, so it won't even appear in the delta. Today's `reconciled` block (`store.tsx:148-151`) was written for the old done=false-only contract where "present with done:false" or "absent" were the only two states for a just-toggled item; that assumption breaks once done items normally appear in the response, and the `fetchedIds.has(i.id)` check in the TTL block (which today is "always false for a done item, since the old endpoint excludes them") also changes meaning.
3. **Clock skew.** `local_marked_done_at` is a client-clock timestamp (`new Date().toISOString()` at `store.tsx:292`), compared only against `Date.now()` on the same device — internally consistent, no skew exposure today. A naive `since` cursor derived from the polling client's own `Date.now()` (rather than from the max `updated_at` actually received in the last server response) would introduce fresh skew risk: if the client clock runs ahead of the server, the cursor could sit later than a near-simultaneous write's server-stamped `updated_at`, permanently excluding that row from future incremental fetches.
4. **Two independent PATCHes per toggle race each other.** `/toggle` and the `sort_order` PATCH are separate queue entries; a second device's `since` fetch landing between the two flushing observes a transient `done:true` + stale `sort_order` state.

### Type gap

- `ShoppingItem` has no `updated_at` field today — [src/lib/api/types.ts:50-67](https://github.com/Artigno/HomeCraftApp/blob/4f784f51127e1e2ca6849c17b8061c931df87f10/src/lib/api/types.ts#L50-L67). `updated_at` does not appear anywhere else in `src/` either — this is a net-new concept for the whole client, not a partial implementation to extend.

### Other `done`/`sort_order` read/write sites (outside store.tsx, for completeness)

- `src/routes/shopping.tsx:99` — sort rendering by `sort_order`.
- `src/routes/shopping.tsx:157-161` — drag-reorder renumbering, calls `updateShoppingItem(id, { sort_order: index })`.
- `src/routes/shopping.tsx:168,279,284,303,366,373,552,558,595` — presentational gating/styling keyed off `item.done`; no sync logic.

### Test coverage

No `*.test.ts(x)`/`*.spec.ts(x)` files exist anywhere under `src/`, and `package.json` has no `test` script. A `since`-based rewrite touching this many race conditions lands with manual/behavioral verification only — no regression suite as a safety net.

## Code References

- `src/lib/store.tsx:95-103` - `syncFromBackend`'s single `GET /shopping-items` call site, inside a `Promise.all` with 4 other endpoints
- `src/lib/store.tsx:116-161` - full TTL + reconciliation block (comment, `INPROGRESS_TTL_MS`, `inProgress` filter, `reconciled` map, final merge)
- `src/lib/store.tsx:164-200` - mount effect wiring the 4 sync triggers (mount, auth, visibilitychange, focus)
- `src/lib/store.tsx:272-297` - `toggleShoppingItem`, already patched this session to send `{ done: !current?.done }`
- `src/lib/store.tsx:298-301` - `removeShoppingItem`, optimistic local delete + `enqueue("DELETE", ...)`
- `src/lib/api/client.ts:31-44` - `readQueue`/`writeQueue`, the `localStorage` idiom to reuse for a cursor
- `src/lib/api/client.ts:105-120` - `enqueue`
- `src/lib/api/client.ts:129-167` - `flushQueue`, strict FIFO, head-of-line blocking on any `break`
- `src/lib/api/client.ts:169-185` - `apiGet`, no query-string support today
- `src/lib/api/types.ts:50-67` - `ShoppingItem` type, no `updated_at` field currently

## Architecture Insights

- Sync is purely event-driven (mount/auth/visibility/focus) — no polling interval exists to retrofit or worry about interacting with a cursor refresh cadence.
- The codebase already has a clean, reusable `localStorage` read/write wrapper idiom (`try { JSON.parse } catch { fallback }` + optional `CustomEvent` dispatch) used in two places (`client.ts`'s queue, `store.tsx`'s whole-state cache) — a cursor value is a natural third user of the same shape, not new infrastructure.
- `enqueue()` is the single choke point every store mutator goes through for backend sync — any reconciliation fix should stay compatible with its fire-and-forget, FIFO, offline-tolerant design rather than bypassing it.
- The existing `reconciled`/`inProgress` split in `syncFromBackend` shows the established pattern for "trust local optimistic state over a stale-looking server response" — the `since`-based rewrite is this same pattern, just driven by a cursor instead of a TTL guess.

## Historical Context (from prior changes)

- `context/changes/shopping-list-since-cursor-reconciliation/change.md` - the seed document for this very change; records the full backend contract from `homecraftapi-30` and explicitly scopes this change to shopping-items only, deferring the other 4 `since`-enabled endpoints as a separate decision.
- `context/foundation/roadmap.md` (~lines 8-15) - confirms sprint-1 items #5/#7 (this shopping-list-done-state-bug work) are tracked as joint frontend+backend work outside the roadmap's frontend-only item list (#1, #3, #8, #9, #10), pending exactly this cross-session contract.
- `context/changes/shopping-list-ux-fixes/plan.md` - establishes `dismissWarning`'s "optimistic `setState` + `enqueue(\"PATCH\", ...)` with a partial body" as the house pattern for store mutators, and documents `updateShoppingItem(id, patch)` as the generalized form — relevant precedent for how a cursor-aware `syncFromBackend` rewrite should look stylistically.
- `context/changes/finish-homesync-shopping-analytics/plan.md` - documents the full store-mutator surface (`addShoppingItems`, `toggleShoppingItem`, `removeShoppingItem`, `dismissWarning`, `completePurchase`, `dismissSuggestion`) and the `completePurchase()` sequencing contract (read done items → build Purchase → enqueue → remove done items → prepend record) — any reconciliation change touching `shopping` state must preserve this ordering.
- `context/changes/receipt-parse-and-categorize/plan.md` - documents the `categorize` store action precedent where the backend returns the full reordered shopping list and the store replaces the entire `shopping` array wholesale — an existing alternative pattern to incremental merge, worth weighing against a `since`-based partial-merge approach during planning.
- No archived change folder exists yet for shopping-list sync work — the only archive entry (`context/archive/2026-10-07-tab-reorder-and-profile-nav-access`) is unrelated.
- `context/foundation/lessons.md` does not exist in this repo.

## Related Research

None — this is the first research artifact for this change.

## Open Questions

- Does the backend's `since` response include any delete signal (tombstone, or a `deleted_at` field) for shopping items, or is hard-delete reconciliation genuinely only observable by the deleting device? Worth confirming with `homecraftapi-30` before planning — this determines whether a second-device "ghost item never disappears" bug is in scope to fix here or is an accepted limitation.
- Should the cursor be a single global "last synced at" value, or does it need to be per-resource (even though this change is shopping-items-only, the other 4 endpoints will want the same cursor pattern eventually per phase-3 of the backend work) — worth deciding the storage key/shape now to avoid rework when those land.
- Is replacing the full-fetch model with incremental `since`-merge worth the added race-condition surface (deletes, clock skew, in-flight-PATCH timing) for a household-scale shopping list, versus a simpler fix: keep the full fetch but request `since=<far past>` (effectively "give me everything including done") to at least drop the TTL workaround without taking on incremental-merge semantics? This tradeoff should be surfaced explicitly during planning rather than assumed.
