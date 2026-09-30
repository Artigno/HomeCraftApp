# Shopping List UX Fixes — Plan Brief

> Full plan: `context/changes/shopping-list-ux-fixes/plan.md`

## What & Why

A user testing pass surfaced six shopping-list UX problems (relayed by a
peer session) plus a shared edit-task modal bug. This plan reworks the
list's interaction model — checkbox vs. label vs. drag as distinct tap
targets — and fixes two layout bugs, so the list behaves like a proper
iOS-Reminders-style checklist instead of one big tap-to-toggle row.

## Starting Point

Today the whole shopping-item row is one tap target (toggles done); new
items are added via a fixed bottom bar and get prepended to the top; there's
no inline rename, no drag reorder, and no persisted order field existed
until a peer session added `sort_order` mid-planning specifically for this
work. The edit-task `Drawer` has no scroll fallback and can clip content.

## Desired End State

Tapping a checkbox toggles; tapping a name edits it inline; tapping the
empty slot at the bottom adds items iOS-Reminders-style (Enter chains to a
new input); long-pressing and dragging reorders the list and it sticks
across reloads; a fast double-tap can't land on the wrong item; the
edit-task sheet always scrolls to fit its content.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Add-bar/tab-bar overlap fix | Not fixed directly — structurally eliminated | Phase 3 replaces the fixed add bar with an in-flow list row, so the overlap can't recur; fixing the offset first would be immediately-deleted work | Plan |
| Drawer scroll fix | `max-h-[85dvh] overflow-y-auto` on shared `DrawerContent` | One shared fix benefits every Drawer usage, not just this one | Plan |
| Add flow | Replace floating bar entirely | Matches the requested iOS Reminders pattern exactly, avoids two redundant add mechanisms | Plan |
| Edit trigger | Tap the label specifically; checkbox stays a separate tap target | Matches the literal request, keeps both actions one-tap | Plan |
| Editable fields | Name only | Matches the request; amount editing wasn't asked for | Plan |
| Debounce approach | Delay the re-sort, not the tap | Fixes the actual cause (item sliding away under a second tap), not just symptom-masking | Plan |
| Drag persistence | Persisted via backend `sort_order` | User wants it to stick across reload/devices; backend shipped the field same-session | Plan |
| Drag engagement | Long-press anywhere on the row (no dedicated handle) | User's explicit choice, accepted with a flagged gesture-conflict risk against swipe-to-delete | Plan |
| Reorder scope | Free reorder, drops done-to-bottom auto-sort | User's explicit choice; also makes Phase 5's debounce mechanism obsolete, removed in Phase 6 | Plan |

## Scope

**In scope:** edit-task drawer scroll fix, shopping-item data model
(`sort_order`), inline chained add flow, inline name edit, toggle-debounce,
drag-and-drop reorder with backend persistence.

**Out of scope:** receipt parse/save, AI-categorize endpoint (backend
team's items), inline editing of `amount`, a dedicated drag-handle icon,
cross-row gesture locking during another row's drag, server-side
reindex/collision logic.

## Architecture / Approach

All changes live in `src/routes/shopping.tsx`, `src/lib/store.tsx`,
`src/lib/api/types.ts`, and `src/components/ui/drawer.tsx` — no new routes.
`@dnd-kit/core`+`sortable`+`utilities` is the one new dependency, added in
the last phase. Each phase ships and is manually verified before the next
starts; the sort key changes twice across phases (done-then-sort_order in
Phase 2, pure sort_order in Phase 6) by design, not oversight.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Drawer scroll fix | Edit-task sheet never clips content | Low — standard CSS fix |
| 2. `sort_order` + append fix | New items land at the bottom, in order | Low — mirrors an existing store pattern |
| 3. Inline add flow | iOS-Reminders chained add, replaces fixed bar | Medium — focus-retention across re-renders is easy to get subtly wrong |
| 4. Inline edit | Tap-label rename, split from toggle | Medium — restructuring the row's tap targets without breaking swipe-to-delete |
| 5. Debounced re-sort | Fixes tap-bleed onto the wrong item | Low — self-contained, later superseded |
| 6. Drag-and-drop | Persisted manual reorder | High — two pointer-gesture systems (swipe-to-delete + dnd-kit) must compose cleanly on one element |

**Prerequisites:** Backend `sort_order` field (confirmed shipped by the
peer session before Phase 2 starts).
**Estimated effort:** ~6 short sessions, one per phase — Phase 6 is the
one likely to need iteration.

## Open Risks & Assumptions

- Phase 6's gesture composition (long-press-drag vs. horizontal swipe on
  the same element) is the plan's single highest-risk item — mitigation is
  specified in the full plan's Critical Implementation Details, but real
  on-device testing (beyond devtools emulation) is recommended before
  calling this phase done.
- Devtools mobile emulation doesn't perfectly reproduce real
  `safe-area-inset-bottom` values or true on-screen-keyboard resize
  behavior — a real-device spot-check is recommended for Phase 1 and
  Phase 3 before treating them as fully verified.

## Success Criteria (Summary)

- A user can add, rename, check, and reorder shopping items using only the
  gestures each control implies (tap checkbox, tap name, long-press to
  drag) without one interfering with another.
- Reordering and new-item order both survive a reload.
- The edit-task sheet is always fully usable regardless of screen size or
  keyboard state.
