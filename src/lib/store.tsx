import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { enqueue, flushQueue, readQueue } from "./api/client";
import type {
  HomeSyncState,
  MaintenanceTask,
  Purchase,
  Recipe,
  ShoppingItem,
  TaskStatus,
} from "./api/types";
import { createSeedState } from "./seed";

const STORAGE_KEY = "homesync.state.v1";

interface StoreValue extends HomeSyncState {
  hydrated: boolean;
  pendingSync: number;
  logTask: (taskId: string) => void;
  addTask: (task: Omit<MaintenanceTask, "id" | "last_done_at">) => void;
  removeTask: (taskId: string) => void;
  addShoppingItems: (items: Array<Omit<ShoppingItem, "id" | "created_at" | "done">>) => void;
  toggleShoppingItem: (id: string) => void;
  removeShoppingItem: (id: string) => void;
  dismissWarning: (id: string) => void;
  completePurchase: (data: { store: string; total: number; category: string }) => void;
  dismissSuggestion: (name: string) => void;
  daysSincePurchase: (name: string) => number | undefined;
  addRecipe: (recipe: Omit<Recipe, "id">) => void;
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

export function HomeSyncProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<HomeSyncState>(() => createSeedState());
  const [hydrated, setHydrated] = useState(false);
  const [pendingSync, setPendingSync] = useState(0);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) setState(JSON.parse(raw) as HomeSyncState);
    } catch {
      /* corrupt cache -> keep seed */
    }
    setHydrated(true);
    setPendingSync(readQueue().length);
    void flushQueue();
    const onQueue = (e: Event) => setPendingSync((e as CustomEvent<number>).detail);
    window.addEventListener("homesync:queue", onQueue);
    return () => window.removeEventListener("homesync:queue", onQueue);
  }, []);

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
      addShoppingItems: (items) => {
        haptic();
        const created: ShoppingItem[] = items.map((i) => ({
          ...i,
          id: crypto.randomUUID(),
          done: false,
          created_at: new Date().toISOString(),
        }));
        setState((s) => ({ ...s, shopping: [...created, ...s.shopping] }));
        enqueue("POST", "/shopping-items/batch", { items: created });
      },
      toggleShoppingItem: (id) => {
        haptic();
        setState((s) => ({
          ...s,
          shopping: s.shopping.map((i) => (i.id === id ? { ...i, done: !i.done } : i)),
        }));
        enqueue("PATCH", `/shopping-items/${id}/toggle`);
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
      completePurchase: ({ store, total, category }) => {
        haptic(25);
        setState((s) => {
          const bought = s.shopping.filter((i) => i.done);
          const purchase: Purchase = {
            id: crypto.randomUUID(),
            store,
            category,
            total,
            purchased_at: new Date().toISOString(),
            lines: bought.map((i) => ({
              name: i.name,
              price: Math.round((total / Math.max(bought.length, 1)) * 100) / 100,
            })),
          };
          enqueue("POST", "/receipts/process", purchase);
          return {
            ...s,
            shopping: s.shopping.filter((i) => !i.done),
            purchases: [purchase, ...s.purchases],
          };
        });
      },
      dismissSuggestion: (name) =>
        setState((s) => ({ ...s, dismissed_suggestions: [...s.dismissed_suggestions, name] })),
      daysSincePurchase,
      addRecipe: (recipe) => {
        const created: Recipe = { ...recipe, id: crypto.randomUUID() };
        setState((s) => ({ ...s, recipes: [created, ...s.recipes] }));
        enqueue("POST", "/recipes", created);
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
