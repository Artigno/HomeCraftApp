# Frame Brief: Accidental-tap logging on habit tiles

> Framing step before /10x-plan. Captures what is *actually* at issue,
> separated from what was initially assumed.

## Reported Observation

Sprint 1, item #3: users complain they can accidentally tap a habit tile
and log an action they didn't intend to perform.

## Initial Framing (preserved)

- **User's stated cause or approach**: `TaskTile`'s `onClick` (`src/routes/index.tsx:197-201`)
  calls `logTask(task.id)` immediately on any tap that isn't a long-press
  or in edit mode — no confirm step, no undo window, no debounce.
- **User's proposed direction**: "poprawić jakoś" — roadmap names three
  candidate mitigations (confirm / undo / long-press-to-log) but leaves the
  choice open, pending product input.
- **Pre-dispatch narrowing**: scenario — not separated, could be fat-finger/
  scroll-tap or double-tap, user isn't sure which (or both). Scope — confirmed
  to **TaskTile only** (`src/routes/index.tsx`), not other tap-to-commit
  gestures elsewhere in the app (e.g. shopping toggle).

## Dimension Map

1. **Hit-area / gesture ambiguity** — the entire card (`min-h-36` button) is
   one tap target; there's no sub-region distinguishing "log" from "just
   touching the tile."
2. **Zero-latency commit** — a single tap writes state (`logTask`) and fires
   a toast with no confirm/undo/debounce gate. ← user's framing
3. **No reversal path after the fact** — `toast.success(...)` carries no
   undo action; no other UI surface lets the user revert a log once fired.
4. **Protection scoped to edit mode only** — `editMode` already blocks tap-to-log
   during editing, but offers zero protection in the default browsing state,
   which is where all the accidental taps are reported.

## Hypothesis Investigation

| Hypothesis | Evidence | Verdict |
| --- | --- | --- |
| 1. Hit-area ambiguity | Whole card is the single `<button>` hit target (`index.tsx:194-202`); no sub-zone split. | WEAK — contributes to *how often* a stray touch lands, but isn't itself the reason a stray touch commits state. |
| 2. Zero-latency commit (user's framing) | `onClick` → `logTask` → `toast.success` in one synchronous block, no gating condition besides `consumeLongPress()`/`editMode` (`index.tsx:197-201`). | STRONG — this is the mechanism that turns any successful tap into a committed, visible state change. |
| 3. No reversal path | Searched `Dashboard` for any undo affordance after `logTask` fires — `toast.success` call has no `action` param; no other button/state exposes "undo last log." | STRONG — once dimension 2 fires, there is no second chance. |
| 4. Edit-mode-only gating | `if (editMode) return;` is the only existing gate (`index.tsx:199`); default browsing state has none. | STRONG — confirms the "normal use" path is fully unguarded, matching where users report the problem. |

## Narrowing Signals

- User scoped this to `TaskTile` only — no other tap-to-commit gesture in
  the app is in play, so the fix surface is a single component.
- User could not separate fat-finger vs. double-tap scenarios — the fix
  needs to cover tap-in-general, not one specific gesture pattern.
- No code path anywhere in `Dashboard`/`TaskTile` offers a reversal once
  `logTask` fires — ruling out "there's already an undo, it's just not
  discoverable" as an alternate explanation.

## Cross-System Convention

Other destructive-ish actions in this same component already use a
confirm-style gate: `removeTask` only fires from inside the long-press
actions sheet (`actionsTask` dialog), never from a bare tap. Habit-tile
tap-to-log is the one action in this screen that still commits on a bare
tap with no gate — inconsistent with how its sibling action (`removeTask`)
is already handled.

## Reframed (or Confirmed) Problem Statement

> **The actual problem to plan around is**: the initial framing was
> correct. `TaskTile` has no gate — no confirm, no undo, no debounce —
> between a bare tap and a committed `logTask` write, and it's the only
> state-mutating action on this screen without one.

No hidden bug, no alternate root cause. This is a genuine missing-affordance
gap, not a mis-wired event handler or stale-closure bug. What would change
if addressed: any one of the roadmap's three mitigations (confirm dialog,
undo-via-toast-action, or long-press-to-log) would close dimensions 2–4
simultaneously, since they share the same root (zero-latency, no-reversal
commit).

## Confidence

- **HIGH** — evidence strong across all three hypotheses that matter
  (2, 3, 4), confirmed by direct code read, and the cross-system check
  (sibling `removeTask` action already gated) backs the same conclusion.

## What Changes for /10x-plan

The plan should pick and implement ONE of the roadmap's three mitigations
(confirm / undo-toast / long-press-to-log) for `TaskTile`'s tap-to-log path
— that choice is a solution-design decision and belongs to `/10x-plan`'s
question round, not to this frame. No further framing/diagnosis work is
needed first.

## References

- Source files: `src/routes/index.tsx:174-231`, `src/hooks/use-long-press.ts:1-58`
- Related context: `context/foundation/roadmap.md` (`## Open questions`, item #3)
