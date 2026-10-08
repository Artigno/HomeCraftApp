# Frame Brief: Shopping list sort order bounces on toggle

> Framing step before /10x-plan. This document captures what is *actually*
> at issue, separated from what was initially assumed.

## Reported Observation

Checked (done) items sink to the bottom of the list; unchecking an item
relocates it again (reported as "jumping back above still-checked items");
every single toggle — check or uncheck — visibly relocates the item rather
than leaving it in a stable position.

## Initial Framing (preserved)

- **User's stated cause or approach** (relayed via peer session `homecraftapi-30`): the frontend resorts by done-status on every toggle instead of preserving a stable order — likely a bug in `store.tsx`'s local sort/merge logic.
- **User's proposed direction**: check the local sort/merge logic in `store.tsx` or wherever the list is rendered.
- **Pre-dispatch narrowing**: bounce is the *final* resting position (not a transient flash that self-corrects), and it happens on *every* toggle, not just rapid double-toggles or drag-interaction edge cases.

## Dimension Map

The observation could originate at any of these dimensions:

1. **Toggle's move-to-end computation** (`toggleShoppingItem`, `src/lib/store.tsx:343-360`) — assigns `sort_order = Math.max(0, ...shopping.map(i => i.sort_order)) + 1` on every toggle, in either direction.  ← user's framing lands here
2. **Render-time freeze mechanism** (`ShoppingList`, `src/routes/shopping.tsx:103-128`) — delays the visual reflow ~400ms after a toggle so a fast second tap doesn't misfire.
3. **Drag-reorder's `sort_order` renumbering** (`handleDragEnd`, `src/routes/shopping.tsx:148-162`) — could in principle leave stale/colliding `sort_order` values that a later toggle computation trips over.
4. **since-cursor sync/merge** (`syncFromBackend`, `src/lib/store.tsx`, just rewired in the sibling change `shopping-list-since-cursor-reconciliation`) — could reorder the underlying array in a way that leaks into render.

## Hypothesis Investigation

| Hypothesis | Evidence | Verdict |
| --- | --- | --- |
| 1. Move-to-end computation is the origin | `store.tsx:350`: `nextOrder` is computed as the **global** max across the entire `shopping` array, with no done/not-done scoping, for both check and uncheck. The function's own comment (`store.tsx:346-349`) claims "move the toggled item to the end of its **new group**" — but the code does not scope by group at all; it always targets the absolute end of the whole list. | STRONG |
| 2. Freeze mechanism is the origin | Pre-dispatch answer ruled this out directly: the bounce is the *final* position, not a transient flash, and the freeze only delays the visual reflow for ~400ms — it doesn't change where the item ends up once it clears. | NONE |
| 3. Drag-reorder renumbering is the origin | Pre-dispatch answer ruled this out: bounce happens on *every* toggle, not only after a drag. `handleDragEnd` (`shopping.tsx:159-161`) only PATCHes items whose index actually changed, sequentially — no gap for the kind of collision that would explain an every-toggle symptom. | NONE |
| 4. since-cursor sync/merge is the origin | Render always derives from the `sorted` memo (`shopping.tsx:98-101`), which sorts live by each item's `sort_order` field — never by array/Map insertion order. The since-cursor merge (`syncFromBackend`) never mutates `sort_order` itself; it only preserves it under the queue-override. No code path connects the sync rewrite to toggle-time positioning. | NONE |

## Narrowing Signals

- User/peer confirmed: bounce is a **final-position** issue, present on **every** toggle — this single signal eliminated hypotheses 2 and 3 outright (both predict intermittent or transient symptoms, not "every toggle, settled wrong").
- Hypothesis 1's own in-code comment contradicts its own implementation ("end of its new group" vs. a computation with no group scoping at all) — a direct, file-level inconsistency, not an inference.

## Cross-System Convention

This exact tradeoff has been visited and explicitly re-confirmed across three successive plans in this codebase, not introduced by accident:

- `context/changes/shopping-list-ux-fixes/plan.md` (Phase 5, "Correction found during Phase 5's manual verification"): the *original* Phase 2 behavior left unchecking an item at its old `sort_order` among pending items (not the bottom) — this was judged wrong and fixed by adding the global `Math.max(...)+1` move-to-end logic, worded in that plan as moving to "the end of its new group" because at the time the list was still rendered done-to-bottom grouped (grouping was the primary sort key, `sort_order` only the tiebreaker) — so "end of list" and "end of group" were equivalent then.
- The same plan's **Phase 6** then explicitly drops that grouping: "changes the list's sort key from 'done-to-bottom, then `sort_order`' (Phase 2) to pure `sort_order` across all items — the user explicitly chose free reordering over preserving the done-group split," while separately noting "Phase 5's freeze mechanism is kept... toggling still moves an item's `sort_order` to the end of **the list**" (not "the group" — the wording itself shifts once grouping is gone).
- `context/changes/shopping-drag-reorder-fix/plan.md:392` manually re-verifies: "Toggle an item done — still moves to the end of the list after the [freeze]" — confirmed again, after drag-and-drop was added, as intended behavior.

So the current code matches the most recent explicit, manually-verified design intent (global end-of-list on every toggle) exactly. It is not a regression and not a merge/sort defect — the peer's theory ("resorting instead of preserving stable order") correctly names the *mechanism* but incorrectly assumes it's accidental.

## Reframed Problem Statement

> **The actual problem to plan around is**: whether "every toggle relocates the item to the absolute bottom of the entire list, including for uncheck" is still the right UX now that done/not-done grouping is gone — not a code defect in sort/merge logic.

The code does exactly what three successive, manually-verified plans asked for. The surprising part for a user is specifically the **uncheck** direction: unchecking sends the item past every already-done item to the literal bottom of everything, rather than back among the still-pending items — which is what "stable" would mean to someone used to a simple checklist. That's a product/UX decision to revisit (should uncheck target "end of the pending items" instead of "end of the whole list"?), not a bug to patch in the sync or merge code this session already touched.

## Confidence

**HIGH** — strong file-level evidence (the comment/code mismatch), two pre-dispatch answers that cleanly eliminated the other three dimensions, and three independent prior-plan documents that confirm the current behavior is intended and previously manually verified, not an accident.

## What Changes for /10x-plan

If this proceeds to planning, the plan is a **UX/design decision**, not a bug fix: decide (with the user) whether uncheck should move the item to the end of the *pending* subset (requires reintroducing a lightweight notion of "group end" without reintroducing full done-to-bottom grouping) versus leaving current behavior and only fixing the misleading code comment to stop claiming group-scoping it doesn't do. Either path is a small, well-scoped change — but it starts from "what should uncheck feel like" rather than "find the sort bug."

## References

- Source: `src/lib/store.tsx:343-360` (`toggleShoppingItem`)
- Source: `src/routes/shopping.tsx:93-162` (`sorted`, freeze mechanism, drag handlers)
- Prior plan: `context/changes/shopping-list-ux-fixes/plan.md` (Phase 2 original bug, Phase 5 correction, Phase 6 grouping removal)
- Prior plan: `context/changes/shopping-drag-reorder-fix/plan.md:392` (re-verification after drag-and-drop)
- Peer report: cross-session message from `homecraftapi-30`, relayed 2026-10-07
