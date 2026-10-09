# Edit-Modal Focus Fixes — Plan Brief

> Full plan: `context/changes/edit-modal-focus-fixes/plan.md`

## What & Why

Sprint 1 items #9 and #10: long-pressing a "Dom" tile to edit it (name or
last-done date) forces an input into focus the instant the modal opens —
popping the on-screen keyboard immediately and, on the name field, leaving
the first word pre-selected. Both are disruptive and share one root cause.

## Starting Point

`TaskWizard.tsx` is the single shared modal behind both "Edytuj" and "Edytuj
datę wykonania", opened from the long-press action sheet in
`src/routes/index.tsx`. It has `autoFocus` on its date and name Inputs, and
the shared `DrawerContent` (vaul → Radix Dialog) *also* auto-focuses the
first focusable element on open by default — nothing currently overrides
that. The two triggers stack.

## Desired End State

Opening either edit modal via long-press shows no keyboard and no
pre-selected text. Tapping an input manually still focuses and types
normally. The unrelated new-task flow keeps its existing autofocus
behavior, untouched.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| New-task step-1 Input (autofocus) | Leave untouched | Not an edit modal, not reported, no regression risk wanted there. |
| Fix scope | TaskWizard-local `onOpenAutoFocus` override | Zero blast radius — shared `drawer.tsx` (and shopping.tsx's own autofocus inputs) stay untouched. |
| Post-fix focus target | Radix's container fallback (no manual `.focus()`) | Still a11y-correct for screen readers, without triggering the keyboard. |
| Testing | Manual verification only | Matches ticket's isolated-UI-bug scope; no existing TaskWizard test harness to extend for a 3-line fix. |

## Scope

**In scope:** `TaskWizard.tsx` — remove `autoFocus` from date + edit-name
Inputs, add `onOpenAutoFocus={(e) => e.preventDefault()}` to its own
`DrawerContent`.

**Out of scope:** new-task step-1 Input, shared `drawer.tsx` defaults,
`shopping.tsx`'s own autofocus inputs, automated tests.

## Architecture / Approach

One component, one phase. Both edit flows ("Edytuj", "Edytuj datę
wykonania") share the same `TaskWizard` + `DrawerContent` instance, so one
`onOpenAutoFocus` override plus two `autoFocus` removals fixes both tickets
at once.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Remove forced focus | No keyboard/selection on modal open, manual focus still works | Regression on new-task autofocus if scope creeps — explicitly guarded against |

**Prerequisites:** none — isolated frontend fix.
**Estimated effort:** well under 1 session; single file, ~3 line changes.

## Open Risks & Assumptions

- Assumes mobile webview's "first word selected" symptom (#9) is a
  side-effect of forced focus-on-mount, not a separate explicit `.select()`
  bug — confirmed by codebase search (no `.select()` calls exist anywhere).

## Success Criteria (Summary)

- Long-press → "Edytuj" / "Edytuj datę wykonania" open with no keyboard
  pop-up and no pre-selected text.
- Manual tap-to-focus still works in both inputs.
- New-task flow's own autofocus is unaffected.
