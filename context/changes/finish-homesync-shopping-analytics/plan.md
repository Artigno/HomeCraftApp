# Finish HomeSync — Shopping List & Analytics Implementation Plan

## Overview

HomeSync (the HomeSync PWA scaffolded by Lovable from the original build prompt) has Modules 1–3 complete — Maintenance Dashboard, Task Wizard/Icon Picker, and Cookbook — but Modules 4 (Shopping List + Receipt OCR checkout) and 5 (Analytics/Insights) do not exist. The bottom nav bar already links to `/shopping` and `/insights`, both of which 404 today. This plan builds both remaining modules on top of the store logic that already exists (`src/lib/store.tsx` already has `addShoppingItems`, `toggleShoppingItem`, `removeShoppingItem`, `dismissWarning`, `completePurchase`, `dismissSuggestion`, `daysSincePurchase`), fixes the two dead nav links, and replaces the broken PWA manifest icon references.

## Current State Analysis

- `src/routes/` has `index.tsx` (Dashboard), `__root.tsx` (shell + `TabBar` with 4 tabs), `cookbook.tsx` + `cookbook.index.tsx` + `cookbook.$recipeId.tsx`. No `shopping.tsx` or `insights.tsx` — clicking those tabs 404s via the router's `notFoundComponent`.
- `src/lib/store.tsx:16-30` (`StoreValue`) and `src/lib/api/types.ts` already define `ShoppingItem`, `Purchase`, `PurchaseLine` and every mutator the new UI needs. No new store methods are required for Phases 1–3.
- `src/lib/api/client.ts` provides `enqueue()` (offline queue + auto-flush) — every store mutator already calls it, so new UI just calls store methods and sync is automatic.
- `recharts` (`^2.15.4`) is installed but has zero imports anywhere in `src/` — Phase 4 is the first consumer.
- `public/manifest.webmanifest:12-24` references `/icon-192.png` and `/icon-512.png`; neither file exists in `public/`.
- Established UI vocabulary to reuse: `PageHeader` (title/subtitle/action slot + pending-sync banner), `card-soft` class + `ring-[var(--status-*)]` tokens, `accentBg`/`accentText`/`statusStyles` from `src/lib/accent.ts`, shadcn `Dialog`/`Drawer`/`Checkbox`/`Button`/`Input`, `toast` from `sonner`, haptic feedback via `navigator.vibrate` (already wrapped inside store mutators — no new haptic code needed in UI).
- No test runner is configured (no vitest/jest in `package.json`). `typescript` and `eslint` are devDependencies; `bun run lint` and `bunx tsc --noEmit` are the available static checks. `bun run build` runs a full Vite production build.

## Desired End State

- Tapping "Zakupy" and "Budżet" in the bottom nav renders working pages instead of 404s.
- `/shopping`: quick-add bar, tap-to-complete, swipe-to-delete, recipe-source badges, amber warning badges (with trash/zatwierdź actions) on recently-bought items, a non-intrusive repetitive-item suggestion banner, and a "Complete Purchase" button that opens a receipt checkout modal wired to `completePurchase()`.
- `/insights`: a donut chart (spending by store/category, toggle), a bar chart (month-over-month spend), and a recent-purchases list, all fed by `purchases` already in the store (including the new ones created via the checkout flow).
- `public/icon-192.png` and `public/icon-512.png` exist and the manifest resolves cleanly (verifiable via browser devtools Application > Manifest, no console errors).
- **Verification**: `bun run lint`, `bunx tsc --noEmit`, and `bun run build` all pass; manual click-through of both new tabs plus the full recipe → shopping list → checkout → insights flow works end-to-end in the running dev server.

### Key Discoveries:

- `src/routes/cookbook.$recipeId.tsx:57-70` (`confirmAdd`) is the reference implementation for turning a selection into `addShoppingItems()` calls with `recent_purchase_days` pre-computed via `daysSincePurchase` — Phase 1's quick-add and Phase 2's warning badges follow the same shape.
- `src/routes/index.tsx:82-107` (`editMode` + trash badge pattern) is the reference for the shopping list's per-item delete affordance — reused conceptually, not swipe, since delete-via-tap-badge already exists as a proven pattern; swipe is additive per the user's explicit choice.
- `daysSincePurchase(name)` in `src/lib/store.tsx:74-83` returns the **minimum** days-since-purchase across matching purchase lines — Phase 2's suggestion algorithm needs the **average interval between consecutive purchases** of a product, which is a different computation and must be added as a new pure function, not reuse `daysSincePurchase`.

## What We're NOT Doing

- No real Laravel backend integration or real OCR/image-recognition — the receipt "processing" step is a UI-level mock delay per the confirmed design decision; `enqueue("POST", "/receipts/process", ...)` already fires against `VITE_API_URL` and silently queues offline, which is correct and untouched.
- No new test framework (vitest/jest) — out of scope; verification stays lint + typecheck + build + manual.
- No changes to the Maintenance Dashboard, Task Wizard, Icon Picker, or Cookbook modules — they are complete and untouched.
- No account/multi-user/auth work — HomeSync's store is single-device localStorage state, consistent with the existing app.
- No final production branding for the PWA icons — Phase 5 icons are an explicit placeholder (flat color + glyph), swappable later.
- No virtualization/pagination for the purchases list or charts — data volumes are small (seed has 6 purchases; this is a household app, not enterprise scale).

## Implementation Approach

Build strictly on existing store/API surface — zero new store methods for Phases 1–3, two new pure-function modules (`lib/suggestions.ts`, `lib/analytics.ts`) for Phases 2 and 4 so the non-trivial logic (velocity calc, monthly aggregation) is isolated from JSX and independently readable. Each phase ends with the app in a fully working state (no half-built screens), so the plan can be paused after any phase without leaving a dead nav link worse than it started.

## Critical Implementation Details

**State sequencing in the checkout flow**: `completePurchase()` (`src/lib/store.tsx:143-165`) already does the correct sequencing — it reads `s.shopping.filter(i => i.done)` at call time, builds the `Purchase` from exactly those items, enqueues the sync call, then removes only the done items and prepends the purchase. The Phase 3 modal must call `completePurchase({ store, total, category })` **after** the user confirms the mocked-OCR fields, not before — calling it early would archive items before the user has entered a total.

**Suggestion banner suppression**: the store already has `dismissed_suggestions: string[]` and `dismissSuggestion(name)`. The Phase 2 suggestion logic must treat a name as suppressed once it appears in `dismissed_suggestions` **and stay suppressed until the item is manually re-added** to the shopping list (per the original spec's "suppressed until manually added again") — the existing `addShoppingItems` call sites don't clear this, so Phase 2 must add one line to the manual quick-add handler (not the store) that also removes the name from `dismissed_suggestions` when a user manually adds something that was previously dismissed, or the suggestion would never resurface even after being re-added and re-consumed. Simplest correct rule: a name is shown as a suggestion when it is (a) not currently `done: false` on the shopping list already, and (b) not in `dismissed_suggestions`; re-adding manually is naturally already excluded by condition (a) without needing to mutate `dismissed_suggestions` on add — clearing it is only needed if the item is later removed again and the interval condition re-triggers. Keep `dismissed_suggestions` monotonic (only the existing `dismissSuggestion` appends to it) — do not add new store mutations in this plan.

## Phase 1: Shopping List — Core List & Quick Add

### Overview

Stand up `/shopping` as a working route: header, quick-add bar, list rendering with tap-to-complete, and the recipe-source badge — enough for the tab to stop 404ing and for the existing cookbook → shopping-list flow to have somewhere to land.

### Changes Required:

#### 1. Shopping route

**File**: `src/routes/shopping.tsx`

**Intent**: New top-level route (flat file, mirrors `index.tsx`) rendering the shopping list screen: `PageHeader` with title "Zakupy" and subtitle showing pending-item count, a sticky bottom quick-add input (autofocus on submit, Enter or button adds), and the list of `shopping` items from `useHomeSync()` sorted with not-done items first.

**Contract**: `createFileRoute("/shopping")` exporting `component: ShoppingList`. Quick-add calls `addShoppingItems([{ name, amount: undefined, recipe_title: undefined, recent_purchase_days: daysSincePurchase(name), warning_dismissed: false }])` — the same shape `cookbook.$recipeId.tsx` already produces, so warning badges (Phase 2) work immediately for manually-added items too.

#### 2. List item rendering

**File**: `src/routes/shopping.tsx` (same file)

**Intent**: Each item shows name, optional `amount`, a recipe-source badge (`"{name} (Przepis: {recipe_title})"` styled as a small chip) when `recipe_title` is set, and toggles `done` (strikethrough + muted) on tap via `toggleShoppingItem(id)`.

**Contract**: Reuses `card-soft` / `cn()` conventions from `index.tsx`. Items with `done: true` render with `line-through text-muted-foreground` and sort to the bottom.

### Success Criteria:

#### Automated Verification:

- Lint passes: `bun run lint`
- Type checking passes: `bunx tsc --noEmit`
- Build succeeds: `bun run build`

#### Manual Verification:

- Tapping "Zakupy" in the bottom nav renders the shopping list (no 404).
- Typing a name in the quick-add bar and pressing Enter adds it to the top of the list, input stays focused and clears.
- Tapping an item toggles its done state (strikethrough) and calls `toggleShoppingItem`.
- Adding ingredients from a recipe (existing cookbook flow) shows them on `/shopping` with the recipe-source badge.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Shopping List — Swipe-to-Delete, Warning Actions & Suggestion Banner

### Overview

Add the three interaction layers the spec calls for on top of the Phase 1 list: swipe-to-delete gesture, the amber warning badge with its trash/zatwierdź quick actions, and the non-intrusive repetitive-purchase suggestion banner.

### Changes Required:

#### 1. Swipe-to-delete hook

**File**: `src/hooks/use-swipe-to-delete.ts`

**Intent**: A small reusable hook that tracks horizontal pointer drag on a list-item element, exposes a `translateX` style value and an `isRevealed` boolean once the drag crosses a threshold, and calls an `onDelete` callback when the user taps the revealed delete affordance (or drags past a "commit" threshold). Pointer-events based (`onPointerDown/Move/Up`), no new dependency.

**Contract**: `useSwipeToDelete({ onDelete }): { bind: (el) => PointerEventHandlers, style: CSSProperties, isRevealed: boolean, reset: () => void }`. Threshold values (reveal ~64px, commit ~120px) are implementation detail, not user-configurable in v1.

#### 2. Wire swipe hook into list items

**File**: `src/routes/shopping.tsx`

**Intent**: Each list item uses `use-swipe-to-delete` to reveal a trash icon behind it on left-swipe; tapping the revealed icon calls `removeShoppingItem(id)`.

**Contract**: Item wrapper becomes a two-layer stack (background delete affordance + foreground draggable row), matching the `translateX` from the hook.

#### 3. Warning badge with quick actions

**File**: `src/routes/shopping.tsx`

**Intent**: When `item.recent_purchase_days !== undefined && item.recent_purchase_days <= 7 && !item.warning_dismissed`, render an amber badge ("kupiono {days} dni temu" — same copy/threshold as `cookbook.$recipeId.tsx:112-116`) with two inline quick-action icons: a trash icon (removes the item via `removeShoppingItem`) and a check icon labeled "Zatwierdź" (calls `dismissWarning(id)`, which flips `warning_dismissed` and hides the badge).

**Contract**: No new store method — `removeShoppingItem` and `dismissWarning` already exist and match exactly.

#### 4. Suggestion computation

**File**: `src/lib/suggestions.ts`

**Intent**: Pure function computing which product names should be suggested for re-purchase: for each distinct product name across `purchases[].lines`, compute the average interval (in days) between consecutive purchase dates of that name (requires ≥2 historical purchases of it); if `daysSincePurchase(name) >= averageInterval`, the item is not already `done: false` on the current shopping list, and the name is not in `dismissed_suggestions`, it's a candidate. Return at most one suggestion at a time (the most overdue candidate) to keep the banner non-intrusive per spec.

**Contract**: `computeSuggestion(purchases: Purchase[], shopping: ShoppingItem[], dismissed: string[]): string | undefined`. Pure, no store/React dependency — independently readable and reasoned about.

#### 5. Suggestion banner UI

**File**: `src/routes/shopping.tsx`

**Intent**: Render a dismissible banner above the list when `computeSuggestion(...)` returns a name: "Kończy się {name}? Dodaj do listy" with an "Dodaj" action (calls the same quick-add path as Phase 1, using the suggested name) and a dismiss (X) action calling `dismissSuggestion(name)`.

**Contract**: Banner is derived state (`useMemo` on `[purchases, shopping, dismissed_suggestions]`), not stored separately — no persistence needed beyond what `dismissed_suggestions` already provides.

### Success Criteria:

#### Automated Verification:

- Lint passes: `bun run lint`
- Type checking passes: `bunx tsc --noEmit`
- Build succeeds: `bun run build`

#### Manual Verification:

- Left-swiping a shopping list item reveals a delete affordance; tapping it removes the item.
- An item with `recent_purchase_days <= 7` shows the amber "kupiono X dni temu" badge with trash + zatwierdź actions; zatwierdź hides the badge without removing the item; trash removes it.
- With the seed data (or after manually creating purchase history for a product with a short interval), a suggestion banner appears for an overdue-to-repurchase product not currently on the list; dismissing it hides it and it does not reappear until the product is removed from `dismissed_suggestions`'s suppression condition (i.e., re-added and consumed again).

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Receipt Checkout Flow (Mocked OCR)

### Overview

Add the "Complete Purchase" button and its modal: image upload/capture UI, a simulated processing delay, and an editable form (store, total, category) that calls the existing `completePurchase()` store method.

### Changes Required:

#### 1. Complete Purchase button

**File**: `src/routes/shopping.tsx`

**Intent**: A button (disabled when zero items have `done: true`, per the confirmed design decision) below the list, visible only when at least one item exists, opening the checkout modal.

**Contract**: `disabled={!shopping.some(i => i.done)}`, same disabled-button pattern as `cookbook.$recipeId.tsx:192`.

#### 2. Receipt checkout modal

**File**: `src/components/ReceiptCheckoutModal.tsx`

**Intent**: A `Dialog` with two internal steps: (1) an image `<input type="file" accept="image/*" capture="environment">` styled as a big tap target ("Zrób zdjęcie / Dodaj paragon") plus a "Pomiń zdjęcie" skip option; selecting a file or skipping transitions to a ~1.2s simulated "processing" state (spinner + "Analizujemu paragon…" copy), then (2) an editable form pre-filled with best-effort defaults (store: last-used store name or empty, total: sum of a naive per-item estimate, category: last-used category or "Spożywcze") that the user can correct before confirming.

**Contract**: `ReceiptCheckoutModal({ open, onOpenChange, boughtItems }: { open: boolean; onOpenChange: (o: boolean) => void; boughtItems: ShoppingItem[] })`. On confirm, calls `completePurchase({ store, total, category })` from `useHomeSync()`, shows a success `toast`, and closes. The selected image file itself is never uploaded anywhere (no backend endpoint exists for it yet) — it only drives the UI's "processing" simulation state; this is the explicit scope boundary from the confirmed design decision.

### Success Criteria:

#### Automated Verification:

- Lint passes: `bun run lint`
- Type checking passes: `bunx tsc --noEmit`
- Build succeeds: `bun run build`

#### Manual Verification:

- With ≥1 item checked as done, "Complete Purchase" opens the modal; with 0 checked, the button is disabled.
- Choosing a photo (or "Pomiń zdjęcie") shows a brief processing state, then an editable store/total/category form.
- Confirming archives the done items (they disappear from the shopping list), creates a new entry in `purchases`, and shows a success toast.
- Canceling the modal leaves the shopping list untouched.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Analytics / Insights

### Overview

Build `/insights`: a donut chart of spending by store or category (togglable), a bar chart of month-over-month spend, and a recent-purchases list — all fed by `purchases`, including ones created in Phase 3.

### Changes Required:

#### 1. Aggregation helpers

**File**: `src/lib/analytics.ts`

**Intent**: Pure functions turning `Purchase[]` into chart-ready shapes: grouping totals by `store` or by `category` (for the donut), and grouping totals by calendar month (for the bar chart), sorted chronologically.

**Contract**: `groupByField(purchases: Purchase[], field: "store" | "category"): Array<{ name: string; value: number }>` and `groupByMonth(purchases: Purchase[]): Array<{ month: string; total: number }>` (month labeled e.g. `"2026-08"` or a localized short label — implementer's call, consistent with `date-fns` already in dependencies).

#### 2. Insights route

**File**: `src/routes/insights.tsx`

**Intent**: New flat route rendering `PageHeader` (title "Budżet"), a toggle (sklep/kategoria) driving the donut's grouping, the donut chart, the bar chart below it, and a scrollable recent-purchases list (store, date, total) beneath both charts.

**Contract**: `createFileRoute("/insights")` exporting `component: Insights`. Uses `recharts`' `PieChart`/`Pie`/`Cell` for the donut and `BarChart`/`Bar` for the monthly chart, colored via the existing `--accent-*` CSS custom properties (read via `getComputedStyle` or a small static palette array matching `ACCENTS` from `IconPicker.tsx` — reuse that array's color order rather than inventing a new palette so chart colors stay visually consistent with the rest of the app).

### Success Criteria:

#### Automated Verification:

- Lint passes: `bun run lint`
- Type checking passes: `bunx tsc --noEmit`
- Build succeeds: `bun run build`

#### Manual Verification:

- Tapping "Budżet" in the bottom nav renders the insights page (no 404).
- Donut chart reflects seed `purchases` totals per store; toggling to category re-groups it correctly.
- Bar chart shows one bar per month present in `purchases`, values matching manual sum-check.
- Completing a purchase via Phase 3's flow updates both charts and the recent-purchases list on next visit to `/insights` (store is shared via `useHomeSync()`, no extra wiring needed).

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 5: PWA Icons, Nav Verification & Final QA

### Overview

Replace the broken manifest icon references with real placeholder PNGs, do a final pass confirming both nav tabs and the manifest resolve cleanly, and run the full verification suite.

### Changes Required:

#### 1. Generate placeholder PWA icons

**File**: `public/icon-192.png`, `public/icon-512.png`

**Intent**: Flat-color square icons (background matching the manifest's `theme_color` `#f8fafc` or a HomeSync accent color, with a simple centered glyph — e.g. a house shape) at 192×192 and 512×512, generated by rendering a small HTML/CSS snippet with the pre-installed Playwright Chromium (`executablePath: '/opt/pw-browsers/chromium'`) and screenshotting it at each size — no new npm dependency required. This is an explicit placeholder per the confirmed design decision, swappable later with real branding.

**Contract**: Output files must be valid PNG, sized exactly 192×192 and 512×512, matching the `sizes` fields already declared in `public/manifest.webmanifest:12-24`.

#### 2. Final verification pass

**File**: N/A (no code change — verification only)

**Intent**: Confirm the manifest resolves without console errors, both `/shopping` and `/insights` nav tabs work, and the full lint/typecheck/build suite is green.

**Contract**: N/A.

### Success Criteria:

#### Automated Verification:

- Lint passes: `bun run lint`
- Type checking passes: `bunx tsc --noEmit`
- Build succeeds: `bun run build`

#### Manual Verification:

- Browser devtools > Application > Manifest shows both icons loading with no errors.
- All four bottom-nav tabs (Dom, Przepisy, Zakupy, Budżet) navigate to working pages with no 404s.
- Full end-to-end walkthrough: add a recipe's missing ingredients to the shopping list → check some off → complete purchase via the receipt modal → see the new purchase reflected on `/insights`.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful.

---

## Testing Strategy

### Unit Tests:

- No test runner is configured in this repo (out of scope to add one — see "What We're NOT Doing"). `lib/suggestions.ts` and `lib/analytics.ts` are written as pure functions specifically so they *could* be unit-tested if a runner is added later, but this plan verifies them manually + via typecheck.

### Integration Tests:

- None (no test runner). Covered by the manual end-to-end walkthrough in Phase 5.

### Manual Testing Steps:

1. Full recipe → shopping list → checkout → insights walkthrough (Phase 5's final bullet).
2. Suggestion banner: manually adjust seed purchase dates (or wait/simulate) to confirm a suggestion surfaces and is suppressible.
3. Swipe-to-delete on both a touch device/emulator and desktop pointer to confirm the gesture works on both input types.
4. Offline check: toggle devtools "Offline", complete a purchase, confirm the pending-sync banner in `PageHeader` increments, then go back online and confirm it clears (existing `flushQueue()` behavior — no new code, just confirms Phases 1–3 don't break it).

## Performance Considerations

None beyond what's already true of the app — data volumes are small (household-scale), no virtualization or pagination needed for the shopping list, purchases list, or charts.

## Migration Notes

None — `HomeSyncState` shape (`src/lib/api/types.ts`) is unchanged; no localStorage schema migration needed since `ShoppingItem`/`Purchase` fields used by the new UI already exist in the type and in `createSeedState()`.

## References

- Reference implementation for add-to-list + warning badges: `src/routes/cookbook.$recipeId.tsx:57-70,105-121,180-186`
- Reference implementation for edit/delete affordance pattern: `src/routes/index.tsx:82-107`
- Store mutators consumed as-is: `src/lib/store.tsx:113-168`
- Existing icon/color palette to reuse for chart colors: `src/components/IconPicker.tsx:9` (`ACCENTS`), `src/lib/accent.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Shopping List — Core List & Quick Add

#### Automated

- [x] 1.1 Lint passes: `bun run lint` — db41934
- [x] 1.2 Type checking passes: `bunx tsc --noEmit` — db41934
- [x] 1.3 Build succeeds: `bun run build` — db41934

#### Manual

- [x] 1.4 Tapping "Zakupy" renders the shopping list (no 404) — 69c1221
- [x] 1.5 Quick-add bar adds items, stays focused, clears input — 69c1221
- [x] 1.6 Tapping an item toggles done state — 69c1221
- [x] 1.7 Recipe-added ingredients show recipe-source badge on `/shopping` — 69c1221

### Phase 2: Shopping List — Swipe-to-Delete, Warning Actions & Suggestion Banner

#### Automated

- [x] 2.1 Lint passes: `bun run lint` — a789f21
- [x] 2.2 Type checking passes: `bunx tsc --noEmit` — a789f21
- [x] 2.3 Build succeeds: `bun run build` — a789f21

#### Manual

- [x] 2.4 Swipe reveals delete affordance; tap removes item — a789f21
- [x] 2.5 Warning badge shows with trash + zatwierdź actions; zatwierdź hides badge, trash removes item — a789f21
- [x] 2.6 Suggestion banner appears for overdue-to-repurchase product and is dismissible — a789f21

### Phase 3: Receipt Checkout Flow (Mocked OCR)

#### Automated

- [x] 3.1 Lint passes: `bun run lint` — 6737793
- [x] 3.2 Type checking passes: `bunx tsc --noEmit` — 6737793
- [x] 3.3 Build succeeds: `bun run build` — 6737793

#### Manual

- [x] 3.4 "Complete Purchase" disabled at 0 checked items, enabled at ≥1 — 6737793
- [x] 3.5 Photo/skip → processing state → editable form — 6737793
- [x] 3.6 Confirm archives done items, creates purchase, shows toast — 6737793
- [x] 3.7 Cancel leaves shopping list untouched — 6737793

### Phase 4: Analytics / Insights

#### Automated

- [x] 4.1 Lint passes: `bun run lint` — aea076c
- [x] 4.2 Type checking passes: `bunx tsc --noEmit` — aea076c
- [x] 4.3 Build succeeds: `bun run build` — aea076c

#### Manual

- [x] 4.4 Tapping "Budżet" renders insights page (no 404) — aea076c
- [x] 4.5 Donut chart correct per store; toggle to category re-groups correctly — aea076c
- [x] 4.6 Bar chart shows correct monthly totals — aea076c
- [x] 4.7 New purchase from Phase 3 flow reflected on next visit — aea076c

### Phase 5: PWA Icons, Nav Verification & Final QA

#### Automated

- [x] 5.1 Lint passes: `bun run lint`
- [x] 5.2 Type checking passes: `bunx tsc --noEmit`
- [x] 5.3 Build succeeds: `bun run build`

#### Manual

- [x] 5.4 Manifest icons load with no console errors
- [x] 5.5 All four nav tabs work with no 404s
- [x] 5.6 Full end-to-end walkthrough passes
