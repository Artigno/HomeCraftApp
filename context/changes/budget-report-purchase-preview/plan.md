# Preview Purchase Lines and Receipt Photo — Implementation Plan

## Overview

In the budget report's purchase detail view, show each purchased line's
quantity and unit price alongside its name/total-price, in addition to the
receipt photo and line list already shown today.

## ⚠️ Blocked on backend contract

This plan is written against a **not-yet-implemented** backend contract:
HomeCraftApi's `context/changes/budget-report-purchase-preview/plan.md`
(status: `planned`). `GET /purchases` does not yet return per-line `qty`/
`unit_price`. Do not start the "Automated" verification steps until that
backend plan has shipped — see `## Progress`.

## Current State Analysis

This feature is **largely already implemented** from an earlier pass:

- `src/routes/insights.tsx` ("Budżet" tab) lists recent purchases; tapping
  one opens `src/components/PurchaseDetailModal.tsx`.
- `PurchaseDetailModal` already:
  - Re-fetches `GET /purchases` on open specifically because
    `receipt_image_url` is a short-TTL (~10min) signed URL that may be
    stale by the time of tap (see its own code comment,
    `src/components/PurchaseDetailModal.tsx:25-27`) — this *is* the
    "re-fetch-on-revisit behavior given the URL's short TTL" the task asks
    to plan.
  - Renders the receipt photo when `receipt_image_url` is present, and a
    "Brak zdjęcia paragonu." placeholder otherwise.
  - Renders `display.lines` as a flat list of name + price.
- `Purchase` and `PurchaseLine` types (`src/lib/api/types.ts:66-97`)
  already carry `receipt_image_url?: string | null` on `Purchase` and
  `name`/`price`/`shopping_item_id` on `PurchaseLine`. **Missing**: `qty`
  and `unit_price` on `PurchaseLine` — the only genuinely new surface this
  contract adds.

### Key Discoveries:

- Because the photo + line-list + re-fetch-on-open scaffolding already
  exists and works, this plan's actual scope is narrow: extend the type,
  render two more fields per line, done. No new screen, no new modal, no
  new fetch call.
- The existing re-fetch already guards against a stale `receipt_image_url`;
  it incidentally also means `qty`/`unit_price` will always be fresh off
  the same re-fetch once the backend ships them — no additional staleness
  handling needed for the new fields.

## Desired End State

- Each line in `PurchaseDetailModal` shows quantity and unit price
  alongside the existing name/line-total, e.g. `Mleko · 2 × 4.50 zł` with
  the line total (`price`) still right-aligned as today.
- No other behavior changes: photo, placeholder, re-fetch-on-open, and the
  "not cached beyond current page load" comment/contract all stay exactly
  as implemented.

## What We're NOT Doing

- Not redesigning the modal's layout or adding new sections.
- Not adding a dedicated full-screen purchase-detail route — the existing
  modal already satisfies "expand/detail view per purchase row."
- Not changing how `receipt_image_url` is fetched/cached (already correct
  per the backend's short-TTL contract).
- Not backfilling `qty`/`unit_price` display for purchases the backend
  can't supply them for (e.g. legacy rows) — render only what the API
  sends; if a field is absent/null, omit that part of the line rather than
  showing "undefined" or "0".

## Implementation Approach

Single phase — this is a small, additive rendering change layered onto
already-shipped infrastructure. Splitting into multiple phases would be
artificial busywork for a change this size.

## Critical Implementation Details

- **Treat `qty`/`unit_price` as optional** even though the contract says
  "each line gains `qty`, `unit_price`" — until the backend plan is
  actually implemented and confirmed to always populate them (vs.
  nullable for edge cases like manual entries with no unit breakdown),
  render defensively: if either is missing, fall back to today's
  name/price-only line rendering instead of showing a broken "undefined ×
  undefined zł".

---

## Phase 1: Render qty + unit price per line

### Changes Required:

#### 1. Types

**File**: `src/lib/api/types.ts`

**Intent**: Add `qty?: number` and `unit_price?: number` to
`PurchaseLine` (alongside the existing `name`, `price`,
`shopping_item_id`).

#### 2. Render in the modal

**File**: `src/components/PurchaseDetailModal.tsx`

**Intent**: In the `display.lines.map(...)` block
(`src/components/PurchaseDetailModal.tsx:62-67`), add a secondary muted
line under/beside the name showing `${qty} × ${unit_price.toFixed(2)} zł`
when both `qty` and `unit_price` are present and `qty !== 1` (for a
`qty === 1` line, the unit price IS the line price — showing both is
redundant; only show the breakdown when there's more than one unit, per
Critical Implementation Details' defensive-rendering note). Keep the
existing right-aligned `line.price.toFixed(2)} zł` as the line total,
unchanged.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `bunx tsc -p tsconfig.json`
- Lint passes: `bun run lint`
- Build succeeds: `bun run build`

#### Manual Verification:

- Requires backend's extended `GET /purchases`. A purchase with
  multi-quantity lines shows `qty × unit_price` under the name, with the
  line total unchanged on the right.
- A purchase with `qty: 1` lines (or missing `qty`/`unit_price` entirely,
  e.g. a not-yet-migrated purchase) renders exactly as today — no
  breakdown shown, no broken text.
- Re-opening the modal for the same purchase after some time still
  re-fetches and shows a valid (non-expired) photo — confirms this change
  didn't regress the existing re-fetch-on-open behavior.

## Testing Strategy

No existing automated test suite found for components at planning time —
manual verification checklist per existing project convention.

## Performance Considerations

None — no new network calls, purely a rendering addition to data already
being fetched.

## Migration Notes

None — additive, optional fields.

## References

- Backend contract (not yet implemented): HomeCraftApi
  `context/changes/budget-report-purchase-preview/plan.md`
- Already-implemented groundwork: `src/components/PurchaseDetailModal.tsx`,
  `src/lib/api/types.ts:66-97`

## Open Questions

- **Does the backend always populate `qty`/`unit_price`, or can they be
  null for certain purchase types (e.g. manual entries)?** The contract
  text doesn't say. This plan renders defensively (omit the breakdown line
  when either is absent) to avoid assuming non-null; confirm against the
  real backend response once implemented and simplify the rendering
  condition if they turn out to always be present.
- **Line-total vs. unit-price semantics when `qty` isn't a whole number**
  (e.g. weighted produce, 0.73 kg) — contract doesn't specify formatting
  for non-integer `qty`; plan assumes straightforward numeric rendering
  (`0.73 × 12.90 zł`) but this should be confirmed against real backend
  data/copy conventions before implementation.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

**Unblocked** — backend's `qty`/`unit_price` were already live on
`GET /purchases` (shipped in an earlier pass alongside the detail-column
work; confirmed present in `PurchaseLineResource` before this frontend
change landed).

### Phase 1: Render qty + unit price per line

#### Automated

- [x] 1.1 Typecheck passes: `bunx tsc -p tsconfig.json` — 0459906
- [x] 1.2 Lint passes: `bun run lint` — 0459906
- [x] 1.3 Build succeeds: `bun run build` — 0459906

#### Manual

- [ ] 1.4 Multi-qty lines show `qty × unit_price` breakdown — pending user's own click-through
- [ ] 1.5 `qty: 1` / missing-field lines render unchanged (no breakdown, no broken text) — pending user's own click-through
- [ ] 1.6 Re-fetch-on-open regression check: photo still refreshes correctly — pending user's own click-through
