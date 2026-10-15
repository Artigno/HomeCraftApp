# Import a Recipe Draft from a Pasted Link — Implementation Plan

## Overview

Let a user paste a TikTok or aniagotuje.pl link from the cookbook, have the
app hand it to the backend's async import job, poll until a draft is ready,
and land on the existing recipe-creation form pre-filled with that draft for
review/edit before saving — instead of retyping the recipe by hand.

## ⚠️ Blocked on backend contract

This plan is written against a **not-yet-implemented** backend contract:
HomeCraftApi's `context/changes/recipe-import-from-external-links/plan.md`
(status: `planned`). The endpoints below (`POST /recipes/imports`,
`GET /recipes/imports/{id}`) do not exist yet in the API. Do not start the
"Automated" verification steps of any phase until that backend plan has
shipped and the endpoints respond as documented — see `## Progress` for how
this is tracked.

## Current State Analysis

- The cookbook list (`src/routes/cookbook.index.tsx`) has a single "add
  recipe" entry point: a `+` icon button in the `PageHeader` action slot,
  linking to `/cookbook/new`.
- `src/routes/cookbook.new.tsx` (`NewRecipePage`) is a fully-built manual
  recipe form: local `useState` per field (`title`, `emoji`, `tags`,
  `prepMinutes`, `servings`, `tinId`, `ingredients: IngredientRow[]`,
  `steps: string[]`), a `submit()` that trims/filters empties and calls
  `useHomeSync().addRecipe(...)`, then navigates to `/cookbook`.
- `addRecipe` (`src/lib/store.tsx:461-465`) is the existing save path: it
  optimistically prepends a client-generated-UUID `Recipe` to local state
  and `enqueue("POST", "/recipes", created)`s the durable, offline-safe
  write. The import feature's "save" step must reuse this exact function —
  the backend contract explicitly says drafts still go through the
  existing `POST /recipes`, nothing new to persist the final recipe.
- `src/lib/api/client.ts` has two relevant patterns to mirror:
  - Synchronous direct-fetch calls returning a discriminated result (e.g.
    `apiParseReceipt`, `apiCategorizeShoppingItems`) — note `apiParseReceipt`
    already shows the project's convention for a slow AI-backed POST:
    generous `AbortSignal.timeout`, multipart handling caveat, structured
    error extraction.
  - None of the existing calls poll. This is the first polling consumer in
    the codebase — no existing hook to reuse, write a small one.
- `Recipe` type (`src/lib/api/types.ts`) — needs confirming it matches the
  backend draft shape (`title, ingredients:[{name,amount}], steps, prep_minutes,
  servings`) closely enough to map 1:1 into `NewRecipePage`'s local state
  shape (`IngredientRow[]` is `{name, amount}` already — direct match).

### Key Discoveries:

- `NewRecipePage` has no "pre-fill from elsewhere" capability today — it
  always starts from hardcoded defaults (`emoji: "🍽️"`, `prepMinutes: "30"`,
  `servings: "2"`, one empty ingredient/step row). Prefilling from an
  import draft requires either (a) router state/search-params carrying the
  draft into `/cookbook/new`, or (b) a new route. Plan picks (a) — see
  Phase 2.
- TanStack Router is in use (`createFileRoute`, `useNavigate`, `Link`) —
  confirm whether validated search-params (`validateSearch`) or router
  state (`navigate({ state })`) is the existing idiom elsewhere in the repo
  before Phase 2; if neither exists yet, default to a URL search param
  (`?importId=<id>`) since it survives a page refresh mid-review, which
  router `state` does not.
- No polling/interval hook exists yet (`grep -rn "setInterval\|useInterval"
  src` came up empty against the existing codebase at planning time) —
  Phase 1 introduces a minimal one scoped to this feature rather than a
  shared abstraction, since this is the only consumer.

## Desired End State

- A "Zaimportuj z linku" affordance sits next to the existing `+` button in
  the cookbook list header.
- Tapping it opens a small paste-link entry surface (modal or dedicated
  screen — see Phase 1) accepting a URL, with inline validation feedback
  on the 422 case.
- Submitting POSTs to `/recipes/imports`, immediately shows a pending/
  loading state ("Analizujemy przepis…"), and polls `GET
  /recipes/imports/{id}` every 2–3s.
- On `status: "ready"`, the user is taken to `/cookbook/new` with the form
  fully pre-filled from `draft` — title, ingredients, steps, prep_minutes,
  servings all editable exactly like the manual-entry path, same `submit()`
  / `addRecipe()` save mechanism.
- On `status: "failed"`, the pending surface shows the backend's `error`
  message and offers "spróbuj ponownie" (resubmit the same or a new URL),
  no partial navigation.
- No new persistence path: saving an imported-then-edited recipe is
  indistinguishable, at the API-call level, from today's manual save.

### Key discoveries from backend contract review:

- `POST /recipes/imports` returns 202 immediately with `status: "pending"` —
  there is no synchronous "import finished instantly" case to special-case.
- `GET /recipes/imports/{id}` 404s "if not found/wrong household" — treat a
  404 during polling as a terminal failure state (stop polling, show a
  generic error), not as "keep trying."
- The draft's `ingredients` shape (`{name, amount}`) and `steps` (array of
  strings, assumed from "steps:[...]" in the contract — confirm exact shape
  once the backend plan is implemented; if `steps` turns out to be
  richer than a string array, Phase 2's mapping needs revisiting) are
  consistent with `NewRecipePage`'s local `IngredientRow`/`string[]` state.

## What We're NOT Doing

- Not building a generic "paste any link" importer for non-recipe content.
- Not editing the draft inline on the pending/polling screen — review/edit
  happens entirely on the existing `/cookbook/new` form, per the backend
  plan's suggested flow.
- Not persisting import history (past pending/failed imports) anywhere in
  the UI beyond the current in-flight one — no "my imports" list.
- Not handling multiple concurrent imports from the same device; the paste-
  link surface is single-slot (starting a new import away from a pending
  one simply replaces it).
- Not implementing offline support for imports — unlike `addRecipe`'s
  `enqueue()` path, `POST /recipes/imports` requires a live round trip
  (can't meaningfully queue "start this import" offline); if offline, show
  the same network-error state the rest of the app uses.
- Not touching `/cookbook/new`'s manual-entry defaults or validation for
  the non-imported case.

## Implementation Approach

Two phases: (1) the import-trigger + polling surface as a self-contained
piece of UI/state, independent of the form; (2) wiring the resolved draft
into `/cookbook/new`'s pre-fill path. Keeping them separate means Phase 1's
polling logic can be built and manually exercised (even against a stub)
before Phase 2's form-prefill risk (route params / state shape) is tackled.

## Critical Implementation Details

- **Polling must stop** on unmount, on `status !== "pending"`, and after a
  sane max-attempts/timeout ceiling (e.g. ~2 minutes) so a stuck backend job
  doesn't poll forever in a backgrounded tab — surface a "still working,
  check back later" terminal state if that ceiling is hit, not an infinite
  spinner.
- **URL validation client-side is advisory only** — the backend is the
  source of truth for "is this a supported link" (422 on bad url). Client
  only checks for "looks like a URL" to catch empty/garbage input before
  spending a round trip; do not hardcode a TikTok/aniagotuje.pl domain
  allowlist that could drift from what the backend actually accepts.
- **The draft must not silently clobber in-progress manual edits** — if a
  user navigates to `/cookbook/new` with an import draft while unsaved
  manual field edits could theoretically exist (e.g. back-button into a
  half-filled form), the import draft should only apply on initial mount
  from the search param, never re-apply on a later render.

---

## Phase 1: Paste-link entry point + import polling

### Overview

Adds the "Zaimportuj z linku" entry point to the cookbook list, a paste-
link surface, and the POST + poll loop. Resolves to a pending draft id
that Phase 2 consumes; this phase can be manually verified end-to-end
(including the failure path) once the backend endpoints exist, without
touching `/cookbook/new` at all.

### Changes Required:

#### 1. API client functions

**File**: `src/lib/api/client.ts`

**Intent**: Mirror the existing synchronous-fetch convention (see
`apiParseReceipt`, `apiCategorizeShoppingItems`) for two new calls:
`apiStartRecipeImport(url: string)` → `POST /recipes/imports`, returning a
discriminated `{ok:true, data:{id,status,draft,error,updated_at}} |
{ok:false, status, message?}` (422 message surfaced the same way
`apiParseReceipt` extracts `body.message`); `apiGetRecipeImport(id: string)`
→ `GET /recipes/imports/{id}` with the same shape, treating 404 as
`{ok:false, status:404}`. Use a short timeout for the POST (it's a fire-and-
return-202 call, not the slow part) and a short timeout for each poll GET.

#### 2. Types

**File**: `src/lib/api/types.ts`

**Intent**: Add `RecipeImportDraft` (`{title, ingredients:[{name,amount}],
steps:string[], prep_minutes:number, servings:number}`) and
`RecipeImportStatus` (`{id:string, status:"pending"|"ready"|"failed",
draft: RecipeImportDraft|null, error:string|null, updated_at:string}`).

#### 3. Paste-link entry point

**File**: `src/routes/cookbook.index.tsx`

**Intent**: Add a second action button ("Zaimportuj z linku", e.g. a link/
clipboard icon) next to the existing `+` button in the `PageHeader` action
slot, opening a modal (reuse `src/components/ui/dialog.tsx`, same pattern as
`PurchaseDetailModal`) rather than a new route — this is a lightweight,
single-field entry, not a full page.

#### 4. Import modal + polling

**File**: `src/components/RecipeImportModal.tsx` (new)

**Intent**: Controlled modal with a URL `Input`, a submit button, and three
visual states: idle/entry, pending (spinner + "Analizujemy przepis…",
polling active), failed (error text from backend + "Spróbuj ponownie"
resetting to idle). On `status: "ready"`, the modal's only job is to hand
off `{id}` (or the full draft) to navigation — it does not itself render
the draft. Polling: a `setInterval` (2.5s) started on successful POST,
cleared on unmount / terminal status / max-attempts ceiling (~48 attempts
≈ 2 minutes), calling `apiGetRecipeImport`. On success navigate via
`useNavigate` to `/cookbook/new` with the import id in a search param
(`navigate({ to: "/cookbook/new", search: { importId: data.id } })`) —
Phase 2 reads this back and re-fetches by id (simplest source of truth;
avoids serializing the whole draft into the URL).

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `bunx tsc -p tsconfig.json`
- Lint passes: `bun run lint`
- Build succeeds: `bun run build`

#### Manual Verification:

- Requires the backend import endpoints to be live. Paste a valid link —
  modal shows pending state, polls, and on backend completion transitions
  to `/cookbook/new`.
- Paste an obviously-invalid URL — backend 422 surfaces as an inline error,
  no navigation.
- Simulate a backend `status: "failed"` response — error message shown,
  "Spróbuj ponownie" resets to the entry state.
- Close the modal mid-poll, reopen — no duplicate interval left running
  (check via a long-lived background tab or a `console.count` probe during
  dev).

---

## Phase 2: Pre-fill `/cookbook/new` from an import draft

### Overview

`/cookbook/new` gains an optional `importId` search param; on mount, if
present, it re-fetches the import status by id, maps the draft's fields
into the existing local form state, and otherwise behaves identically to
today's manual-entry flow (same `submit()`, same `addRecipe()` call).

### Changes Required:

#### 1. Search param + prefill

**File**: `src/routes/cookbook.new.tsx`

**Intent**: Add `validateSearch` (or the repo's established TanStack Router
idiom — confirm there isn't already a precedent elsewhere before picking
one) for `importId?: string`. On mount, if `importId` is present, call
`apiGetRecipeImport(importId)` once; if `status === "ready"` and `draft` is
non-null, set all the existing `useState` fields from `draft` (title,
ingredients → `IngredientRow[]`, steps → `string[]`, prep_minutes →
string, servings → string) in place of the hardcoded defaults. Guard with
a ref so this only applies once (see Critical Implementation Details). If
the re-fetch 404s or the import somehow isn't `ready` (user navigated here
directly with a stale/garbage id), fall back silently to the normal empty
form — don't block the page on a broken deep link.

#### 2. Visual affordance that this is an imported draft

**File**: `src/routes/cookbook.new.tsx`

**Intent**: Small, non-blocking banner/badge ("Zaimportowano z linku —
sprawdź i zapisz") when the form was pre-filled from an import, so the user
knows to review before saving. Purely cosmetic, no behavior change to
`submit()`.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `bunx tsc -p tsconfig.json`
- Lint passes: `bun run lint`
- Build succeeds: `bun run build`

#### Manual Verification:

- Navigating to `/cookbook/new` with no `importId` behaves exactly as
  before (regression check).
- Navigating with a valid `importId` from a ready import pre-fills every
  field; editing and saving produces a normal recipe via the existing
  `addRecipe` path (confirm it appears in `/cookbook` and syncs like any
  other manually-added recipe, including offline-queue behavior if backend
  is briefly unreachable at save time).
- Navigating with a garbage/expired `importId` falls back to the empty
  form without an error flash or stuck spinner.

## Testing Strategy

- No existing automated test suite was found for routes/components in this
  repo at planning time (no `*.test.ts(x)` alongside `src/routes` or
  `src/components`) — confirm this is still accurate before implementation;
  if a test runner is wired up by then, add it, otherwise match the
  existing project convention of manual verification checklists.
- Manual verification both phases requires the backend import endpoints
  live; until then, Phase 1 can be partially exercised against a hand-
  rolled local mock server or MSW-style fetch stub if one is introduced,
  but that is not a substitute for the real contract check once backend
  ships.

## Performance Considerations

- Poll interval (2.5s) matches the backend's "poll every 2-3s" suggestion;
  no need for exponential backoff for an MVP-scoped single-import-at-a-time
  flow.
- No additional bundle-size concerns — reuses existing `Dialog`/`Input`/
  `Button` primitives.

## Migration Notes

None — purely additive; no existing data shapes change.

## References

- Backend contract (not yet implemented): HomeCraftApi
  `context/changes/recipe-import-from-external-links/plan.md`
- Existing save path: `src/lib/store.tsx:461-465` (`addRecipe`)
- Existing form to prefill: `src/routes/cookbook.new.tsx`
- Existing async-AI-call convention: `src/lib/api/client.ts`
  (`apiParseReceipt`)

## Open Questions

- **Draft `steps` exact shape** — the backend contract shows
  `steps:[...]` without specifying element shape; assumed `string[]` to
  match `NewRecipePage`'s existing local state. Confirm against the
  backend's actual implementation before Phase 2 lands.
- **Entry point placement** — planned as a second header button next to
  `+` on `/cookbook`. An alternative (e.g. inside the `+` menu as a choice
  between "manual" and "from link") wasn't ruled out; either is compatible
  with this plan's Phase 2, only Phase 1's UI changes if revisited.
- **No existing router search-param/state precedent found in this repo** —
  Phase 2 picks a URL search param (`?importId=`) for refresh-safety; if a
  different idiom is already standard elsewhere by implementation time,
  prefer consistency with that instead.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

**Blocked on backend implementation.** Do not begin Phase 1/2 "Automated"
or "Manual" verification until HomeCraftApi's
`context/changes/recipe-import-from-external-links/plan.md` ships
`POST /recipes/imports` and `GET /recipes/imports/{id}` as specced above.

### Phase 1: Paste-link entry point + import polling

#### Automated

- [x] 1.1 Typecheck passes: `bunx tsc -p tsconfig.json` — eea702c
- [x] 1.2 Lint passes: `bun run lint` — eea702c
- [x] 1.3 Build succeeds: `bun run build` — eea702c

#### Manual

- [ ] 1.4 Valid link → pending → ready transitions to handoff (requires live backend)
- [ ] 1.5 Invalid link shows inline 422 error, no navigation
- [ ] 1.6 Failed import shows backend error + resubmit works
- [ ] 1.7 Closing modal mid-poll leaves no dangling interval

### Phase 2: Pre-fill `/cookbook/new` from an import draft

#### Automated

- [x] 2.1 Typecheck passes: `bunx tsc -p tsconfig.json` — eea702c
- [x] 2.2 Lint passes: `bun run lint` — eea702c
- [x] 2.3 Build succeeds: `bun run build` — eea702c

#### Manual

- [ ] 2.4 No `importId` → unchanged manual-entry behavior
- [ ] 2.5 Valid `importId` → all fields pre-filled, save works via existing `addRecipe`
- [ ] 2.6 Garbage/expired `importId` → silent fallback to empty form
