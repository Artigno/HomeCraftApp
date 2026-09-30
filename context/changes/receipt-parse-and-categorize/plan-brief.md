# Receipt Parse and Categorize — Plan Brief

> Full plan: `context/changes/receipt-parse-and-categorize/plan.md`

## What & Why

Wires two AI-backed backend endpoints (already live) into the shopping
list: real receipt parsing to replace today's entirely-mocked OCR flow,
and a one-tap AI aisle-order sort. This is the frontend half of issues
#1 and #8, the last two items from the peer backend session's fixes list.

## Starting Point

`ReceiptCheckoutModal.tsx` is a full mock — fake processing delay, no
real upload, no per-line detail; `completePurchase()` splits the total
evenly across checked items instead of using real prices. No UI
anywhere calls the categorize endpoint yet. No multipart upload exists
in this codebase's API client.

## Desired End State

Adding a photo to checkout uploads it, shows an AI-parsed, fully editable
draft (store/category/total/date + per-line name/price, removable), and
saves exactly what's confirmed — with a clean fallback to today's manual
form on failure or skip. A "Kategoryzuj" button next to the Zakupy header
reorders the list into aisle groups in one tap.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
|---|---|---|
| Receipt review editability | Everything — store/total/category + per-line name/price + remove | AI receipt-reading isn't perfect; user needs a real correction path |
| Parse failure (422) | Fall back to today's existing manual form | Exact fallback the backend's contract calls for, zero new UI |
| Upload source | Camera + library (drop `capture="environment"`) | A receipt might already be a photo from elsewhere |
| Purchase date | Use AI's `purchased_at`, not "now" | More accurate, feeds the existing re-buy-suggestion feature |
| `shopping_item_id` | Pass through untouched, no client behavior | Matches backend's own framing ("queryable later"); nothing reads it yet |
| Categorize placement | Button in `/shopping`'s `PageHeader` action slot | Matches this app's existing header-action pattern |
| Categorize confirmation | None — just run, toast on result | It's a reorder not a delete, matches this app's instant-action convention |
| Categorize gate | Disabled at 0 pending items | Matches "Zakończ zakupy"'s existing disabled-when-nothing-checked pattern |

## Scope

**In scope:** multipart upload client function, receipt-parse types,
`completePurchase` gaining optional AI-derived lines/date, the review-step
UI, categorize API call + store action + header button.

**Out of scope:** any client behavior driven by `shopping_item_id`, a
retry-the-photo loop, a categorize confirmation dialog, changes to how
manual drag-reorder's `sort_order` works.

## Architecture / Approach

Phase 1 adds client-layer plumbing only (multipart upload is a new
pattern for this codebase — no `Content-Type` header, browser sets the
boundary). Phase 2 rebuilds the receipt modal on that plumbing, keeping
the existing manual-form fallback path byte-for-byte unchanged. Phase 3
adds the categorize button independently, touching a different part of
the same route file.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Client API layer | Multipart upload, types, categorize call | Low — new pattern but no UI, easy to get the header shape right |
| 2. Receipt parse UI | Real upload + editable AI review + fallback | Medium — most user-facing surface area, needs live-backend testing |
| 3. Categorize UI | Header button, store action | Low — small, isolated addition |

**Prerequisites:** Both backend endpoints already deployed and committed
(`c7a8741`, `7b1c506`).
**Estimated effort:** ~3 sessions, one per phase — Phase 2 likely needs
the most live-backend iteration.

## Open Risks & Assumptions

- Manual verification for Phases 2-3 requires a live backend and real
  AI calls — devtools mock data won't exercise the actual parse/
  categorize quality. The peer session offered to do a real end-to-end
  pass together once this UI exists — worth taking them up on it before
  considering this plan fully verified.
- The backend's own smoke test noted the AI categorize response dropped
  one item once (backend has a fallback so nothing is lost server-side)
  — this plan trusts the backend's returned list as-is and doesn't add
  client-side reconciliation against the pre-categorize list.

## Success Criteria (Summary)

- A user can photograph a receipt, review/correct the AI's read, and
  save it with real per-item prices — or fall back cleanly to manual
  entry on failure.
- A user can sort their pending shopping items into aisle order in one
  tap, with clear feedback on success or failure.
