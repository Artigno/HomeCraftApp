# Shopping Done-Items Clear Wiring — Plan Brief

> Full plan: `context/changes/shopping-done-items-clear-wiring/plan.md`

## What & Why

Backend deployed `GET /shopping-items` now returning `done=true` items by
default, plus a new `DELETE /shopping-items/done` bulk-clear endpoint. The
frontend's two "finish shopping" actions never call the backend to clear
done items — without wiring this in, checked-off items will now pile up
permanently in every household member's "Zakończone" section instead of
disappearing after checkout/discard.

## Starting Point

`discardCompletedShoppingItems()` and `completePurchase()` in
`src/lib/store.tsx` both already filter done items out of local state; only
`completePurchase()` talks to the backend at all (for the purchase record
itself, not the clear). Neither calls the backend to delete done rows. The
codebase already has the exact idiom needed — `enqueue("DELETE",
"/shopping-items/${id}")` in `removeShoppingItem()` — just not applied here.

## Desired End State

Checking off items and finishing shopping (either "discard" or "complete
purchase") actually clears those rows server-side, so they don't resurface
for this device or any other household member's device on the next sync.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Error handling on DELETE failure | Silent dead-letter | Matches every existing `enqueue("DELETE", ...)` call site — no new UX pattern needed | Plan |
| Empty-list guard | Skip enqueue when no done items | Avoids a pointless network call; store method shouldn't assume the UI's disabled-state invariant | Plan |
| Queue ordering in `completePurchase` | DELETE enqueued right after POST, same FIFO queue | `flushQueue()` already processes in order and stops on failure — this means the clear can never reach the backend before the purchase POST does, with zero new code | Plan |
| Sync race (DELETE not covered by `pendingIds` override regex) | Leave as-is | Narrow, cosmetic, self-correcting glitch — not worth the regex rework | Plan |
| Phasing | Single phase, both call sites together | Small mechanical change in one file, same pattern twice | Plan |

## Scope

**In scope:**
- `discardCompletedShoppingItems()` — add guarded `enqueue("DELETE", "/shopping-items/done")`
- `completePurchase()` — add `enqueue("DELETE", "/shopping-items/done")` after the existing POST enqueue

**Out of scope:**
- Any change to `GET /shopping-items` client handling — backend fix needs no frontend change
- New `api*` wrapper function in `client.ts` — bare `enqueue()` is enough
- Toast/error UI for failed clears
- Extending the `pendingIds` sync-override regex to cover the bulk DELETE
- Automated tests (none exist in this repo)

## Architecture / Approach

Both call sites get one extra `enqueue("DELETE", "/shopping-items/done")`
line, reusing the existing offline-first durable queue
(`src/lib/api/client.ts`) — no new client functions, no new error paths,
same FIFO ordering guarantee that already governs every other mutation in
this store.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Wire DELETE into both actions | Done items actually clear server-side on discard and on completed purchase | Narrow sync race (accepted, self-correcting) |

**Prerequisites:** Backend's `DELETE /shopping-items/done` and the
`GET /shopping-items` default-list fix are already deployed to prod.
**Estimated effort:** ~15-30 min, single phase, single file.

## Open Risks & Assumptions

- Assumes `DELETE /shopping-items/done` is idempotent / safe to call with an
  empty done-set in the rare case the guard's `some()` check and the actual
  clear race against a concurrent toggle from another device (not something
  we can fully close client-side).
- Narrow sync-race glitch (see Key Decisions) is accepted as cosmetic.

## Success Criteria (Summary)

- Discarding checked items clears them server-side (verified via reload).
- Completing a purchase clears bought items server-side (verified via
  reload), for both the manual-form and receipt-scan-review paths.
- A second device in the same household doesn't see cleared items resurface.
