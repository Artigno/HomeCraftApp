# Fix Vanish-After-Add Sync Race + Shopping-List Keyboard Tick — Plan Brief

> Full plan: `context/changes/store-sync-race-and-keyboard-fix/plan.md`

## What & Why

A household member adds a recipe; it shows briefly, then disappears — a
real data-loss bug, root-caused via systematic debugging to a resync race
in the app's offline-first sync layer. Bundled in the same change at the
user's request: the shopping-list input shows a confirm-looking
checkmark/tick on the mobile keyboard that doesn't actually confirm,
misleading users into thinking Enter is the only way to add an item.

## Starting Point

`src/lib/store.tsx`'s `syncFromBackend()` wholesale-replaces
`recipes`/`tasks`/`purchases`/`tins` from the server's GET response on
every resync (mount, tab focus, push, pull-to-refresh). It has zero
protection for a row created locally whose create request hasn't reached
the backend yet. The exact same race already happened — and was already
fixed — for shopping items (`fetchItemsForTag`, same file), which carries
forward any local item still covered by a pending create. No one ever
applied that fix to the other four domains.

## Desired End State

Adding a recipe/task/tin/purchase survives any resync that lands mid-flush
— it stays visible until the server confirms it, same guarantee shopping
items already have. Tapping the shopping-list keyboard's return key
(checkmark icon) always adds the typed product, matching what the icon
promises.

## Key Decisions Made

| Decision                         | Choice                                            | Why                                                                      | Source |
| --------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------- | ------ |
| Scope of race fix                 | All 4 domains (recipes, tasks, purchases, tins)    | Same `setState` call overwrites all four identically — fixing one leaves 3 ticking | Plan |
| Patch-race (not just create-race) | Out of scope for `update*` calls                   | No per-row override needed for these domains' lower-frequency edits right now | Plan |
| Keyboard fix bundling             | Same change, separate phase                        | User asked for both in one request; phases keep the diffs independent    | Plan |
| Test infra                        | Add minimal vitest (no test runner existed at all) | Needed for any automated regression guard on the new merge logic         | Plan |

## Scope

**In scope:**
- Generalizing the shopping-items carry-forward pattern to recipes, tasks,
  purchases, tins
- Adding a minimal vitest setup + one test file for the merge logic
- Fixing `AddItemRow`'s keyboard-tick/blur mismatch in `shopping.tsx`

**Out of scope:**
- Backend changes
- The offline queue mechanism itself (`enqueue`/`flushQueue`)
- A pending-PATCH override for `updateRecipe`/`updateTask`/etc.
- Any UI/visual redesign beyond the keyboard return-key hint
- A general React component test harness (E2E, RTL, coverage tooling)

## Architecture / Approach

Extract `fetchItemsForTag`'s existing create-carry-forward logic into a
small generic helper (`carryForwardUnflushedCreates`), parameterized by
each domain's queue path. Apply it at `syncFromBackend`'s single
wholesale-replace `setState` call for all four arrays. The keyboard fix is
independent: make `AddItemRow`'s `onBlur` call the same `commit()` Enter
already uses, and set `enterKeyHint="done"` explicitly.

## Phases at a Glance

| Phase                  | What it delivers                                      | Key risk                                             |
| ----------------------- | ------------------------------------------------------ | ----------------------------------------------------- |
| 1. Test infrastructure  | vitest wired in, `npm run test` works                  | New devDependency must not affect prod build          |
| 2. Sync-race fix        | recipes/tasks/purchases/tins survive a mid-flush resync | Must not duplicate rows that already landed server-side |
| 3. Keyboard tick fix    | mobile return key reliably adds the typed product       | Must not break existing Enter / empty-blur behavior    |

**Prerequisites:** none — single-file-plus-one-component change, no
external dependencies beyond adding vitest itself.
**Estimated effort:** ~1 session, 3 phases.

## Open Risks & Assumptions

- Assumes `/receipts/process`'s queued body is the flat `Purchase` object
  (confirmed from `completePurchase` in `store.tsx`) — if that ever
  changes shape, the helper's per-domain id-extraction needs updating too.
- No existing test harness means Phase 1's vitest config is new surface
  area; kept deliberately minimal (Node environment, no DOM/RTL) to limit
  risk.

## Success Criteria (Summary)

- Adding a recipe/task/tin/purchase right before a resync no longer makes
  it disappear.
- The shopping-list keyboard's return key (tick icon) always adds the
  typed product.
- `npm run test`, `npm run lint`, and `npm run build` all pass.
