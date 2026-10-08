# Frame Brief: Shopping list duplicate item & "sync only on refresh"

> Framing step before /10x-plan. This document captures what is *actually*
> at issue, separated from what was initially assumed.

## Reported Observation

1. Repro: add a product → hard refresh → check it done → hard refresh again
   → two identical products now on the list.
2. Separately: server sync "seems to only happen on a hard refresh" instead
   of continuously/live.

## Initial Framing (preserved)

- **User's stated cause or approach**: no specific mechanism named; framed
  as "this whole sync area needs a thorough review and fix."
- **User's proposed direction**: broad review/fix of shopping-list sync.
- **Pre-dispatch narrowing**: duplicate-item symptom picked as the leading
  concern (concrete repro) over the vaguer "only syncs on refresh" claim.
  Confirmed single device/single browser tab — no second device or
  household member involved. Confirmed the item was added via the manual
  "+ Dodaj produkt" row (not the suggestion banner), with a single
  tap/Enter — explicitly not a double-tap.

## Dimension Map

The duplicate could originate at any of these dimensions in the add→sync
path (`src/routes/shopping.tsx`, `src/lib/store.tsx`, `src/lib/api/client.ts`,
backend `ShoppingItemController.php`):

1. **Client-side double submit** — the add action fires twice for one user
   gesture, producing two items with different UUIDs and the same name.
2. **Interrupted-flush queue replay** — a hard refresh mid-flight resends an
   already-queued create on the next load, and the backend accepts the
   replay as a second row.          ← user's implied framing
3. **Resync merge concatenation** — `syncFromBackend`'s
   `[...base, ...unflushedLocalCreates]` fails to dedupe an id across the
   two source arrays.
4. **Sync cadence/triggers** — no polling/push mechanism; sync is
   mount/focus/visibility/own-action-triggered only, which the user
   perceives as "only on refresh."
5. **React double-invocation** (StrictMode or similar dev double-fire).

## Hypothesis Investigation

| Hypothesis | Evidence | Verdict |
| --- | --- | --- |
| 5: React double-invocation | No `StrictMode` anywhere in `src/` (grep, zero hits) | NONE |
| 1: Client double submit | `AddItemRow.commit()` wired only to Enter `onKeyDown` (shopping.tsx:396-401); `onBlur` (402-404) never calls `onAdd`/`commit()` — no dual-fire path for the manual row. A **real, separate** double-fire bug exists on the suggestion banner's "Dodaj" button (no `disabled` guard, and the click handler never dismisses the suggestion — shopping.tsx:284-290 vs. 293), but the user confirmed they used the manual row, not the banner. | WEAK (for the manual-row path actually used); STRONG but off-repro (banner) |
| 2: Interrupted-flush replay creating a 2nd row | Client generates the item's UUID (`crypto.randomUUID()`, store.tsx:331-339) and bakes it into the queued request body (client.ts:106-121) before any network call. Backend's `BatchStoreShoppingItemsRequest` validates `items.*.id` as `required\|uuid\|distinct\|unique:shopping_items,id` and `shopping_items.id` is a UUID **primary key** (migration 2026_09_25_131535, `ShoppingItem.php:17-19`). A byte-identical replay of an already-succeeded create fails that `unique` check → 422 → client dead-letters it (`client.ts:156`, `recordFailed`, entry removed) — **not** a second row. No code path mints a fresh id on retry. | NONE |
| 3: Resync merge fails to dedupe | `unflushedLocalCreates` (store.tsx:205-207) is explicitly filtered by `!fetchedIds.has(i.id)` — any id already present in the GET response is excluded from the carry-forward set. The two concatenated arrays (`base`, `unflushedLocalCreates`) are id-disjoint by construction; no explicit dedupe is needed because none is possible to skip. | NONE |
| 4: Sync cadence is trigger-only, not live | Full trigger list confirmed (store.tsx:242,251,258-262; client.ts:119,408,414-424) — mount, `homesync:auth`, `visibilitychange`, `focus`, `online`, and every `enqueue()` call's own immediate `flushQueue()`. Zero hits for `setInterval`/`WebSocket`/`EventSource`/polling anywhere in `src/`. For a tab's **own** actions, sync is already effectively live (`enqueue()` flushes immediately). What is genuinely refresh/focus-gated is picking up **other devices'/sessions'** changes into an already-open, foregrounded tab — there's no idle-polling refresh. | STRONG (but describes a design gap in cross-device propagation, not a bug in the user's own-tab repro) |

## Narrowing Signals

- User confirmed single device/tab — ruled out any multi-device race
  entirely (several otherwise-plausible mechanisms depend on a second
  writer).
- User confirmed the manual add row, single tap/Enter, no double-tap —
  ruled out the one double-submit path that *is* real in this codebase
  (suggestion banner) as the mechanism for this specific repro.
- Every mechanism that could plausibly create two DB rows for one
  logical add (replay-without-idempotency, merge-concatenation-without-dedupe)
  is independently guarded (DB unique constraint + 422 dead-letter;
  `!fetchedIds.has` filter) and traced clean.

## Cross-System Convention

No prior incident of this shape found: `git log` and
`context/changes/**`/`context/archive/**` have no earlier "duplicate
shopping item" report. The one hit for "duplicat" in
`shopping-drag-reorder-fix/plan.md` refers to JSX/component duplication,
unrelated to data duplication. This looks like a first occurrence, not a
regression of something previously patched and reverted.

## Reframed (or Confirmed) Problem Statement

> **The actual problem to plan around is**: unresolved — the investigated
> mechanisms (queue replay, merge-concatenation, client double-submit on
> the manual row, React double-invocation) are each independently ruled
> out by direct evidence, yet the user's repro (manual add, single tap,
> single device, two hard refreshes) produced a duplicate. One **confirmed,
> independent bug** exists in the same subsystem — the suggestion banner's
> "Dodaj" button has no disabled-guard and never dismisses itself on click,
> so a double-tap there genuinely creates two rows with the same name
> (`batchStore`'s name-dedupe only applies within a single request payload,
> not across requests) — but the user explicitly said that wasn't the path
> used.

This is not a case where the initial framing was simply correct or simply
wrong: the "sync only happens on refresh" half is accurate for cross-device
propagation (by design, not a bug) but not for the user's own actions in a
tab; the "duplicate" half has a real confirmed cause elsewhere in the
component (suggestion banner) but not, per the user's own account, in the
path they actually used. The evidence is honestly inconclusive for the
*exact* repro as stated.

## Confidence

- **LOW** — the specific repro's root cause is not located with the
  evidence gathered. Before planning a fix for *this* repro, reproduce it
  with the browser's network tab + console open (or server-side request
  logs for `/shopping-items/batch` around the relevant timestamps) to see
  whether a second POST actually hits the backend, with what id/name, and
  what the server actually returns for it. That single piece of evidence
  (one vs. two `/shopping-items/batch` calls, two different ids or one)
  would collapse the remaining ambiguity immediately.

## What Changes for /10x-plan

Two independent, already-separable pieces of work:

1. **Confirmed, ready to plan now**: fix the suggestion banner's "Dodaj"
   button — add a disabled/in-flight guard and dismiss the suggestion on
   click (mirroring the "X" dismiss handler), closing the one verified
   double-create path in this subsystem.
2. **Not ready to plan**: the user's exact repro (manual-row add) has no
   located root cause. Recommend reproducing with network/console logging
   open before writing a plan for it — otherwise /10x-plan would be
   guessing at a fix for a mechanism no evidence supports.

The "sync only on refresh" complaint, taken on its own, is a legitimate
design gap (no idle-polling pickup of other devices'/sessions' changes) —
if the user wants that specifically, it's a scoping/design decision
(poll on an interval? accept the current focus/visibility-triggered model?),
not a bug fix, and can be planned independently of the duplicate-item
investigation.

## References

- Source files: `src/routes/shopping.tsx:213-224,280-301,364-410`,
  `src/lib/store.tsx:110-231,326-342`, `src/lib/api/client.ts:106-168,407-425`
- Backend: `HomeCraftApi/app/Http/Controllers/ShoppingItemController.php:39-64`,
  `HomeCraftApi/app/Http/Requests/BatchStoreShoppingItemsRequest.php:21`,
  `HomeCraftApi/app/Models/ShoppingItem.php:17-32`,
  `HomeCraftApi/database/migrations/2026_09_25_131535_create_shopping_items_table.php:12`
- Related change: `context/changes/shopping-list-since-cursor-reconciliation/`
  (prior sync/merge work, read but not implicated by evidence)
