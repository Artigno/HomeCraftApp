# Shopping List Duplicate-Dispatch Fixes Implementation Plan

## Overview

Two independent fixes for duplicate shopping-list rows. Phase 1 closes the
confirmed double-create path found during `/10x-frame`: the
shopping-suggestion banner's "Dodaj" button has no guard against a second
tap/click, and clicking it never dismisses the banner. Phase 2 fixes the
user's original repro's actual root cause, found via live diagnostic
logging (see Phase 2's Overview): `addShoppingItems` and
`toggleShoppingItem` each run `enqueue()` (and, for add, `crypto.randomUUID()`
id generation) *inside* their `setState` updater function — the one
documented exception to a convention every other method in this file
follows. React may invoke a functional updater more than once per logical
update (a dev-mode purity check), and when it does, the side effect inside
replays too, producing a second real request with a second real id. An
earlier version of this plan's Phase 2 misdiagnosed the same symptom as an
external (browser-extension or human) double-dispatch and added a
time-window dedupe guard; that guard has been removed in favor of the
actual structural fix once the misdiagnosis was caught (see "Key
Discoveries").

## Current State Analysis

- `src/routes/shopping.tsx`'s suggestion banner (lines 280-301) renders when
  `suggestion` (the first entry of `suggestions` state) is truthy.
- The "Dodaj" `Button` (lines 284-290) calls `onClick={() =>
  addByName(suggestion.name)}` only — no disabled guard, and it never
  touches `suggestions` state, so the banner stays mounted and clickable
  after the click.
- The adjacent "X" dismiss button (lines 291-298) calls `void
  handleDismissSuggestion(suggestion)` (defined lines 89-93), which
  optimistically removes the suggestion from `suggestions` state via
  `setSuggestions((prev) => prev.filter((i) => i.id !== s.id))` *before*
  awaiting `apiDismissShoppingSuggestion`, then rolls back (re-prepends `s`)
  only if that call fails.
- `addByName` (lines 213-224) is synchronous apart from the `enqueue` call
  inside `addShoppingItems`; it does not return a promise the caller awaits.

## Desired End State

Clicking "Dodaj" adds the suggested item (unchanged) and also dismisses the
banner from view immediately (same optimistic-remove-then-rollback-on-
failure behavior the X button already has) — closing the window where a
second tap/click could fire `addByName` again for the same suggestion.

Verify: click "Dodaj" on a suggestion → item is added AND the banner
disappears immediately, without needing to also tap the "X". If the
dismiss network call fails, the banner reappears (existing rollback
behavior, unchanged) and a stray tap on it then would just re-add the
item under a new row — a harmless re-add, not a crash or data loss, and
no worse than the dismiss path's existing failure behavior today.

### Key Discoveries:

- Frame brief (`context/changes/shopping-duplicate-stale-sync/frame.md`)
  confirmed this is a real, independent double-create path (STRONG
  evidence, `shopping.tsx:284-290` vs. `293`), separate from — and not the
  mechanism behind — the user's original manual-add-row duplicate repro
  (which the frame left unresolved, confidence LOW, pending a reproduction
  with network/console logging; **out of scope here**, see "What We're NOT
  Doing").
- `handleDismissSuggestion` already implements the exact
  optimistic-remove/rollback-on-failure contract this fix needs — no new
  function required, just an additional call site.
- (Phase 2) Live `[DUP-DEBUG]` console instrumentation — temporarily added
  to `addShoppingItems`, `toggleShoppingItem`, `enqueue`, `flushQueue`, and
  `syncFromBackend`, then removed once the evidence was captured — caught
  the user's exact repro (manual "+ Dodaj produkt" row, confirmed single
  Enter press) in the act: two `addShoppingItems` calls with different
  UUIDs and the same name, zero intervening events, followed later in the
  same session by two `toggleShoppingItem` calls for the same id computing
  the identical `nextDone`. **First read (superseded)**: since React does
  not double-invoke click/keydown event handlers, this looked like an
  external double-dispatch (browser extension or human double-tap) — a
  time-window dedupe guard was built and then reverted once the real
  mechanism was found (see next bullet).
- **Corrected root cause**: the `[DUP-DEBUG]` log line that appeared to
  show "`toggleShoppingItem` called twice" was placed *inside* that
  function's `setState` updater — so what it actually showed was React
  invoking the *same* updater call twice (the identical, harmless
  dev-mode purity-check behavior already independently confirmed by
  `syncFromBackend`'s duplicated-but-identical merge-computation logs
  earlier in this same investigation). `grep -n "enqueue(" src/lib/store.tsx`
  shows every other method in the file calls `enqueue()` *outside* its
  `setState` updater — `addShoppingItems` (id generation + enqueue) and
  `toggleShoppingItem` (two enqueues) are the only two that do it inside.
  The file even documents the convention explicitly, in a comment above
  `completePurchase`'s enqueue call: "`enqueue()` runs outside the
  setState updater (which React defers to the next render, not this
  tick)... otherwise flushQueue() sees an empty queue and resolves
  instantly." These two functions are the one place that comment's rule
  was violated — and because `addShoppingItems` also mints a fresh
  `crypto.randomUUID()` inside the same updater, a replayed updater call
  doesn't just re-send the same request, it mints a **second real id**
  and creates a **second real row**.

## What We're NOT Doing

- Not auditing every other store method for the same anti-pattern beyond
  confirming via `grep` that only `addShoppingItems` and
  `toggleShoppingItem` call `enqueue()` inside their `setState` updater —
  every other method was already checked as part of locating these two
  (see "Key Discoveries"), so no further sweep is needed.
- Not determining precisely *why* React replays these two updaters in
  this dev environment (StrictMode vs. some other TanStack Start dev-mode
  default) — the fix (keep side effects out of the updater) is correct
  regardless of the trigger, per React's own documented contract that
  updater functions must be pure.
- Not addressing the "sync only happens on refresh" complaint — frame.md
  classified that as a separate scoping/design decision (whether to add
  idle-polling for cross-device pickup), not a bug.
- Not adding a disabled/in-flight state to the "Dodaj" button — dismissing
  on click already closes the practical double-tap window by unmounting
  the button on the first click; an in-flight flag would guard only a
  same-event-loop-tick double-tap with no observed real-world occurrence.
- Not suppressing the existing dismiss-rollback-on-failure behavior for
  this call site — a reappeared banner after a failed dismiss can at worst
  cause a harmless re-add (new row, same name), not a crash or data loss,
  and diverging this call site's rollback contract from the X button's
  would add complexity for a cosmetic edge case.

## Implementation Approach

Single-file, single-call-site change: add `void
handleDismissSuggestion(suggestion)` alongside the existing `addByName`
call in the "Dodaj" button's `onClick`, reusing the dismiss function
verbatim.

## Phase 1: Dismiss suggestion banner on "Dodaj" click

### Overview

Make the "Dodaj" button dismiss the suggestion banner (same optimistic
behavior as the "X" button) in addition to adding the item, closing the
double-create window.

### Changes Required:

#### 1. Dismiss-on-click for the "Dodaj" button

**File**: `src/routes/shopping.tsx`

**Intent**: Clicking "Dodaj" should both add the suggested item and remove
the banner from view immediately, so a second tap has nothing left to hit.

**Contract**: Change the "Dodaj" `Button`'s `onClick` (currently `() =>
addByName(suggestion.name)`, lines 284-290) to also call `void
handleDismissSuggestion(suggestion)` — same function, same call shape as
the existing "X" button's `onClick` at line 293. Order within the handler
does not matter (both are independent, synchronous-start calls); call
`addByName` first to match reading order with the existing "X" button
pattern of "the action, then the dismiss."

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npx tsc --noEmit`
- Lint passes: `npm run lint`

#### Manual Verification:

- Suggestion banner visible (bought an item >2 times, due by interval, not
  already on the list) → tap "Dodaj" → item appears in the pending list AND
  the banner disappears immediately, without touching "X".
- Double-tap "Dodaj" quickly → only one item is added (banner is gone after
  the first tap, so a fast second tap hits nothing).
- Tap "X" on a (different) suggestion → still dismisses as before, no
  regression to the existing dismiss path.
- With network disabled (devtools offline), tap "Dodaj" → item is added
  locally (queued) and the banner disappears; re-enable network → dismiss
  either succeeds silently or the banner reappears on failure (existing
  rollback behavior, unchanged) — either way, no duplicate item appears
  from this flow alone.

---

## Phase 2: Move side effects out of the setState updater

### Overview

Live diagnostic logging (temporarily added to `store.tsx`/`client.ts`,
since removed) caught the user's exact repro in the act:
`addShoppingItems` fired twice — two different client UUIDs, same name,
back-to-back, with no navigation/sync between them — and later in the
same session `toggleShoppingItem`'s two `enqueue()` calls fired twice
each. The initial read of this evidence treated it as two separate real
event-handler invocations and added a time-window dedupe guard (since
reverted). Re-checking where the diagnostic log line sat showed it was
*inside* the `setState` updater, meaning the actual finding is: React
invoked that single updater call twice (a known dev-mode purity check),
and because `enqueue()` (and, for add, `crypto.randomUUID()`) ran inside
the updater instead of outside it, the side effect replayed too —
producing a second real id and a second real request per logical action.
`grep -n "enqueue(" src/lib/store.tsx` confirms every other method in the
file already calls `enqueue()` outside its updater; these two are the
only exceptions.

### Changes Required:

#### 1. Hoist id/payload generation and `enqueue()` out of `addShoppingItems`'s updater

**File**: `src/lib/store.tsx`

**Intent**: The `setState` updater must stay a pure merge — no id
generation, no `enqueue()` — so a replayed updater call is a harmless
no-op repeat of the same computation, not a second real side effect.

**Contract**: Compute `baseOrder`, `nowIso`, and `created` (including each
item's `crypto.randomUUID()`) before calling `setState`, reading
`state.shopping` (the outer closure) instead of `s.shopping` for
`baseOrder` — the same pattern `toggleShoppingItem`'s guard-era read
already used, and the same pattern `daysSincePurchase` elsewhere in this
file uses for the same reason. Call `enqueue("POST", "/shopping-items/batch",
{ items: created })` once, outside `setState`. The updater itself becomes
`setState((s) => ({ ...s, shopping: [...s.shopping, ...created] }))` — a
pure append of the already-built `created` array.

#### 2. Hoist `nextDone`/`nextOrder` computation and both `enqueue()` calls out of `toggleShoppingItem`'s updater

**File**: `src/lib/store.tsx`

**Intent**: Same fix, same reason, for the toggle path's two `enqueue()`
calls (the `/toggle` PATCH and the `sort_order` PATCH).

**Contract**: Compute `current`, `nextDone`, and `nextOrder` from
`state.shopping` before calling `setState` (reusing the exact computation
the updater used to do, just reading the outer `state` instead of the
updater's `s`). Call both `enqueue(...)` calls once, outside `setState`.
The updater becomes a pure map: `setState((s) => ({ ...s, shopping:
s.shopping.map((i) => (i.id === id ? { ...i, done: nextDone, sort_order:
nextOrder } : i)) }))`.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npx tsc --noEmit`
- Lint passes: `npm run lint`

#### Manual Verification:

- Add an item once (type a name, Enter) → exactly one item appears; hard
  refresh (Cmd+R) immediately after → still exactly one (this is the
  user's exact repro — add then immediate hard refresh, no toggle needed).
- Toggle an item once → it moves to the done accordion exactly once (no
  double-PATCH visible in the Network tab for `/toggle` or the sort-order
  PATCH).
- Add two *different* items back-to-back quickly → both appear, each with
  a distinct id and no collision.
- Toggle an item, then untoggle it → both transitions apply correctly
  (pure-map updater has no special-casing to break this).
- Full regression on the original multi-step repro (add → hard refresh →
  toggle → hard refresh) → no duplicate at any step.

---

## Testing Strategy

### Unit Tests:

- None — no test runner exists in this repo (consistent with prior plans
  touching this file).

### Manual Testing Steps:

See each phase's Manual Verification above — no cross-phase rollup beyond
what each phase already lists.

## Performance Considerations

None — reuses an existing function, no new network calls or renders beyond
what dismissal already does.

## Migration Notes

None — client-side only, no schema or data changes.

## References

- Frame brief: `context/changes/shopping-duplicate-stale-sync/frame.md`
- Source: `src/routes/shopping.tsx:89-93` (`handleDismissSuggestion`),
  `213-224` (`addByName`), `280-301` (suggestion banner)
- Source: `src/lib/store.tsx` (`addShoppingItems`, `toggleShoppingItem`,
  `HomeSyncProvider`)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Dismiss suggestion banner on "Dodaj" click

#### Automated

- [x] 1.1 Typecheck passes
- [x] 1.2 Lint passes

#### Manual

- [x] 1.3 Tap "Dodaj" — item added, banner disappears immediately without touching "X"
- [x] 1.4 Double-tap "Dodaj" quickly — only one item added
- [x] 1.5 Tap "X" on a suggestion — still dismisses as before, no regression
- [x] 1.6 Offline tap "Dodaj" then reconnect — no duplicate item from this flow regardless of dismiss success/failure

### Phase 2: Move side effects out of the setState updater

#### Automated

- [x] 2.1 Typecheck passes
- [x] 2.2 Lint passes

#### Manual

- [x] 2.3 Add an item once (type name, Enter), then immediate hard refresh — exactly one item (the user's exact repro)
- [x] 2.4 Toggle an item once — single transition, no double-PATCH in Network tab
- [x] 2.5 Add two different items back-to-back — both appear, distinct ids, no collision
- [x] 2.6 Toggle then untoggle — both transitions apply correctly
- [x] 2.7 Full regression: add → hard refresh → toggle → hard refresh — no duplicate at any step
