# Correct Receipt-Line-to-Shopping-Item Matches — Implementation Plan

## Overview

In the Budget tab's purchase detail view, let users see which shopping-list
item each receipt line was auto-matched to, and correct a wrong match via a
picker — so the backend's suggestion-matching model (see
`shopping-suggestion-matching-accuracy`) learns from corrected ground truth
on future receipts.

## ⚠️ Blocked on backend contract

This plan is written against a **not-yet-implemented** backend contract:
HomeCraftApi's `context/changes/budget-product-linking/plan.md` (status:
`planned`). `GET /purchases` does not yet return `shopping_item_id` /
`shopping_item_name` per line, and `PATCH
/purchases/{purchaseId}/lines/{lineId}` does not exist. Do not start the
"Automated" verification steps of any phase until that backend plan has
shipped — see `## Progress`.

## Current State Analysis

- The Budget tab is `src/routes/insights.tsx` ("Budżet" header) — it lists
  purchases and opens `src/components/PurchaseDetailModal.tsx` on tap.
- `PurchaseDetailModal` already re-fetches `GET /purchases` on open (to get
  a fresh `receipt_image_url`, per its own code comment) and renders
  `display.lines` as a flat name/price list (`src/components/
  PurchaseDetailModal.tsx:61-68`).
- `PurchaseLine` (`src/lib/api/types.ts:66-70`) **already has**
  `shopping_item_id?: string | null` — a field from an earlier pass, not
  yet rendered or editable anywhere. The contract's new
  `shopping_item_name` field does not exist on the type yet.
- `apiGetShoppingItems` (`src/lib/api/client.ts:258-280`) is the existing
  call backing the shopping-list screen (`GET /shopping-items`, optional
  `?since=`) — returns `{ok:true, items: ShoppingItem[]} |
  {ok:false, invalidSince} | null`. `ShoppingItem` has a plain `name` field
  (`src/lib/api/types.ts:50-64`). This is the "whatever already backs the
  shopping-list screen" the task contract points at for the picker — no new
  backend endpoint needed for item 2 itself (see Open Questions for the one
  caveat: it returns *current* items, not necessarily the historical item a
  past receipt line matched against if since removed/renamed).
- No `PATCH` call for purchases exists yet; closest existing PATCH
  convention is `apiPatchNotificationPreferences`
  (`src/lib/api/client.ts:426-440`) — direct fetch, not through the
  offline `enqueue()` queue.

### Key Discoveries:

- `PurchaseDetailModal`'s existing re-fetch-on-open already guarantees a
  fresh `lines` array (and will include `shopping_item_name` once the
  backend ships it) — the correction UI can live directly in this modal
  without adding another round trip for staleness.
- The picker's source list (`apiGetShoppingItems`) returns **current**
  shopping items only, not a point-in-time snapshot from when the receipt
  was parsed — matches the "not retroactive, future receipts only" framing
  in the backend contract: the user is choosing from today's list to steer
  tomorrow's matching, not rewriting history.

## Desired End State

- Each line in `PurchaseDetailModal` shows its matched shopping-item name
  (or "Niepowiązane" / unlinked styling) alongside name/price.
- Tapping a line's match (or a small "popraw" affordance next to it) opens
  a picker (reuse `src/components/ui/select.tsx` or a small sheet/dialog —
  see Phase 2) listing the household's current shopping items plus an
  explicit "Brak powiązania" (unlink) option.
- Selecting an item calls `PATCH /purchases/{id}/lines/{lineId}` with the
  new `shopping_item_id` (or `null` to unlink); on success the modal's
  local line state updates optimistically-then-confirmed; on 422/404 the
  correction is rolled back with an error toast.
- A one-line, persistent note in the modal makes clear the correction only
  affects future matching, not this past purchase's own categorization.

## What We're NOT Doing

- Not changing how automatic matching itself works (that's the backend's
  `shopping-suggestion-matching-accuracy` concern).
- Not bulk-editing matches across multiple purchases at once.
- Not surfacing match-confidence scores or "why was this matched" — just
  the current match and the ability to correct it.
- Not building a new backend endpoint ourselves if `GET /shopping-items`
  turns out insufficient for the picker (flagged as an open question
  instead — see below).
- Not reaching into `src/routes/shopping.tsx` or its drag-reorder/swipe
  logic; this reads shopping items, it doesn't touch the shopping list UI.

## Implementation Approach

Two phases: (1) extend the type/API layer and render the current match
read-only; (2) add the picker + PATCH call. Splitting this way lets the
read side (which only needs the `GET /purchases` extension) be verified
independently of the write side (which needs both endpoints).

## Critical Implementation Details

- **Optimistic update + rollback**: since this is a correction a user makes
  deliberately (tap → pick → confirm), prefer optimistic local update with
  a toast-based rollback on failure (consistent with `addRecipe`/
  `addTin`'s optimistic-then-queued pattern elsewhere in the codebase),
  rather than a blocking spinner — but do NOT route this through the
  offline `enqueue()` queue: unlike those calls, a 422/404 here is a real,
  immediately-knowable validation failure (cross-household id, mismatched
  ids) the user should see right away, not something to silently retry
  later from a queue.
- **"Not retroactive" copy must be visible at the moment of correction**,
  not buried in a help screen — put it directly in the picker UI (e.g. a
  small caption under the picker), since this is the one concrete UX
  consequence the backend contract calls out as non-obvious.

---

## Phase 1: Render current match (read side)

### Overview

Extend types and render each line's matched-item name in
`PurchaseDetailModal`, no editing yet. Verifiable as soon as `GET
/purchases` ships the new fields, independent of the PATCH endpoint.

### Changes Required:

#### 1. Types

**File**: `src/lib/api/types.ts`

**Intent**: Add `shopping_item_name: string | null` to `PurchaseLine`
(`shopping_item_id` already exists). No change to `Purchase` itself.

#### 2. Render match in the modal

**File**: `src/components/PurchaseDetailModal.tsx`

**Intent**: Under/beside each line's name, show `line.shopping_item_name`
when present, or a muted "Niepowiązane" label when
`shopping_item_id === null`. Purely presentational in this phase — no tap
handler yet.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `bunx tsc -p tsconfig.json`
- Lint passes: `bun run lint`
- Build succeeds: `bun run build`

#### Manual Verification:

- Requires backend's extended `GET /purchases`. Opening a purchase with
  matched lines shows each line's matched item name; an unmatched line
  shows "Niepowiązane".

---

## Phase 2: Correct the match (write side)

### Overview

Adds the picker and the `PATCH` call, with the "not retroactive" messaging
and optimistic-update-with-rollback behavior.

### Changes Required:

#### 1. API client function

**File**: `src/lib/api/client.ts`

**Intent**: `apiPatchPurchaseLine(purchaseId: string, lineId: string,
shoppingItemId: string | null): Promise<{ok:true, line:PurchaseLine} |
{ok:false, status:number}>` — direct fetch, mirroring
`apiPatchNotificationPreferences`'s shape (not queued/offline — see
Critical Implementation Details). Surface 422 and 404 as distinct
`status` values so the caller can show a specific message
("to nie jest produkt tego gospodarstwa" vs. a generic error) if useful,
but at minimum roll back on either.

#### 2. Picker UI

**File**: `src/components/PurchaseDetailModal.tsx` (or a new
`src/components/LinkShoppingItemPicker.tsx` if the inline JSX gets large —
prefer extracting if the modal file grows past ~150 lines as a result)

**Intent**: Each line becomes tappable (inline-edit affordance, not a
separate full-screen flow — consistent with the modal's existing compact,
single-screen feel). Tapping opens a `Select` (or a small bottom sheet if
the household's shopping-item count makes a native `<select>`-style
dropdown awkward on mobile — match whatever the shopping-list screen
itself already uses for item pickers, if one exists) populated from
`apiGetShoppingItems()`, plus a "Brak powiązania" option mapping to `null`.
A fixed caption under the picker: "Zmiana dotyczy tylko przyszłych
paragonów — nie wpływa na ten zakup." (wording placeholder, confirm final
copy with product).

#### 3. Optimistic update + rollback

**File**: `src/components/PurchaseDetailModal.tsx`

**Intent**: On selection, immediately update the local `fresh` purchase's
line (`shopping_item_id`/`shopping_item_name`) in component state, call
`apiPatchPurchaseLine`, and on failure revert to the pre-selection value
plus a `toast.error(...)` (matches the `sonner` toast convention already
used in `cookbook.new.tsx`).

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `bunx tsc -p tsconfig.json`
- Lint passes: `bun run lint`
- Build succeeds: `bun run build`

#### Manual Verification:

- Requires both backend endpoints live. Correcting a line's match updates
  the picker and the displayed name immediately; reopening the modal
  (fresh re-fetch) shows the correction persisted.
- Unlinking a line (picking "Brak powiązania") sends `shopping_item_id:
  null` and renders "Niepowiązane" afterward.
- Forcing a 422/404 (e.g. a stale/cross-household id) rolls the UI back
  and shows an error toast, without crashing the modal.
- The "not retroactive" caption is visible without extra taps whenever the
  picker is open.

## Testing Strategy

- No existing automated test suite found for routes/components at planning
  time — match the existing project convention of manual verification
  checklists unless a test runner has since been introduced.
- Both phases' manual verification requires the respective backend
  endpoint(s) to be live.

## Performance Considerations

- `apiGetShoppingItems()` is already called elsewhere in the app (shopping
  list screen) with no caching concerns raised there; reuse it as-is for
  the picker rather than introducing a new caching layer.

## Migration Notes

None — additive field on an existing type; existing `shopping_item_id`
field on `PurchaseLine` was already present but unused, this plan activates
it.

## References

- Backend contract (not yet implemented): HomeCraftApi
  `context/changes/budget-product-linking/plan.md`
- Related backend context: HomeCraftApi
  `context/changes/shopping-suggestion-matching-accuracy/` (the matching
  logic this UI corrects)
- Existing modal to extend: `src/components/PurchaseDetailModal.tsx`
- Existing shopping-items fetch: `src/lib/api/client.ts:258-280`
  (`apiGetShoppingItems`)

## Open Questions

- **No endpoint exists to list shopping items for the picker beyond
  current, live items** — `GET /shopping-items` returns the household's
  *current* list. If a user wants to correct a match to an item that was
  since deleted from the shopping list (e.g. it was a one-off purchase
  never re-added), there's no way to pick it via this endpoint. Flagging
  per the task's explicit ask: if this gap matters for the real-world
  correction flow, a new backend endpoint (e.g. a broader "all items ever
  seen in this household" list, or allowing free-text match-to-a-past-
  purchase-line-name) may be needed — not assumed here, left as a decision
  for backend planning.
- **Picker UI pattern (native select vs. sheet vs. combobox)** — no
  existing "pick one item from a list" pattern was found elsewhere in this
  codebase to copy exactly; Phase 2 defers the final choice to
  implementation time, constrained only by "reuse `ui/select.tsx` unless
  the item count makes that unusable on mobile."
- **Exact "not retroactive" copy** — placeholder wording given; needs
  product/copy sign-off before implementation.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

**Unblocked 2026-10-15** — HomeCraftApi shipped the extended `GET /purchases`
and `PATCH /purchases/{purchaseId}/lines/{lineId}` (commits `77d90a0`,
`a1d2b74`, the latter adding `id` to the line payload after an initial gap
was found during frontend wiring).

### Phase 1: Render current match (read side)

#### Automated

- [x] 1.1 Typecheck passes: `bunx tsc -p tsconfig.json` — 545b32a
- [x] 1.2 Lint passes: `bun run lint` — 545b32a
- [x] 1.3 Build succeeds: `bun run build` — 545b32a

#### Manual

- [ ] 1.4 Matched lines show matched item name; unmatched show "Niepowiązane" — pending user's own click-through on the live app

### Phase 2: Correct the match (write side)

#### Automated

- [x] 2.1 Typecheck passes: `bunx tsc -p tsconfig.json` — 545b32a
- [x] 2.2 Lint passes: `bun run lint` — 545b32a
- [x] 2.3 Build succeeds: `bun run build` — 545b32a

#### Manual

- [ ] 2.4 Correcting a match persists across modal re-open — pending user's own click-through
- [ ] 2.5 Unlinking sends `shopping_item_id: null` and renders unmatched — pending user's own click-through
- [ ] 2.6 422/404 rolls back UI + shows error toast — pending user's own click-through
- [ ] 2.7 "Not retroactive" caption visible when picker is open — implemented, visible whenever a purchase has lines
