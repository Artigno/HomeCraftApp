# Shopping List Toggle Sort Bounce & Done-Items Section — Plan Brief

> Full plan: `context/changes/shopping-list-toggle-sort-bounce/plan.md`
> Frame brief: `context/changes/shopping-list-toggle-sort-bounce/frame.md`

## What & Why

The actual problem (per the frame brief) is not a code defect — `toggleShoppingItem` matches three successive, manually-verified prior plans exactly. The real issue is that "every toggle relocates the item to the absolute bottom of the entire list, including for uncheck" no longer matches user expectations now that done/pending grouping is gone. This plan fixes the underlying targeting bug the frame also found (a stale comment vs. an un-scoped computation) and addresses the UX gap with a collapsed-by-default "done items" section, plus relocates two list-level actions into the existing header menu.

## Starting Point

`toggleShoppingItem` (`src/lib/store.tsx:343-360`) always computes the new `sort_order` as the global max across the whole list, for both check and uncheck — contradicting its own comment ("end of its new group"). The list renders done and pending items in one flat, drag-sortable array. "Zakończ zakupy" and "Wyczyść zaznaczone" live in a fixed button block below the list.

## Desired End State

Checking an item sends it to the end of the done group; unchecking sends it to the end of the pending group — not past everything. Done items live in a collapsed-by-default, tap-to-expand accordion, non-draggable. Pending items keep drag-reorder exactly as before. "Zakończ zakupy" and "Wyczyść zaznaczone" move into the header's existing "⋮" actions menu, next to "Kategoryzuj AI."

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Toggle sort targeting | Group-scoped (pending-end on uncheck, done-end on check) | Matches the "stable checklist" mental model the bug report expects. | Plan (confirmed via questioning) |
| Done items UI | Collapsed-by-default accordion, no persistence across reloads | Keeps pending list clean; user explicitly rejected remembering expand state. | Plan |
| Drag scope | Pending-only `SortableContext`; done rows have no drag plumbing | User explicitly rejected drag for already-bought items — low value, extra complexity. | Plan |
| Uncheck-from-accordion behavior | Item moves to pending; accordion stays however it was | Predictable, no surprise auto-collapse. | Plan |
| Checkout/clear actions placement | Move into existing header dropdown, alongside "Kategoryzuj AI" | Matches the established list-level-action pattern already in this view. | Plan |
| Freeze mechanism scope | Stays, but now implicitly pending-only (its source data narrows) | Minimal change to a working, tested mechanism. | Plan |
| Verification approach | One full-cycle manual pass after Phase 3, not per-phase | User's explicit preference — faster overall, catches cross-phase interactions. | Plan |

## Scope

**In scope:**
- Group-scoped `sort_order` computation in `toggleShoppingItem`
- Collapsed-by-default done-items accordion with a non-draggable row component
- Empty-state subtitle fix for "all done, nothing pending"
- Relocating "Zakończ zakupy" / "Wyczyść zaznaczone" into the header menu

**Out of scope:**
- Drag support for done items
- Persisting accordion expand/collapse state across reloads
- Auto-collapsing the accordion when it empties out
- Any backend/data-model change (`sort_order` stays a plain integer, no uniqueness guarantee needed across groups)
- Automated tests (no test runner in this repo)

## Architecture / Approach

Client-only, single file for the UI (`src/routes/shopping.tsx`) plus one function in `src/lib/store.tsx`. The list's `sorted` memo splits into `sorted` (pending-only, unchanged drag/freeze) and a new `doneSorted` memo (done-only, feeds the new accordion). No new SortableContext for done items — just a leaner row component with no drag hooks at all.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Group-scoped toggle targeting | Fixes the root `sort_order` bug in `store.tsx` | Low — isolated, single function |
| 2. Collapsible done-items section | New accordion UI, pending/done split, new row component | Medium — most new code, UI restructuring |
| 3. Relocate checkout actions | Moves two actions into the header menu | Low — cosmetic relocation |

**Prerequisites:** None — builds on the already-shipped `shopping-list-since-cursor-reconciliation` change (its queue-override is confirmed compatible, no changes needed there).
**Estimated effort:** ~1 session across 3 phases — small, well-scoped, no backend work.

## Open Risks & Assumptions

- Assumes done items never need per-item reordering among themselves (user confirmed this is fine).
- Assumes the single full-cycle manual pass at the end will surface any cross-phase interaction issues — if it doesn't, may need a follow-up targeted pass.

## Success Criteria (Summary)

- Unchecking an item never again jumps past every already-done item — it lands among pending items.
- Done items are tucked into a collapsed accordion by default; pending list only shows what's left to buy.
- "Zakończ zakupy" and "Wyczyść zaznaczone" are reachable from the header's "⋮" menu, not a separate fixed button block.
