# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## Keep setState updaters pure; hoist order-math reads outside, but watch same-batch collisions

**Context**: `src/lib/store.tsx`, any shopping-list (or similar ordered-list) store method that computes a sort_order/index from current state before calling setState.

**Problem**: `addShoppingItems`/`toggleShoppingItem` used to generate ids and call `enqueue()` INSIDE their `setState` updater — React can replay a functional updater (dev-mode purity check), replaying the side effect and creating real duplicate rows. The fix (hoist id-gen/enqueue/order-math outside `setState`, read the outer `state` closure) is now the correct, required pattern — but it reads a snapshot that two synchronous same-batch calls would share, risking an order-value collision if that ever happens (not yet observed; no current call site triggers it).

**Rule**: Never compute ids or call `enqueue()`/other side effects inside a `setState` updater; always hoist them before `setState`, reading the outer `state` closure for current-value snapshots. If a future change adds a bulk/batched mutation that could call such a method multiple times within one React batch, re-check whether the order-math read-before-setState pattern needs a stronger guard than the current same-render-closure read.

**Applies to**: plan, implement, impl-review
