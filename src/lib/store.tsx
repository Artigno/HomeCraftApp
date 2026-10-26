import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import {
  apiCategorizeShoppingItems,
  apiCreateShoppingTag,
  apiDeleteShoppingTag,
  apiGet,
  apiGetShoppingItems,
  apiPatchShoppingTag,
  enqueue,
  flushQueue,
  readActiveTagId,
  readQueue,
  readShoppingCursor,
  writeActiveTagId,
  writeShoppingCursor,
} from "./api/client";
import type {
  HomeSyncState,
  MaintenanceTask,
  Purchase,
  PurchaseLine,
  Recipe,
  ShoppingItem,
  ShoppingTag,
  TaskStatus,
  Tin,
} from "./api/types";
import { isAuthenticated } from "./auth";
import { createSeedState } from "./seed";

const STORAGE_KEY = "homesync.state.v1";

interface StoreValue extends HomeSyncState {
  hydrated: boolean;
  pendingSync: number;
  refresh: () => Promise<void>;
  /** Household items are partitioned by tag (Phase 3) — null only when the
   * household has zero tags yet (no tab to scope items into). */
  activeTagId: string | null;
  /** Switches the active tab and refetches that tag's items. */
  setActiveTag: (id: string) => void;
  logTask: (taskId: string) => void;
  addTask: (task: Omit<MaintenanceTask, "id" | "last_done_at">) => void;
  removeTask: (taskId: string) => void;
  updateTask: (taskId: string, patch: Partial<Omit<MaintenanceTask, "id">>) => void;
  addShoppingItems: (
    items: Array<
      Omit<ShoppingItem, "id" | "created_at" | "updated_at" | "done" | "sort_order" | "tag_id">
    >,
  ) => void;
  toggleShoppingItem: (id: string) => void;
  removeShoppingItem: (id: string) => void;
  dismissWarning: (id: string) => void;
  updateShoppingItem: (
    id: string,
    patch: Partial<Pick<ShoppingItem, "name" | "sort_order">>,
  ) => void;
  completePurchase: (data: {
    store: string;
    total: number;
    category: string;
    lines?: PurchaseLine[];
    purchased_at?: string;
    receipt_image_path?: string;
  }) => Promise<void>;
  /** Clears checked-off items from the list without recording a purchase —
   * for items already accounted for in the budget some other way (e.g. a
   * separate receipt scan), where completePurchase() would double-count. */
  discardCompletedShoppingItems: () => void;
  /** AI-reorders pending items into aisle-category order; server-authoritative,
   * no optimistic local sort. Returns false (list left untouched) on failure. */
  categorizeShoppingItems: () => Promise<boolean>;
  daysSincePurchase: (name: string) => number | undefined;
  /** Returns false (name rejected — likely a duplicate within the household) without touching state. */
  addTag: (name: string) => Promise<boolean>;
  renameTag: (id: string, name: string) => Promise<boolean>;
  /** Sends one PATCH per tag whose sort_order actually changed vs. current state. */
  reorderTags: (orderedTags: ShoppingTag[]) => Promise<void>;
  /** No cascade: backend 409s if the tag still has items. Returns
   * `{ok:false, conflict:true}` for that case so the caller can show a
   * distinct "still has items" message instead of a generic error. On
   * success, if the deleted tag was active, switches to the first
   * remaining tag (or null if none left) and refetches its items. */
  removeTag: (id: string) => Promise<{ ok: true } | { ok: false; conflict: boolean }>;
  addRecipe: (recipe: Omit<Recipe, "id">) => void;
  updateRecipe: (recipeId: string, patch: Partial<Omit<Recipe, "id">>) => void;
  addTin: (tin: Omit<Tin, "id">) => void;
  removeTin: (id: string) => void;
}

const StoreContext = createContext<StoreValue | null>(null);

export function daysBetween(iso: string) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

export function taskStatus(task: MaintenanceTask): TaskStatus {
  const ratio = daysBetween(task.last_done_at) / task.frequency_days;
  if (ratio >= 1) return "overdue";
  if (ratio >= 0.65) return "warning";
  return "good";
}

/** Push the local seed to the backend so a brand-new account has matching
 * rows. `tagId` is null for a truly empty household (zero tags) — the
 * shopping-items batch is skipped in that case since there's no tag to
 * assign the seed items to (Phase 3 requires one); the other domains still
 * push normally. */
function pushSeed(seed: HomeSyncState, tagId: string | null) {
  seed.tasks.forEach((t) => enqueue("POST", "/maintenance-tasks", t));
  seed.recipes.forEach((r) => enqueue("POST", "/recipes", r));
  if (tagId !== null && seed.shopping.length) {
    enqueue("POST", "/shopping-items/batch", {
      tag_id: tagId,
      items: seed.shopping.map((i) => ({ ...i, tag_id: tagId })),
    });
  }
  seed.purchases.forEach((p) => enqueue("POST", "/receipts/process", p));
}

export function HomeSyncProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<HomeSyncState>(() => createSeedState());
  const [hydrated, setHydrated] = useState(false);
  const [pendingSync, setPendingSync] = useState(0);
  const [activeTagId, setActiveTagIdState] = useState<string | null>(() => readActiveTagId());
  const localSeedRef = useRef<HomeSyncState | null>(null);

  // Items are tag-partitioned (Phase 3) — `state.shopping` only ever holds
  // the ACTIVE tag's items, wholesale-replaced on tag switch. Split out from
  // syncFromBackend below so switching tabs can refetch just this slice
  // instead of every domain.
  const fetchItemsForTag = useCallback(
    async (tagId: string, opts?: { incremental?: boolean; retriedAfterInvalidSince?: boolean }) => {
      const incremental = opts?.incremental ?? false;
      // A full resync omits `since` entirely to hit the backend's unfiltered
      // branch; an incremental sync with no stored cursor falls back to the
      // same since-omitted full resync rather than an epoch sentinel.
      const since = incremental ? readShoppingCursor(tagId) || undefined : undefined;
      const result = await apiGetShoppingItems(tagId, since);
      // null means the request failed (offline, 401, ...) — apiGet already
      // handles those; keep whatever's local and let the queue sync later.
      if (result === null) return;
      if (!result.ok) {
        if (result.invalidSince && !opts?.retriedAfterInvalidSince) {
          // Corrupted/invalid stored cursor — clear it and retry once as a
          // full since-omitted fetch within the same pass. The
          // retriedAfterInvalidSince flag caps this at a single retry as a
          // safety net, though a since-omitted request can no longer 422.
          writeShoppingCursor(tagId, null);
          await fetchItemsForTag(tagId, { incremental: false, retriedAfterInvalidSince: true });
        }
        // Non-cursor failure, or already retried once: keep local state, next
        // natural sync trigger retries.
        return;
      }
      const shopping = result.items;

      setState((s) => {
        // A toggle's PATCHes (the toggle itself + the sort_order move that
        // rides along with it, see toggleShoppingItem) can still be queued
        // (not yet flushed) when this GET lands — the backend then reports
        // whichever done/sort_order preceded that toggle. Trust the
        // pre-sync local value for any id with either PATCH still pending,
        // rather than only one-directionally preferring done:true as before.
        const pendingIds = new Set(
          readQueue()
            .map((r) =>
              r.method === "PATCH" ? /^\/shopping-items\/([^/]+)(?:\/toggle)?$/.exec(r.path) : null,
            )
            .filter((m): m is RegExpExecArray => m !== null)
            .map((m) => m[1]!),
        );
        const preSyncById = new Map(s.shopping.map((i) => [i.id, i]));
        const applyQueueOverride = (item: ShoppingItem): ShoppingItem => {
          if (!pendingIds.has(item.id)) return item;
          const pre = preSyncById.get(item.id);
          return pre ? { ...item, done: pre.done, sort_order: pre.sort_order } : item;
        };

        const nextShopping = incremental
          ? (() => {
              // Upsert-only: a since-cursor response has no deletion markers,
              // so a backend-side delete isn't purged from local state until
              // the next full (mount/login/tag-switch) resync replaces the
              // list wholesale.
              const byId = new Map(s.shopping.map((i) => [i.id, i]));
              for (const item of shopping) byId.set(item.id, applyQueueOverride(item));
              return [...byId.values()];
            })()
          : (() => {
              const base = shopping.map(applyQueueOverride);
              // A full resync otherwise replaces s.shopping wholesale — a
              // newly-added item whose /shopping-items/batch POST hasn't
              // flushed yet would vanish until that create lands server-side.
              // Carry forward any local item still covered by a pending
              // batch-create (for this tag) and absent from the fetched set.
              const fetchedIds = new Set(shopping.map((i) => i.id));
              const pendingCreateIds = new Set(
                readQueue()
                  .filter((r) => r.method === "POST" && r.path === "/shopping-items/batch")
                  .flatMap((r) => {
                    const body = r.body as { tag_id?: string; items?: ShoppingItem[] } | undefined;
                    if (body?.tag_id !== tagId) return [];
                    return (body?.items ?? []).map((i) => i.id);
                  }),
              );
              const unflushedLocalCreates = s.shopping.filter(
                (i) => pendingCreateIds.has(i.id) && !fetchedIds.has(i.id),
              );
              return [...base, ...unflushedLocalCreates];
            })();

        return { ...s, shopping: nextShopping };
      });

      if (shopping.length > 0) {
        const maxUpdatedAt = shopping.reduce(
          (max, i) => (i.updated_at > max ? i.updated_at : max),
          shopping[0]!.updated_at,
        );
        writeShoppingCursor(tagId, maxUpdatedAt);
      }
    },
    [],
  );

  // Pull the canonical lists from the backend so ids/content match the
  // server (not a locally-generated guess) — without this, every reinstall
  // re-seeds with fresh random ids that can diverge from what's already
  // there, and a second device never sees the first device's data at all.
  const syncFromBackend = useCallback(
    async (opts?: { incremental?: boolean }) => {
      if (!isAuthenticated()) return;
      const incremental = opts?.incremental ?? false;
      const [tasks, recipes, purchases, tins, tags] = await Promise.all([
        apiGet<MaintenanceTask[] | null>("/maintenance-tasks", null),
        apiGet<Recipe[] | null>("/recipes", null),
        apiGet<Purchase[] | null>("/purchases", null),
        apiGet<Tin[] | null>("/tins", null),
        apiGet<ShoppingTag[] | null>("/shopping-tags", null),
      ]);
      // null means the request failed (offline, 401, ...) — apiGet already
      // handles those; keep whatever's local and let the queue sync later.
      if (
        tasks === null ||
        recipes === null ||
        purchases === null ||
        tins === null ||
        tags === null
      ) {
        return;
      }

      // Resolve which tag is active: keep the persisted choice if it still
      // exists, else fall back to the first tag by sort_order, else null
      // (a household with zero tags has nothing to scope items into yet).
      const sortedTags = [...tags].sort((a, b) => a.sort_order - b.sort_order);
      const resolvedTagId = tags.some((t) => t.id === activeTagId)
        ? activeTagId
        : (sortedTags[0]?.id ?? null);
      if (resolvedTagId !== activeTagId) {
        setActiveTagIdState(resolvedTagId);
        writeActiveTagId(resolvedTagId);
      }

      const backendHasData = tasks.length + recipes.length + purchases.length + tins.length > 0;
      // tags/shopping intentionally excluded from this seed-trigger check —
      // a brand new household has 0 of both too, and this only governs
      // whether to push the OTHER local-seed domains once.
      if (!backendHasData && !incremental) {
        // Brand-new account with nothing on the backend yet: seed it once,
        // exactly like a fresh device would, so there's demo content either way.
        if (localSeedRef.current) pushSeed(localSeedRef.current, resolvedTagId);
      }

      setState((s) => ({
        ...s,
        tasks,
        recipes,
        purchases,
        tins,
        tags,
        logs: incremental ? s.logs : [],
      }));

      if (resolvedTagId !== null) {
        await fetchItemsForTag(resolvedTagId, { incremental });
      } else {
        setState((s) => ({ ...s, shopping: [] }));
      }
    },
    [activeTagId, fetchItemsForTag],
  );

  useEffect(() => {
    let raw: string | null = null;
    try {
      raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) setState(JSON.parse(raw) as HomeSyncState);
    } catch {
      /* corrupt cache -> keep seed */
    }
    if (!raw) localSeedRef.current = state;
    void syncFromBackend();

    setHydrated(true);
    setPendingSync(readQueue().length);
    void flushQueue();
    const onQueue = (e: Event) => setPendingSync((e as CustomEvent<number>).detail);
    window.addEventListener("homesync:queue", onQueue);
    // Mount can happen on /login before a token exists — syncFromBackend()
    // no-ops then, so re-run it the moment login actually succeeds.
    const onAuth = () => void syncFromBackend();
    window.addEventListener("homesync:auth", onAuth);
    // Re-pull on return-to-app (tab switch, PWA resume from background, OS
    // app-switcher) so a change another household member made while this
    // device was away shows up without a manual reload. "visibilitychange"
    // alone covers PWA resume; "focus" additionally covers desktop
    // multi-window/multi-tab switching, which visibilitychange can miss.
    const onReturnToApp = () => {
      if (document.visibilityState === "visible") {
        void syncFromBackend({ incremental: true });
        // force: true — this resume event IS the signal that any prior
        // in-flight flush (started before a screen-lock suspended the JS
        // context) is stale, so don't make the user wait out flushQueue's
        // own time-based staleness bound. See client.ts for the full story.
        void flushQueue({ force: true });
      }
    };
    document.addEventListener("visibilitychange", onReturnToApp);
    window.addEventListener("focus", onReturnToApp);
    // The service worker broadcasts on every push it receives (regardless of
    // event_type) — ignore the payload and just resync, since syncFromBackend
    // already pulls every domain in one pass and no-ops when unauthenticated.
    const pushChannel = new BroadcastChannel("homesync-push");
    const onPush = () => void syncFromBackend({ incremental: true });
    pushChannel.addEventListener("message", onPush);
    return () => {
      window.removeEventListener("homesync:queue", onQueue);
      window.removeEventListener("homesync:auth", onAuth);
      document.removeEventListener("visibilitychange", onReturnToApp);
      window.removeEventListener("focus", onReturnToApp);
      pushChannel.removeEventListener("message", onPush);
      pushChannel.close();
    };
  }, [syncFromBackend]);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state, hydrated]);

  const haptic = useCallback((ms = 12) => {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(ms);
  }, []);

  const daysSincePurchase = useCallback(
    (name: string) => {
      const needle = name.trim().toLowerCase();
      const dates = state.purchases
        .filter((p) => p.lines.some((l) => l.name.toLowerCase() === needle))
        .map((p) => daysBetween(p.purchased_at));
      return dates.length ? Math.min(...dates) : undefined;
    },
    [state.purchases],
  );

  // Same pair the mount effect's visibilitychange/focus handler runs — pull-
  // to-refresh is just another manual trigger for the same resync.
  const refresh = useCallback(async () => {
    await syncFromBackend({ incremental: true });
    await flushQueue();
  }, [syncFromBackend]);

  const value = useMemo<StoreValue>(
    () => ({
      ...state,
      hydrated,
      pendingSync,
      refresh,
      activeTagId,
      setActiveTag: (id) => {
        if (id === activeTagId) return;
        setActiveTagIdState(id);
        writeActiveTagId(id);
        // Clear immediately so a slow fetch never shows the previous tag's
        // items under the newly-active tab.
        setState((s) => ({ ...s, shopping: [] }));
        void fetchItemsForTag(id, { incremental: false });
      },
      logTask: (taskId) => {
        haptic();
        const loggedAt = new Date().toISOString();
        setState((s) => ({
          ...s,
          tasks: s.tasks.map((t) => (t.id === taskId ? { ...t, last_done_at: loggedAt } : t)),
          logs: [{ id: crypto.randomUUID(), task_id: taskId, logged_at: loggedAt }, ...s.logs],
        }));
        enqueue("POST", "/maintenance-logs", { task_id: taskId, logged_at: loggedAt });
      },
      addTask: (task) => {
        const created: MaintenanceTask = {
          ...task,
          id: crypto.randomUUID(),
          last_done_at: new Date().toISOString(),
        };
        setState((s) => ({ ...s, tasks: [created, ...s.tasks] }));
        enqueue("POST", "/maintenance-tasks", created);
      },
      removeTask: (taskId) => {
        setState((s) => ({ ...s, tasks: s.tasks.filter((t) => t.id !== taskId) }));
        enqueue("DELETE", `/maintenance-tasks/${taskId}`);
      },
      updateTask: (taskId, patch) => {
        setState((s) => ({
          ...s,
          tasks: s.tasks.map((t) => (t.id === taskId ? { ...t, ...patch } : t)),
        }));
        enqueue("PATCH", `/maintenance-tasks/${taskId}`, patch);
      },
      addShoppingItems: (items) => {
        // No active tag (household has zero tags) — nothing to add into.
        if (activeTagId === null) return;
        haptic();
        // id generation + enqueue() must run exactly once per call, so they
        // live outside the setState updater — React may invoke a functional
        // updater more than once per update (a dev-mode purity check), and
        // anything with a side effect inside it would then fire twice. Same
        // convention every other method in this store already follows (see
        // the note on completePurchase below).
        const baseOrder = Math.max(0, ...state.shopping.map((i) => i.sort_order)) + 1;
        const nowIso = new Date().toISOString();
        const created: ShoppingItem[] = items.map((i, index) => ({
          ...i,
          id: crypto.randomUUID(),
          done: false,
          created_at: nowIso,
          updated_at: nowIso,
          sort_order: baseOrder + index,
          tag_id: activeTagId,
        }));
        enqueue("POST", "/shopping-items/batch", { tag_id: activeTagId, items: created });
        setState((s) => ({ ...s, shopping: [...s.shopping, ...created] }));
      },
      toggleShoppingItem: (id) => {
        haptic();
        // enqueue() must run exactly once per call — see addShoppingItems
        // above for why this lives outside the setState updater.
        const current = state.shopping.find((i) => i.id === id);
        const nextDone = !current?.done;
        // Move the toggled item to the end of its new group (pending when
        // unchecking, done when checking) — not the end of the whole list,
        // so unchecking lands among pending items instead of past every
        // already-done item.
        const nextOrder =
          Math.max(
            0,
            ...state.shopping.filter((i) => i.done === nextDone).map((i) => i.sort_order),
          ) + 1;
        enqueue("PATCH", `/shopping-items/${id}/toggle`, { done: nextDone });
        enqueue("PATCH", `/shopping-items/${id}`, { sort_order: nextOrder });
        setState((s) => ({
          ...s,
          shopping: s.shopping.map((i) =>
            i.id === id ? { ...i, done: nextDone, sort_order: nextOrder } : i,
          ),
        }));
      },
      removeShoppingItem: (id) => {
        setState((s) => ({ ...s, shopping: s.shopping.filter((i) => i.id !== id) }));
        enqueue("DELETE", `/shopping-items/${id}`);
      },
      dismissWarning: (id) => {
        setState((s) => ({
          ...s,
          shopping: s.shopping.map((i) => (i.id === id ? { ...i, warning_dismissed: true } : i)),
        }));
        enqueue("PATCH", `/shopping-items/${id}`, { warning_dismissed: true });
      },
      updateShoppingItem: (id, patch) => {
        setState((s) => ({
          ...s,
          shopping: s.shopping.map((i) => (i.id === id ? { ...i, ...patch } : i)),
        }));
        enqueue("PATCH", `/shopping-items/${id}`, patch);
      },
      completePurchase: async ({
        store,
        total,
        category,
        lines,
        purchased_at,
        receipt_image_path,
      }) => {
        haptic(25);
        const bought = state.shopping.filter((i) => i.done);
        const purchase: Purchase = {
          id: crypto.randomUUID(),
          store,
          category,
          total,
          purchased_at: purchased_at ?? new Date().toISOString(),
          lines:
            lines ??
            bought.map((i) => ({
              name: i.name,
              price: Math.round((total / Math.max(bought.length, 1)) * 100) / 100,
            })),
          ...(receipt_image_path ? { receipt_image_path } : {}),
        };
        setState((s) => ({
          ...s,
          shopping: s.shopping.filter((i) => !i.done),
          purchases: [purchase, ...s.purchases],
        }));
        // enqueue() runs outside the setState updater (which React defers to
        // the next render, not this tick) so the request is actually queued
        // before flushQueue() looks for it — otherwise flushQueue() sees an
        // empty queue and resolves instantly, closing the modal with no
        // loader while the real request still fires fire-and-forget later.
        enqueue("POST", "/receipts/process", purchase);
        // Delete by specific id, not the bulk /shopping-items/done endpoint:
        // enqueue() is a durable, possibly-delayed offline queue, and a bulk
        // "clear whatever's done" request replayed late would also delete
        // any item marked done *after* this call (by this device or another
        // household member) but *before* the request actually flushes.
        // Per-id delete only ever removes the items that were done right now.
        bought.forEach((i) => enqueue("DELETE", `/shopping-items/${i.id}`));
        await flushQueue();
      },
      discardCompletedShoppingItems: () => {
        // enqueue() must run outside the setState updater — see
        // addShoppingItems above for why. Per-id delete (not the bulk
        // /shopping-items/done endpoint) for the same reason as
        // completePurchase above — see its comment.
        const done = state.shopping.filter((i) => i.done);
        done.forEach((i) => enqueue("DELETE", `/shopping-items/${i.id}`));
        setState((s) => ({ ...s, shopping: s.shopping.filter((i) => !i.done) }));
      },
      categorizeShoppingItems: async () => {
        if (activeTagId === null) return false;
        const result = await apiCategorizeShoppingItems(activeTagId);
        if (!result.ok) return false;
        setState((s) => ({ ...s, shopping: result.items }));
        return true;
      },
      daysSincePurchase,
      addTag: async (name) => {
        const result = await apiCreateShoppingTag(name);
        if (!result.ok) return false;
        setState((s) => ({ ...s, tags: [...s.tags, result.data] }));
        return true;
      },
      renameTag: async (id, name) => {
        const result = await apiPatchShoppingTag(id, { name });
        if (!result.ok) return false;
        setState((s) => ({
          ...s,
          tags: s.tags.map((t) => (t.id === id ? result.data : t)),
        }));
        return true;
      },
      reorderTags: async (orderedTags) => {
        const byId = new Map(state.tags.map((t) => [t.id, t]));
        const changed = orderedTags
          .map((t, index) => ({ id: t.id, sort_order: index }))
          .filter(({ id, sort_order }) => byId.get(id)?.sort_order !== sort_order);
        setState((s) => ({
          ...s,
          tags: orderedTags.map((t, index) => ({ ...t, sort_order: index })),
        }));
        await Promise.all(
          changed.map(({ id, sort_order }) => apiPatchShoppingTag(id, { sort_order })),
        );
      },
      removeTag: async (id) => {
        const result = await apiDeleteShoppingTag(id);
        if (!result.ok) return { ok: false, conflict: result.conflict };
        const remaining = state.tags.filter((t) => t.id !== id);
        setState((s) => ({ ...s, tags: remaining }));
        if (id === activeTagId) {
          const sorted = [...remaining].sort((a, b) => a.sort_order - b.sort_order);
          const nextTagId = sorted[0]?.id ?? null;
          setActiveTagIdState(nextTagId);
          writeActiveTagId(nextTagId);
          if (nextTagId !== null) {
            void fetchItemsForTag(nextTagId, { incremental: false });
          } else {
            setState((s) => ({ ...s, shopping: [] }));
          }
        }
        return { ok: true };
      },
      addRecipe: (recipe) => {
        const created: Recipe = { ...recipe, id: crypto.randomUUID() };
        setState((s) => ({ ...s, recipes: [created, ...s.recipes] }));
        enqueue("POST", "/recipes", created);
      },
      updateRecipe: (recipeId, patch) => {
        setState((s) => ({
          ...s,
          recipes: s.recipes.map((r) => (r.id === recipeId ? { ...r, ...patch } : r)),
        }));
        enqueue("PATCH", `/recipes/${recipeId}`, patch);
      },
      addTin: (tin) => {
        const created: Tin = { ...tin, id: crypto.randomUUID() };
        setState((s) => ({ ...s, tins: [created, ...s.tins] }));
        enqueue("POST", "/tins", created);
      },
      removeTin: (id) => {
        setState((s) => ({ ...s, tins: s.tins.filter((t) => t.id !== id) }));
        enqueue("DELETE", `/tins/${id}`);
      },
    }),
    [
      state,
      hydrated,
      pendingSync,
      refresh,
      haptic,
      daysSincePurchase,
      activeTagId,
      fetchItemsForTag,
    ],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useHomeSync() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useHomeSync must be used inside HomeSyncProvider");
  return ctx;
}
