# Shopping List Duplicate-Dispatch Fixes — Plan Brief

> Full plan: `context/changes/shopping-duplicate-stale-sync/plan.md`
> Frame brief: `context/changes/shopping-duplicate-stale-sync/frame.md`

## What & Why

The user reported a shopping-list item duplicating after add/refresh/
toggle/refresh. `/10x-frame` ruled out every app-internal mechanism it
could check from code inspection alone, but turned up a different,
independently confirmed bug in the same subsystem: the shopping-suggestion
banner's "Dodaj" button double-creates on a double-tap (Phase 1). Live
diagnostic logging during implementation then caught the user's *actual*
repro's root cause (Phase 2): `addShoppingItems` and `toggleShoppingItem`
run `enqueue()` (and, for add, id generation) *inside* their `setState`
updater — the one place in the file that violates a convention every
other method follows. React can invoke a functional updater more than
once per logical update (a dev-mode purity check); when it does, the side
effect inside replays, minting a second real id and a second real row. An
earlier pass at Phase 2 misread the same log evidence as an external
double-dispatch (browser extension or human double-tap) and added a
time-window dedupe guard — that guard has been replaced with the actual
structural fix once the misdiagnosis was caught.

## Starting Point

`src/routes/shopping.tsx`'s suggestion banner "Dodaj" button had no
disabled guard and never dismissed on click (Phase 1 target).
`src/lib/store.tsx`'s `addShoppingItems`/`toggleShoppingItem` generated
ids and called `enqueue()` inside their `setState` updater (Phase 2
target) — confirmed via temporary `[DUP-DEBUG]` console logging (since
removed) and a `grep` across every `enqueue()` call site in the file,
which showed these two as the only methods with a side effect inside the
updater.

## Desired End State

Tapping "Dodaj" in the banner adds the item and dismisses the banner in
one action (Phase 1). `addShoppingItems`/`toggleShoppingItem`'s `setState`
updaters are pure merges with no side effects — a replayed updater call
(for whatever reason React replays it) is a harmless no-op repeat, not a
second real request (Phase 2).

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Phase 1 guard strategy | Dismiss-on-click only, no disabled state | Reuses existing dismiss logic verbatim; closes the race by unmounting the button | Plan |
| Phase 1 dismiss-failure behavior | Accept existing rollback (banner reappears) | A reappeared banner risks only a harmless re-add, not data loss | Plan |
| Phase 2 diagnosis (revised mid-implementation) | Impure setState updater, not external double-dispatch | The `[DUP-DEBUG]` log line that looked like "two separate calls" was placed inside the updater — it showed one `setState` call's updater being replayed, not two real event-handler invocations | Plan (corrected after live evidence) |
| Phase 2 fix shape | Hoist id-gen + enqueue() out of the updater, matching the file's own convention | Every other store method already does this; the file even has a comment documenting why | Plan |

## Scope

**In scope:** suggestion-banner double-add (Phase 1); moving side effects out of `addShoppingItems`/`toggleShoppingItem`'s `setState` updaters (Phase 2).

**Out of scope:** determining precisely *why* React replays these updaters in this dev environment (StrictMode vs. another TanStack Start dev-mode default) — the fix is correct regardless of the trigger; the "sync only on refresh" cadence question (separate design decision).

## Architecture / Approach

Phase 1: one-line change, dismiss-on-click reusing `handleDismissSuggestion`. Phase 2: compute ids/payloads and call `enqueue()` before `setState`, reading the outer `state` closure instead of the updater's `s` for any values needed up front; the updater itself becomes a pure append/map with no side effects — the same shape every other method in the file already uses.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Dismiss on "Dodaj" click | Banner disappears on add, closing that double-create window | None significant — reuses a proven existing function |
| 2. Pure setState updaters | Add/toggle survive a replayed updater call without duplicating | None significant — mirrors an existing, working pattern already used by every other method in the file |

**Prerequisites:** none.
**Estimated effort:** well under one session — small, targeted diffs in two files.

## Open Risks & Assumptions

- Why React replays these specific updaters in dev (StrictMode or a TanStack Start dev default) was not root-caused beyond "it does, and the fix doesn't depend on knowing why."

## Success Criteria (Summary)

- Tapping "Dodaj" in the banner adds the item and dismisses it in one action; a double-tap there produces only one item.
- Adding an item, then immediately hard-refreshing, produces exactly one item (the user's exact repro).
- Toggling an item produces exactly one state transition and no double-PATCH.
