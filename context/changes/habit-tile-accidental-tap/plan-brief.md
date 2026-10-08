# Confirm-before-log on habit tiles — Plan Brief

> Full plan: `context/changes/habit-tile-accidental-tap/plan.md`
> Frame brief: `context/changes/habit-tile-accidental-tap/frame.md`

## What & Why

`TaskTile`'s tap handler has no gate — no confirm, no undo, no debounce —
between a bare tap and a committed `logTask` write, and it's the only
state-mutating action on the dashboard without one (sprint-1 #3). Users
accidentally tap a tile and log a habit they didn't mean to.

## Starting Point

Tap (not long-press, not edit mode) calls `logTask` + toast directly
(`src/routes/index.tsx:197-201`). Long-press already opens an edit-actions
sheet; `removeTask` already only fires from inside that sheet — tap-to-log
is the one unguarded action on the screen.

## Desired End State

Tap opens a confirm dialog naming the task; Confirm logs it (same
`logTask` + toast as today), Cancel/dismiss leaves it untouched. Long-press
and edit-mode behavior are unchanged. Footer hint text matches the new flow.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Mitigation approach | Confirm dialog (not undo-toast, not long-press-to-log) | User's explicit pick over the two alternatives offered. | Plan |
| Dialog primitive | shadcn `AlertDialog` | Already in the UI kit, unused elsewhere, exact fit for confirm-before-commit — vs. the ad-hoc bottom-sheet used for the multi-action `actionsTask` menu. | Plan |
| Footer hint text | Update it | Current text ("tap to log") would be inaccurate once tap opens a dialog instead of logging directly. | Plan |
| Scope | `TaskTile` only | No other tap-to-commit gesture in the app is in play. | Frame |

## Scope

**In scope:**
- `TaskTile`'s tap branch (confirm dialog instead of direct log)
- New confirm-dialog state + render in `Dashboard`
- Footer hint text copy

**Out of scope:**
- Long-press-to-edit gesture, edit-mode remove action (unaffected)
- Undo mechanism (not the chosen mitigation)
- Other tap-to-commit gestures elsewhere in the app (e.g. shopping toggle)
- `logTask`'s store-level behavior (`src/lib/store.tsx`)

## Architecture / Approach

Single component change: `Dashboard` gains a `confirmTask` state (mirrors
existing `actionsTask` pattern) and one `AlertDialog`; `TaskTile` gains an
`onRequestConfirm` prop and stops calling `logTask`/`toast` itself — those
move into the dialog's Confirm handler in `Dashboard`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Confirm-before-log on TaskTile | Dialog gate + hint text update | Low — single file, no data/API change |

**Prerequisites:** None — self-contained UI change.
**Estimated effort:** ~1 session, 1 phase.

## Open Risks & Assumptions

- Assumes the confirm dialog firing on every tap doesn't feel like net-new
  friction to users who log frequently — not re-litigated here since the
  user explicitly chose this over undo-toast (which preserves one-tap
  speed) after seeing the tradeoff.

## Success Criteria (Summary)

- Accidental tap no longer logs a habit — user sees a dialog, not a
  committed state change.
- Intentional log still takes two taps (tile + confirm), toast unchanged.
- Long-press and edit-mode flows are bit-for-bit unaffected.
