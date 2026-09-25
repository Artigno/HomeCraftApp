# Finish HomeSync — Shopping List & Analytics — Plan Brief

> Full plan: `context/changes/finish-homesync-shopping-analytics/plan.md`

## What & Why

The Lovable-built HomeSync PWA has Modules 1–3 done (Maintenance Dashboard, Task Wizard, Cookbook) but Modules 4 (Shopping List + Receipt OCR checkout) and 5 (Analytics/Insights) were never built — despite the bottom nav already linking to `/shopping` and `/insights`, both of which currently 404. This plan finishes those two modules so the app matches the original build prompt and the nav bar stops lying.

## Starting Point

`src/lib/store.tsx` already implements every mutator the new UI needs (`addShoppingItems`, `toggleShoppingItem`, `removeShoppingItem`, `dismissWarning`, `completePurchase`, `dismissSuggestion`, `daysSincePurchase`) — this is a UI-layer gap, not a data-layer one. `recharts` is installed but unused. The manifest references two PNG icons that don't exist in `public/`.

## Desired End State

Tapping any of the 4 bottom-nav tabs works. Users can quick-add items to a shopping list, get warned when they're about to re-buy something bought recently, swipe to delete, get a gentle "you're probably out of X" suggestion, check out via a mock-OCR receipt flow, and see the resulting spend broken down by store/category and by month on an insights page.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Receipt OCR | Mock delay + editable manual fields | No real backend endpoint exists yet; the manual-edit fallback is needed regardless of OCR success | Plan |
| Suggestion trigger | Average purchase interval per product (velocity), not a flat day threshold | Matches spec's "purchase velocity" language and existing `purchases` data | Plan |
| Swipe-to-delete | Real pointer-based swipe gesture (custom hook, no new dependency) | Matches spec literally; user chose this over the tap-badge shortcut | Plan |
| Analytics scope | Donut (store/category toggle) + Bar (monthly) + recent-purchases list | Full spec scope; data already available in `purchases` | Plan |
| Complete Purchase button | Disabled at 0 checked items | Matches existing disabled-button pattern in cookbook's add-to-list modal | Plan |
| PWA icons | Generate flat-color placeholder PNGs via pre-installed Playwright Chromium screenshot | Fixes broken manifest with zero new dependencies; explicitly a placeholder | Plan |
| Module sequencing | Shopping list phases before analytics phases | Analytics displays purchases the shopping/checkout flow generates | Plan |

## Scope

**In scope:** `/shopping` route (quick-add, tap-complete, swipe-delete, warning badges, suggestion banner), receipt checkout modal (mock OCR), `/insights` route (donut + bar + recent list), PWA icon files, nav dead-link fix (falls out naturally once routes exist).

**Out of scope:** real Laravel/OCR backend integration, new test framework, any change to Dashboard/Wizard/Cookbook, auth/multi-user, final icon branding, chart virtualization/pagination.

## Architecture / Approach

Two new flat TanStack routes (`shopping.tsx`, `insights.tsx`) consuming the existing `useHomeSync()` store context — no new store methods. Two new pure-function modules (`lib/suggestions.ts`, `lib/analytics.ts`) isolate the only genuinely new logic (purchase-velocity calc, monthly/store aggregation) from JSX. One new reusable hook (`hooks/use-swipe-to-delete.ts`) and one new modal component (`components/ReceiptCheckoutModal.tsx`).

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Shopping List core | `/shopping` works: list, quick-add, tap-complete, recipe badges | Low — direct reuse of cookbook's add-to-list shape |
| 2. Swipe/warnings/suggestion | Swipe-delete, warning trash/zatwierdź, suggestion banner | Suggestion velocity math and swipe gesture are the two genuinely new pieces of logic |
| 3. Receipt checkout | Mock-OCR modal wired to `completePurchase()` | Getting the mock "processing" UX to feel honest about being a placeholder |
| 4. Analytics/Insights | `/insights` with donut + bar + recent list | Recharts is a first-time integration in this codebase |
| 5. PWA icons + QA | Fixed manifest, full nav verified, lint/typecheck/build green | Icon generation via headless screenshot is a slightly unusual step |

**Prerequisites:** None — all data dependencies already exist in `src/lib/store.tsx`.
**Estimated effort:** ~5 sessions, one per phase, each independently shippable.

## Open Risks & Assumptions

- Suggestion algorithm needs ≥2 historical purchases of a product to compute an interval — new products never get suggested in v1, which is expected/acceptable per the spec's "velocity" framing.
- No test runner exists in the repo; verification for the two new pure-function modules relies on typecheck + manual review rather than unit tests.
- Placeholder PWA icons are intentionally not final branding — flagged for later replacement.

## Success Criteria (Summary)

- All 4 bottom-nav tabs work with zero 404s.
- Full recipe → shopping list → checkout → insights flow works end-to-end in the running dev server.
- `bun run lint`, `bunx tsc --noEmit`, and `bun run build` all pass at the end of every phase.
