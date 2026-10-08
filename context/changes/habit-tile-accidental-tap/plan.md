# Confirm-before-log on habit tiles Implementation Plan

## Overview

Gate `TaskTile`'s tap-to-log action behind a confirmation dialog so an
accidental tap no longer silently logs a habit as done. Tap still opens
something immediately (no added navigation step) — it just opens a confirm
dialog instead of committing state directly.

## Current State Analysis

`TaskTile` (`src/routes/index.tsx:174-231`) wires a single `onClick` that,
unless swallowed by `consumeLongPress()` or blocked by `editMode`, calls
`logTask(task.id)` and fires a success toast immediately — no gate at all
(`src/routes/index.tsx:197-201`). `logTask` (`src/lib/store.tsx:296-305`)
mutates `tasks[].last_done_at`, appends a log entry, and enqueues a
`POST /maintenance-logs` — all effectively irreversible without a second
write. The long-press gesture is already reserved for opening the
edit-actions sheet (`useLongPress`, `src/hooks/use-long-press.ts`), so tap
is the only gesture available for "log."

Sibling action `removeTask` on this same screen is already gated — it only
fires from inside the long-press actions sheet, never from a bare tap
(`src/routes/index.tsx:157-166`). Tap-to-log is the one state-mutating
action on this screen with zero gate.

`AlertDialog` (`src/components/ui/alert-dialog.tsx`) is a shadcn/Radix
component already present in the UI kit but not used anywhere in the
codebase yet — it is the conventional building block for exactly this kind
of "confirm a committing action" dialog.

## Desired End State

Tapping a habit tile (not long-pressing, not in edit mode) opens a confirm
dialog naming the task; confirming logs it (unchanged `logTask` + toast
behavior); cancelling or dismissing leaves state untouched. The footer hint
text reflects the new tap semantics.

### Key Discoveries:

- `src/routes/index.tsx:197-201` — the exact unguarded tap→log path.
- `src/routes/index.tsx:157-166` — sibling `removeTask` already follows a
  gate-before-commit convention (long-press sheet), which this change
  brings tap-to-log into line with.
- `src/components/ui/alert-dialog.tsx` — unused shadcn `AlertDialog`,
  correct primitive for this (vs. the ad-hoc bottom-sheet pattern used for
  `actionsTask`, which is for a menu of actions, not a single confirm).
- `src/routes/index.tsx:106-109` — footer hint text that currently states
  "Tapnij kafelek, aby zalogować wykonanie" and will become inaccurate once
  tap opens a dialog instead of logging directly.

## What We're NOT Doing

- Not touching long-press-to-edit or edit-mode-remove gestures — unchanged.
- Not adding an undo mechanism — confirm-before-commit was the chosen
  mitigation, not undo-after-commit.
- Not touching any other tap-to-commit gesture elsewhere in the app
  (e.g. shopping list toggle) — scope is `TaskTile` only, per framing.
- Not changing `logTask`'s store-level behavior (`src/lib/store.tsx`) —
  only how/when it's called from the UI.

## Implementation Approach

Introduce per-tile confirm state in `Dashboard` (mirroring the existing
`actionsTask` pattern), render one `AlertDialog` driven by that state, and
change `TaskTile`'s plain-tap branch to request confirmation instead of
calling `logTask` directly. Update the footer hint copy in the same phase
since it's one line tied to the same behavior change.

## Phase 1: Confirm-before-log on TaskTile

### Overview

Add the confirm dialog and rewire the tap path; update hint text.

### Changes Required:

#### 1. Confirm dialog state + render

**File**: `src/routes/index.tsx`

**Intent**: Add a `confirmTask` state (the task pending confirmation, or
`null`) in `Dashboard`, alongside the existing `actionsTask` state. Render
one `AlertDialog` (imported from `@/components/ui/alert-dialog`) bound to
`confirmTask`, titled with the task name, with Cancel (closes, no-op) and
Confirm (calls `logTask(confirmTask.id)` + the existing
`toast.success("Zapisano wykonanie", { description: confirmTask.name })`,
then closes) actions.

**Contract**: New `confirmTask: MaintenanceTask | null` state in
`Dashboard`; one `<AlertDialog>` block following the existing
`AlertDialogTrigger`-less controlled-open pattern (`open={!!confirmTask}
onOpenChange={(o) => !o && setConfirmTask(null)}`), placed alongside the
existing `actionsTask` dialog block.

#### 2. Rewire TaskTile's tap branch

**File**: `src/routes/index.tsx`

**Intent**: `TaskTile` no longer calls `logTask` or fires the toast itself.
It gains an `onRequestConfirm: () => void` prop (passed from `Dashboard` as
`() => setConfirmTask(task)`), and its `onClick`'s plain-tap branch calls
that instead.

**Contract**: `TaskTile`'s props gain `onRequestConfirm: () => void`;
`useHomeSync()`'s `logTask` destructure and the `toast` import/call move out
of `TaskTile` into `Dashboard` (where the confirm dialog's Confirm handler
now owns them). `onClick`'s body becomes: `if (consumeLongPress()) return; if
(editMode) return; onRequestConfirm();` — same two guard branches, same
long-press/edit-mode semantics, only the terminal action changes.

#### 3. Update footer hint text

**File**: `src/routes/index.tsx`

**Intent**: The hint paragraph (currently "Tapnij kafelek, aby zalogować
wykonanie · przytrzymaj, aby edytować") must describe the new two-step
flow, not direct logging.

**Contract**: Replace the hint string at `src/routes/index.tsx:107` with
copy naming confirmation, e.g. "Tapnij, aby potwierdzić wykonanie ·
przytrzymaj, aby edytować" — wording is an implementer judgment call within
that meaning; keep the existing `·`-separated two-clause structure and the
long-press clause unchanged.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx tsc --noEmit`
- Linting passes: `npm run lint`

#### Manual Verification:

- Tapping a habit tile (not long-press, not in edit mode) opens a confirm
  dialog naming the task — no log is written yet.
- Confirming in the dialog logs the task (visible via updated `last_done_at`
  / status ring) and shows the existing success toast.
- Cancelling (or tapping outside/dismissing) the dialog leaves the task's
  `last_done_at` unchanged — no log written.
- Long-press still opens the edit-actions sheet, unaffected by this change.
- In edit mode, tapping a tile still does nothing (no dialog, no log) —
  only the trash-icon remove action works, unaffected by this change.
- Footer hint text reads correctly and matches actual tap behavior.

**Implementation Note**: After completing this phase and all automated
verification passes, pause here for manual confirmation from the human
that the manual testing was successful before proceeding.

---

## Testing Strategy

### Manual Testing Steps:

1. Tap a habit tile in normal browsing mode → confirm dialog appears, task
   not yet logged.
2. Tap Confirm → task logs, toast appears, dialog closes.
3. Repeat, tap Cancel (or tap outside dialog) → dialog closes, task state
   unchanged.
4. Long-press a tile → edit-actions sheet opens as before (unaffected).
5. Enter edit mode (Edytuj button) → tap a tile → nothing happens (no
   dialog, no log) — only remove-icon works, matching prior behavior.

## References

- Frame brief: `context/changes/habit-tile-accidental-tap/frame.md`
- Sibling gated-action pattern: `src/routes/index.tsx:157-166`
  (`removeTask` via long-press actions sheet)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Confirm-before-log on TaskTile

#### Automated

- [x] 1.1 Type checking passes: `npx tsc --noEmit`
- [x] 1.2 Linting passes: `npm run lint`

#### Manual

- [x] 1.3 Tap (not long-press, not edit mode) opens confirm dialog, no log written yet
- [x] 1.4 Confirm logs the task and shows success toast
- [x] 1.5 Cancel/dismiss leaves task state unchanged
- [x] 1.6 Long-press still opens edit-actions sheet, unaffected
- [x] 1.7 Edit mode tap still no-ops (only remove-icon works), unaffected
- [x] 1.8 Footer hint text matches new tap behavior
