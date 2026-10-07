<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Tab Reorder & Profile Nav Access

- **Plan**: context/changes/tab-reorder-and-profile-nav-access/plan.md
- **Scope**: Phase 1 and Phase 2 (full plan)
- **Date**: 2026-10-07
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 0 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — Icon-only /account tab lost its accessible name

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/routes/__root.tsx:152-161
- **Detail**: The removed header link (old `src/routes/index.tsx:70-76`) had `aria-label="Konto"` on its icon-only `<Link to="/account">`. The new icon-only bottom tab added in Phase 2 has `label: null`, so `{label}` renders nothing and no `aria-label` was added to compensate — screen-reader users get an unlabeled link in the tab bar where before they had one.
- **Fix**: Add `aria-label={label ?? "Konto"}` (or a per-tab `ariaLabel` field in `TABS`) to the `<Link>` so the icon-only Profil tab keeps an accessible name equivalent to what the removed header link provided.
- **Decision**: FIXED — added `aria-label={label ?? "Konto"}` to the Link in src/routes/__root.tsx

## Notes

- Plan Adherence: both phases MATCH plan intent exactly (verified against commits `8008996`, `5eeade8`). Icon-sizing/centering tweak (`size-7` + `justify-center` for the label-less entry) is a user-requested, plan-adjacent refinement from manual-verification feedback, not undocumented scope creep.
- Scope Discipline: no changes outside the two phases' described files. Import cleanup (`Link`, `UserCircle` dropped from `index.tsx`) is a mechanical consequence of removing their only usage.
- Safety & Quality: no security/performance/reliability/data-safety issues found. The one warning above is an accessibility regression.
- Pattern Consistency: `cn(base, condition && "class")` / ternary keyed off a data field (`label === null`) matches existing codebase convention (seen in `IconPicker.tsx`, `TaskWizard.tsx`, `shopping.tsx`, `insights.tsx`, `cookbook.$recipeId.tsx`, shadcn primitives). Not ad-hoc.
- Success Criteria: typecheck (`tsc --noEmit`) and lint (`eslint .`) both pass with 0 errors (11 pre-existing warnings, unrelated to this change). All Progress rows `[x]` with correct commit SHAs matching actual history.
