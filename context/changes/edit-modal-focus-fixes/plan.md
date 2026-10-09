# Edit-Modal Focus Fixes Implementation Plan

## Overview

Sprint 1 items #9 and #10 share one root cause: `TaskWizard.tsx`'s edit-mode
Inputs carry `autoFocus`, and the shared `DrawerContent` (vaul → Radix Dialog)
auto-focuses the first focusable element on open by default. The two
mechanisms stack, forcing focus (and the on-screen keyboard) onto the name or
date field the instant the modal mounts — which on some mobile webviews also
triggers a pre-selected-word artifact on the name field (#9). Fix removes
both triggers for the two edit flows.

## Current State Analysis

- `src/components/TaskWizard.tsx` is the single component behind both
  "Edytuj" and "Edytuj datę wykonania" (editMode="details" | "date"),
  opened from the long-press action sheet in `src/routes/index.tsx:148-167`.
- Three `<Input autoFocus>` occurrences in TaskWizard.tsx: L193 (date edit —
  ticket #10), L207 (new-task step-1 prompt — out of scope), L236 (edit-name
  — ticket #9/#10).
- `src/components/ui/drawer.tsx`'s `DrawerContent` forwards all props to
  `DrawerPrimitive.Content` (vaul, built on `@radix-ui/react-dialog`) with no
  `onOpenAutoFocus` override — so Radix's default (auto-focus first
  focusable descendant on mount) applies on every usage, including
  shopping.tsx's own drawers (out of scope — not reported, untouched here).
- No `.select()` calls anywhere in the codebase — the "first word selected"
  symptom is a side effect of forced focus-on-mount on a populated input, not
  an explicit selection call.
- No prior research/plan exists for this change; nothing to build on besides
  the roadmap's own framing of #9+#10 as one root-cause pair.

## Desired End State

Opening either "Edytuj" or "Edytuj datę wykonania" via long-press does not
focus any input and does not trigger the on-screen keyboard. No text is
pre-selected. Tapping an input manually still focuses it and types normally.
The new-task flow (step 1 prompt) is unaffected — it still autofocuses as
before.

### Key Discoveries:

- `src/components/TaskWizard.tsx:193` — date Input, `autoFocus` to remove.
- `src/components/TaskWizard.tsx:236` — edit-name Input, `autoFocus` to
  remove.
- `src/components/TaskWizard.tsx:166` — TaskWizard's own `<DrawerContent>`
  usage, where a local `onOpenAutoFocus` override goes (does not touch
  `drawer.tsx` itself, so shopping.tsx's drawers are unaffected).
- `src/components/TaskWizard.tsx:207` — new-task step-1 Input, left
  untouched (out of ticket scope, no reported issue).

## What We're NOT Doing

- Not touching the new-task step-1 prompt Input (L207) or its autofocus.
- Not modifying the shared `src/components/ui/drawer.tsx` — fix is scoped
  to TaskWizard's own `<DrawerContent>` usage only.
- Not touching `shopping.tsx`'s three `autoFocus` Inputs — different
  surface, not in this ticket.
- Not adding a focus trap or custom a11y focus-management hook — Radix's
  own container-focus fallback (triggered by `preventDefault()` with no
  manual focus call) already covers screen-reader announcement.
- Not adding a component test — manual verification only (confirmed).

## Implementation Approach

Single-file change in `TaskWizard.tsx`: drop the two `autoFocus` props and
add one `onOpenAutoFocus` override on the local `<DrawerContent>` to cancel
Radix's own auto-focus-first-focusable default. Both edit flows share this
one `<DrawerContent>` instance, so one override fixes both tickets.

## Phase 1: Remove forced focus from edit modals

### Overview

Stop both the explicit `autoFocus` props and Radix's implicit
auto-focus-on-open from landing focus on the name/date Inputs when TaskWizard
opens in edit mode.

### Changes Required:

#### 1. TaskWizard.tsx — drawer open-focus override

**File**: `src/components/TaskWizard.tsx`

**Intent**: Prevent Radix Dialog's default "focus first focusable element
on open" behavior for this drawer, so no input (and therefore no keyboard)
receives focus purely from the modal opening.

**Contract**: Pass `onOpenAutoFocus={(e) => e.preventDefault()}` to the
`<DrawerContent>` at line 166. `preventDefault()` with no manual `.focus()`
call lets Radix fall back to focusing the dialog container itself —
sufficient for screen-reader dialog-open announcement, no keyboard trigger.

#### 2. TaskWizard.tsx — remove autoFocus from edit-mode Inputs

**File**: `src/components/TaskWizard.tsx`

**Intent**: Remove the redundant explicit focus trigger on the two
edit-mode fields so neither forces focus independent of the drawer-level
fix above.

**Contract**: Remove `autoFocus` from the date Input (currently line 193)
and the edit-name Input (currently line 236). Leave the new-task step-1
Input (currently line 207) unchanged.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npm run typecheck` (or repo's configured equivalent)
- Lint passes: `npm run lint`

#### Manual Verification:

- Long-press a "Dom" tile → "Edytuj" opens with no keyboard shown and no
  text selected in the name field.
- Long-press a "Dom" tile → "Edytuj datę wykonania" opens with no keyboard
  shown.
- Tapping into the name field or date field manually still focuses it and
  accepts input normally.
- New-task flow (tile "+" / add task) still autofocuses its step-1 prompt
  Input as before — unaffected by this change.

**Implementation Note**: After completing this phase and automated
verification passes, pause here for manual confirmation from the human that
the manual testing was successful.

---

## Testing Strategy

### Unit Tests:

- None added — manual verification only (confirmed).

### Integration Tests:

- None added.

### Manual Testing Steps:

1. On a mobile viewport (or device), long-press a "Dom" tile, tap "Edytuj".
   Confirm no keyboard pop-up, no pre-selected text in the name field.
2. From the same action sheet, tap "Edytuj datę wykonania". Confirm no
   keyboard pop-up.
3. In either modal, tap the input manually — confirm focus + typing work
   normally.
4. Open the new-task flow (not via long-press edit) — confirm step-1 prompt
   still autofocuses as before (regression check).

## Performance Considerations

None — this is a focus-behavior change with no performance impact.

## Migration Notes

None — no data model or API changes.

## References

- Ticket: `context/changes/edit-modal-focus-fixes/change.md`
- Roadmap: `context/foundation/roadmap.md:39-56` (sequencing + shared
  root-cause framing)
- Shared drawer primitive (not modified): `src/components/ui/drawer.tsx`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a
> step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Remove forced focus from edit modals

> **Adaptation (post-deploy, 2026-10-09)**: Prod testing on iOS Safari showed
> #9 ("zaznaczony tekst") wasn't fixed by the autoFocus/onOpenAutoFocus
> change — screenshot showed iOS's native long-press-to-select-text firing
> on `TaskTile`'s `<p>{task.name}</p>` (behind the action sheet, before
> TaskWizard even opens), colliding with `use-long-press.ts`'s own 500ms
> timer. Root cause was misdiagnosed in this plan's Current State Analysis.
> Fix: added `select-none [-webkit-touch-callout:none]` to the `TaskTile`
> button in `src/routes/index.tsx` to suppress native text
> selection/callout on the pressable tile. #10 (keyboard) was confirmed
> fixed by the original autoFocus removal.

#### Automated

- [x] 1.1 Typecheck passes: `npm run typecheck` — 3211e43
- [x] 1.2 Lint passes: `npm run lint` — 3211e43
- [x] 1.7 Typecheck + lint pass after TaskTile select-none fix — 07b118a

#### Manual

- [x] 1.3 "Edytuj" opens with no keyboard shown and no text selected
- [x] 1.4 "Edytuj datę wykonania" opens with no keyboard shown
- [x] 1.5 Manual tap-to-focus + typing still works in both inputs
- [x] 1.6 New-task step-1 prompt still autofocuses (regression check)
- [x] 1.8 Long-press a tile — no native text-selection/callout appears on
      the tile itself (iOS Safari)
