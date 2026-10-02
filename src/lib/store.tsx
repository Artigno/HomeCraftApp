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
import { apiCategorizeShoppingItems, apiGet, enqueue, flushQueue, readQueue } from "./api/client";
import type {
  HomeSyncState,
  MaintenanceTask,
  Purchase,
  PurchaseLine,
  Recipe,
  ShoppingItem,
  TaskStatus,
  Tin,
} from "./api/types";
import { isAuthenticated } from "./auth";
import { createSeedState } from "./seed";

const STORAGE_KEY = "homesync.state.v1";

interface StoreValue extends HomeSyncState {
  hydrated: boolean;
  pendingSync: number;
  logTask: (taskId: string) => void;
  addTask: (task: Omit<MaintenanceTask, "id" | "last_done_at">) => void;
  removeTask: (taskId: string) => void;
  updateTask: (taskId: string, patch: Partial<Omit<MaintenanceTask, "id">>) => void;
  addShoppingItems: (
    items: Array<Omit<ShoppingItem, "id" | "created_at" | "done" | "sort_order">>,
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
  }) => Promise<void>;
  /** AI-reorders pending items into aisle-category order; server-authoritative,
   * no optimistic local sort. Returns false (list left untouched) on failure. */
  categorizeShoppingItems: () => Promise<boolean>;
  daysSincePurchase: (name: string) => number | undefined;
  addRecipe: (recipe: Omit<Recipe, "id">) => void;
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

/** Push the local seed to the backend so a brand-new account has matching rows. */
function pushSeed(seed: HomeSyncState) {
  seed.tasks.forEach((t) => enqueue("POST", "/maintenance-tasks", t));
  seed.recipes.forEach((r) => enqueue("POST", "/recipes", r));
  if (seed.shopping.length) enqueue("POST", "/shopping-items/batch", { items: seed.shopping });
  seed.purchases.forEach((p) => enqueue("POST", "/receipts/process", p));
}

export function HomeSyncProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<HomeSyncState>(() => createSeedState());
  const [hydrated, setHydrated] = useState(false);
  const [pendingSync, setPendingSync] = useState(0);
  const localSeedRef = useRef<HomeSyncState | null>(null);

  // Pull the canonical lists from the backend so ids/content match the
  // server (not a locally-generated guess) — without this, every reinstall
  // re-seeds with fresh random ids that can diverge from what's already
  // there, and a second device never sees the first device's data at all.
  const syncFromBackend = useCallback(async () => {
    if (!isAuthenticated()) return;
    const [tasks, recipes, shopping, purchases, tins] = await Promise.all([
      apiGet<MaintenanceTask[] | null>("/maintenance-tasks", null),
      apiGet<Recipe[] | null>("/recipes", null),
      apiGet<ShoppingItem[] | null>("/shopping-items", null),
      apiGet<Purchase[] | null>("/purchases", null),
      apiGet<Tin[] | null>("/tins", null),
    ]);
    // null means the request failed (offline, 401, ...) — apiGet already
    // handles those; keep whatever's local and let the queue sync later.
    if (
      tasks === null ||
      recipes === null ||
      shopping === null ||
      purchases === null ||
      tins === null
    ) {
      return;
    }

    const backendHasData =
      tasks.length + recipes.length + shopping.length + purchases.length + tins.length > 0;
    if (!backendHasData) {
      // Brand-new account with nothing on the backend yet: seed it once,
      // exactly like a fresh device would, so there's demo content either way.
      if (localSeedRef.current) pushSeed(localSeedRef.current);
      return;
    }

    setState((s) => {
      // /shopping-items excludes done items server-side, but a checked-off
      // item is still mid-purchase on this device until completePurchase()
      // runs — keep it visible until then, or it vanishes on the next
      // focus/visibility sync before the user ever confirms the receipt.
      const fetchedIds = new Set(shopping.map((i) => i.id));
      const inProgress = s.shopping.filter((i) => i.done && !fetchedIds.has(i.id));
      // A toggle's PATCH can still be in flight (queued, not yet sent) when
      // this GET lands — the backend then still reports done:false for an
      // item the user already checked off locally. Trust the local done
      // flag in that window instead of overwriting it with the stale
      // server value, or "Zakończ zakupy" goes right back to disabled.
      const localDoneIds = new Set(s.shopping.filter((i) => i.done).map((i) => i.id));
      const reconciled = shopping.map((i) =>
        localDoneIds.has(i.id) && !i.done ? { ...i, done: true } : i,
      );
      return {
        ...s,
        tasks,
        recipes,
        shopping: [...reconciled, ...inProgress],
        purchases,
        tins,
        logs: [],
      };
    });
  }, []);

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
      if (document.visibilityState === "visible") void syncFromBackend();
    };
    document.addEventListener("visibilitychange", onReturnToApp);
    window.addEventListener("focus", onReturnToApp);
    return () => {
      window.removeEventListener("homesync:queue", onQueue);
      window.removeEventListener("homesync:auth", onAuth);
      document.removeEventListener("visibilitychange", onReturnToApp);
      window.removeEventListener("focus", onReturnToApp);
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

  const value = useMemo<StoreValue>(
    () => ({
      ...state,
      hydrated,
      pendingSync,
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
        haptic();
        setState((s) => {
          const baseOrder = Math.max(0, ...s.shopping.map((i) => i.sort_order)) + 1;
          const created: ShoppingItem[] = items.map((i, index) => ({
            ...i,
            id: crypto.randomUUID(),
            done: false,
            created_at: new Date().toISOString(),
            sort_order: baseOrder + index,
          }));
          enqueue("POST", "/shopping-items/batch", { items: created });
          return { ...s, shopping: [...s.shopping, ...created] };
        });
      },
      toggleShoppingItem: (id) => {
        haptic();
        setState((s) => {
          // Move the toggled item to the end of its new group (not just a
          // resort into wherever its old sort_order happens to place it) —
          // otherwise unchecking an item snaps it back to its old spot in
          // the pending list instead of landing at the bottom.
          const nextOrder = Math.max(0, ...s.shopping.map((i) => i.sort_order)) + 1;
          enqueue("PATCH", `/shopping-items/${id}/toggle`);
          enqueue("PATCH", `/shopping-items/${id}`, { sort_order: nextOrder });
          return {
            ...s,
            shopping: s.shopping.map((i) =>
              i.id === id ? { ...i, done: !i.done, sort_order: nextOrder } : i,
            ),
          };
        });
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
      completePurchase: async ({ store, total, category, lines, purchased_at }) => {
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
        await flushQueue();
      },
      categorizeShoppingItems: async () => {
        const result = await apiCategorizeShoppingItems();
        if (!result.ok) return false;
        setState((s) => ({ ...s, shopping: result.items }));
        return true;
      },
      daysSincePurchase,
      addRecipe: (recipe) => {
        const created: Recipe = { ...recipe, id: crypto.randomUUID() };
        setState((s) => ({ ...s, recipes: [created, ...s.recipes] }));
        enqueue("POST", "/recipes", created);
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
    [state, hydrated, pendingSync, haptic, daysSincePurchase],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useHomeSync() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useHomeSync must be used inside HomeSyncProvider");
  return ctx;
}
