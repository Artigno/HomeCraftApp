# Fix Vanish-After-Add Sync Race + Shopping-List Keyboard Tick — Implementation Plan

## Overview

Two unrelated bugs, bundled into one change at the user's request:

1. A recipe (and, by the same mechanism, a task/purchase/tin) added to the
   app shows up briefly, then disappears. Root cause: `syncFromBackend()`
   wholesale-replaces those four arrays from the server's GET response on
   every resync, with no protection for a locally-created row whose create
   request hasn't flushed to the backend yet.
2. The shopping-list "add product" input shows a checkmark/tick-style
   mobile-keyboard return key, but tapping it just hides the keyboard
   without adding the product — only a physical Enter key actually commits.
   The icon looks like confirm but isn't.

## Current State Analysis

`src/lib/store.tsx`'s `syncFromBackend()` (lines 240-302) fetches
`tasks`/`recipes`/`purchases`/`tins`/`tags` in parallel and, at lines
285-293, replaces `state.tasks`/`recipes`/`purchases`/`tins` wholesale with
whatever the GET returned:

```js
setState((s) => ({
  ...s,
  tasks,
  recipes,
  purchases,
  tins,
  tags,
  logs: incremental ? s.logs : [],
}));
```

Every mutator for these four domains (`addRecipe`, `addTask`, `addTin`,
`completePurchase`, and their `update*`/no-update equivalents) does an
optimistic local `setState` insert and `enqueue()`s the matching HTTP call
onto the durable offline queue (`src/lib/api/client.ts`). `enqueue()` fires
`flushQueue()` fire-and-forget — it does not block the caller.

`syncFromBackend()` itself runs on mount, on `homesync:auth`, on
`visibilitychange`/`focus` ("return to app"), on a push-channel broadcast,
and on manual pull-to-refresh (all wired in the mount `useEffect`, lines
304-355). Any of these can fire before a just-enqueued create has actually
reached the backend — most plausibly the `visibilitychange`/`focus`
listener firing the instant the user navigates back to a list route right
after creating something there (e.g. `cookbook.new.tsx` calls `addRecipe()`
then `navigate({ to: "/cookbook" })` immediately, with no wait for the
flush).

The exact same race already exists — and is already fixed — for shopping
items. `fetchItemsForTag` (lines 141-234) handles it two ways:

- **Pending PATCH override** (lines 174-187): for a full or incremental
  fetch, any shopping-item id with a PATCH still in the queue keeps its
  pre-sync local `done`/`sort_order` instead of the (stale) fetched value.
- **Pending create carry-forward** (lines 199-220, full resync only): any
  local item whose id is covered by a still-queued
  `POST /shopping-items/batch` for the current tag, and that's absent from
  the fetched set, is appended back onto the fetched list instead of being
  dropped.

No equivalent logic exists for `recipes`, `tasks`, `purchases`, or `tins` in
`syncFromBackend`.

Separately, `AddItemRow` in `src/routes/shopping.tsx` (lines 639-685) wires
Enter via `onKeyDown` (`e.key === "Enter"` → `commit()`) but its `onBlur`
(lines 677-679) only calls `setActive(false)` when `draft` is empty — when
`draft` has text and the input blurs (e.g. the mobile keyboard's return key
fires a blur without a synthesized Enter keydown, which is the common case
on iOS Safari/Android Chrome when no `enterKeyHint` is set), nothing
commits and the keyboard just closes. No `inputMode`/`enterKeyHint`/`type`
prop is set on the `<Input>`, so the browser's default return-key glyph is
whatever it falls back to — in this app's report, a tick/checkmark that
visually promises "confirm."

There is no test runner in the repo at all: no `vitest`/`jest` dependency,
no `test` script in `package.json`.

## Desired End State

- Adding a recipe, task, tin, or completing a purchase survives any resync
  that lands before the create has flushed — the optimistic row stays
  visible until the server confirms it, exactly like shopping items already
  do.
- Tapping the shopping-list input's return key (checkmark or otherwise)
  always adds the typed product, matching what the icon promises; Enter
  continues to work identically.
- A minimal vitest setup exists, with one test file proving the new merge
  logic in `syncFromBackend` carries forward an unflushed create and does
  not duplicate an already-landed one.

### Key Discoveries:

- `src/lib/store.tsx:199-220` (`fetchItemsForTag`'s create carry-forward)
  and `src/lib/store.tsx:174-187` (its PATCH override) are the reference
  patterns to generalize — same shape, different domain/queue-path.
- `src/lib/store.tsx:285-293` is the single wholesale-replace call site to
  fix for all four domains at once.
- `src/routes/shopping.tsx:639-685` (`AddItemRow`) is the only place the
  keyboard-tick bug lives; `commit()` (lines 643-648) is already the single
  source of truth for "add the typed product" and is safe to call from
  `onBlur` too (it's a no-op on an empty/whitespace draft).

## What We're NOT Doing

- Not adding a pending-PATCH override for `updateRecipe`/`updateTask`
  (there's no per-row override for these domains being added — see the
  edge-case decision below: only the create race is in scope, not the
  patch race, since confirmed with the user as lower-value here).
- Not touching the backend, the offline queue mechanism itself
  (`enqueue`/`flushQueue`), or the shopping-items logic (`fetchItemsForTag`)
  — it already works correctly and is only the reference pattern.
- Not building a general test framework beyond the minimum to run one
  vitest file (no React Testing Library, no E2E, no coverage tooling).
- Not changing the visual design of the shopping-list input beyond the
  keyboard return-key hint.

## Implementation Approach

Generalize `fetchItemsForTag`'s two guards into domain-agnostic helpers
usable from `syncFromBackend`, parameterized by the queue path(s) each
domain's `enqueue()` calls use (`POST /recipes`, `POST /maintenance-tasks`,
`POST /tins`, `POST /receipts/process`). Apply the create-carry-forward
guard to all four arrays at the `setState` call site in `syncFromBackend`.
Fix the keyboard issue independently in the same `AddItemRow` component.
Add vitest first so Phase 2's new merge logic has a regression test from
the start, per TDD.

## Phase 1: Minimal Test Infrastructure

### Overview

Add vitest so Phase 2 can ship with an automated regression test. No other
behavior changes in this phase.

### Changes Required:

#### 1. Vitest dependency + config

**File**: `package.json`

**Intent**: Add `vitest` as a dev dependency and a `test` script so `npm
run test` (and CI, if any exists later) can run the suite.

**Contract**: `"scripts"` gains `"test": "vitest run"`; `"devDependencies"`
gains `"vitest"` (latest stable compatible with the project's Vite/Node
version).

#### 2. Vitest config

**File**: `vitest.config.ts` (new, repo root)

**Intent**: Point vitest at a Node environment (the code under test —
`syncFromBackend`'s merge logic — is pure state-reduction, no DOM needed)
and the existing `@` path alias used elsewhere in the repo.

**Contract**: Minimal `defineConfig({ test: { environment: "node" } })`
plus the same `@` → `src` alias `vite.config.ts`'s underlying Vite config
already resolves (reuse `vite-tsconfig-paths` or mirror `tsconfig.json`'s
`paths`, whichever is simpler to wire without fighting the
`@lovable.dev/vite-tanstack-config` wrapper).

### Success Criteria:

#### Automated Verification:

- `npm run test` runs and exits 0 with zero test files (before Phase 2 adds
  one) or passes trivially on a placeholder
- `npm run lint` still passes (no stray unused config)
- `npm run build` still succeeds (new devDependency doesn't leak into the
  production bundle)

#### Manual Verification:

- `vitest.config.ts` picked up correctly (confirm via `npx vitest --version`
  / a dry run with `--run --reporter=verbose`)

**Implementation Note**: After completing this phase and all automated
verification passes, pause here for manual confirmation from the human
that the manual testing was successful before proceeding to the next
phase.

---

## Phase 2: Fix the Vanish-After-Add Sync Race

### Overview

Generalize the shopping-items carry-forward pattern to `recipes`, `tasks`,
`purchases`, and `tins` inside `syncFromBackend`, and add a unit test
proving it.

### Changes Required:

#### 1. Generic carry-forward helper

**File**: `src/lib/store.tsx`

**Intent**: Extract a small, domain-agnostic version of the create
carry-forward logic currently inlined in `fetchItemsForTag` (lines
199-220) so `syncFromBackend` can reuse it for four domains without
duplicating the filter/set-diff logic four times.

**Contract**: A pure function (module-level, outside the component, so
Phase 2's unit test can import it directly) with a signature along the
lines of:

```ts
function carryForwardUnflushedCreates<T extends { id: string }>(
  fetched: T[],
  local: T[],
  pendingIds: Set<string>,
): T[]
```

— returns `fetched` plus any `local` row whose `id` is in `pendingIds` and
absent from `fetched`. `pendingIds` is computed by the caller per domain
from `readQueue()` filtered to that domain's create path(s), mirroring the
existing `pendingCreateIds` computation at lines 207-215 (note `/receipts/
process`'s queued body is the `Purchase` object itself, not a wrapper —
match on `r.body` as `{id?: string}` directly, unlike the
`/shopping-items/batch` case which nests an `items` array).

#### 2. Apply the helper at the wholesale-replace site

**File**: `src/lib/store.tsx`

**Intent**: Stop `syncFromBackend`'s `setState` call (lines 285-293) from
dropping an unflushed local create for any of the four domains.

**Contract**: Before the `setState` call, compute `pendingIds` for each of
`recipes` (`POST /recipes`), `tasks` (`POST /maintenance-tasks`), `tins`
(`POST /tins`), and `purchases` (`POST /receipts/process`) from
`readQueue()`, and replace the raw `tasks`/`recipes`/`purchases`/`tins`
values passed into `setState` with
`carryForwardUnflushedCreates(fetched, s.<domain>, pendingIds)` — reading
the pre-sync `s.<domain>` requires moving this computation inside the
`setState` updater function (the same way `fetchItemsForTag` reads
`s.shopping` inside its own updater), since the previous in-React-state
value, not the closure's `state`, is what must be diffed against.

### Success Criteria:

#### Automated Verification:

- `npm run test` passes, including the new test file below
- `npm run typecheck` passes (if a typecheck script exists; otherwise `npx
  tsc --noEmit`)
- `npm run lint` passes
- `npm run build` succeeds

#### Manual Verification:

- Add a recipe, immediately background the tab (or switch away and back)
  before the network request could plausibly land — recipe stays visible
  on return
- Repeat for a maintenance task, a tin, and completing a purchase
- Confirm a recipe that genuinely exists server-side is not duplicated
  after a normal resync (the carry-forward only adds rows absent from the
  fetched set)

**Implementation Note**: After completing this phase and all automated
verification passes, pause here for manual confirmation from the human
that the manual testing was successful before proceeding to the next
phase.

---

## Phase 3: Fix the Shopping-List Keyboard Tick

### Overview

Make the shopping-list "add product" input's return key actually add the
product when tapped, regardless of whether the mobile keyboard fires a
true `Enter` keydown or only a blur — and make its icon correctly signal
that.

### Changes Required:

#### 1. `AddItemRow`'s input

**File**: `src/routes/shopping.tsx`

**Intent**: Make `onBlur` commit a non-empty draft instead of doing
nothing, so the return key's checkmark icon's implied behavior
("confirm") matches what actually happens. Explicitly set the keyboard
hint so the glyph is intentional rather than a browser default.

**Contract**: In the `<Input>` at lines 667-682 — add `enterKeyHint="done"`
so the tick icon is explicit, and change the `onBlur` handler (lines
677-679) to call `commit()` when `draft.trim()` is non-empty (in addition
to the existing `setActive(false)` branch for an empty draft). `commit()`
already resets `draft` to `""` and is idempotent/safe to call from blur —
no change needed to `commit()` itself.

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes
- `npm run build` succeeds

#### Manual Verification:

- On a mobile device/emulator: type a product name, tap the keyboard's
  return/tick key (not Enter on a physical keyboard) — product is added
  and appears in the list
- Enter key (desktop/physical keyboard) still adds the product as before
- Tapping the tick/return key with an empty draft still collapses the
  input back to the "Dodaj produkt" button (no regression on existing
  empty-blur behavior)

**Implementation Note**: After completing this phase and all automated
verification passes, pause here for manual confirmation from the human
that the manual testing was successful before proceeding to the next
phase.

---

## Testing Strategy

### Unit Tests:

- `carryForwardUnflushedCreates`: fetched set missing a locally-pending id
  → id is carried forward; fetched set already containing that id → no
  duplicate; empty pending set → fetched returned unchanged (identity
  behavior, same as today).
- One test per domain's queue-path shape: `/recipes`/`/maintenance-tasks`/
  `/tins` (plain object body) and `/receipts/process` (also a plain object
  body, confirming the `/shopping-items/batch` nested-`items` shape isn't
  assumed).

### Integration Tests:

- None added — no test harness exists for the React component tree, and
  building one is out of scope (see "What We're NOT Doing").

### Manual Testing Steps:

1. Add a recipe from a slow/throttled connection, navigate away and back
   within a couple seconds — recipe is still there.
2. Repeat for a task, a tin, and a purchase.
3. On a phone, open the shopping list, type a product, tap the keyboard's
   return key — product is added, keyboard closes, item visible in list.
4. Confirm Enter-key-on-desktop and empty-draft-blur-collapses behaviors
   are unchanged.

## Performance Considerations

None — the carry-forward helper runs over in-memory arrays already held in
state, same cost class as the existing shopping-items version which runs
on every tag-fetch already.

## Migration Notes

Not applicable — no data model or storage format changes.

## References

- Reference pattern: `src/lib/store.tsx:141-234` (`fetchItemsForTag`)
- Wholesale-replace site: `src/lib/store.tsx:240-302` (`syncFromBackend`)
- Keyboard bug site: `src/routes/shopping.tsx:639-685` (`AddItemRow`)
- Offline queue: `src/lib/api/client.ts` (`enqueue`/`flushQueue`/`readQueue`)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Minimal Test Infrastructure

#### Automated

- [x] 1.1 `npm run test` runs and exits 0
- [x] 1.2 `npm run lint` still passes
- [x] 1.3 `npm run build` still succeeds

#### Manual

- [ ] 1.4 `vitest.config.ts` picked up correctly

### Phase 2: Fix the Vanish-After-Add Sync Race

#### Automated

- [x] 2.1 `npm run test` passes, including the new test file
- [x] 2.2 `npm run typecheck` passes
- [x] 2.3 `npm run lint` passes
- [x] 2.4 `npm run build` succeeds

#### Manual

- [ ] 2.5 Recipe added right before a resync stays visible
- [ ] 2.6 Same for a maintenance task
- [ ] 2.7 Same for a tin
- [ ] 2.8 Same for completing a purchase
- [ ] 2.9 No duplicate rows after a normal resync

### Phase 3: Fix the Shopping-List Keyboard Tick

#### Automated

- [x] 3.1 `npm run lint` passes
- [x] 3.2 `npm run build` succeeds

#### Manual

- [ ] 3.3 Tapping the mobile keyboard's return/tick key adds the product
- [ ] 3.4 Enter key still works on desktop/physical keyboard
- [ ] 3.5 Empty-draft blur still collapses the input as before
