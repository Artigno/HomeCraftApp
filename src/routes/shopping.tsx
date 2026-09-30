import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { Check, Plus, Trash2, X } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { ReceiptCheckoutModal } from "@/components/ReceiptCheckoutModal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSwipeToDelete } from "@/hooks/use-swipe-to-delete";
import { computeSuggestion } from "@/lib/suggestions";
import { cn } from "@/lib/utils";
import { useHomeSync } from "@/lib/store";
import type { ShoppingItem } from "@/lib/api/types";

export const Route = createFileRoute("/shopping")({
  head: () => ({
    meta: [
      { title: "Zakupy — HomeSync" },
      { name: "description", content: "Lista zakupów z szybkim dodawaniem i ostrzeżeniami." },
      { property: "og:title", content: "Zakupy — HomeSync" },
      { property: "og:description", content: "Szybka lista zakupów dla domu." },
    ],
  }),
  component: ShoppingList,
});

function ShoppingList() {
  const {
    shopping,
    purchases,
    dismissed_suggestions,
    addShoppingItems,
    daysSincePurchase,
    dismissSuggestion,
  } = useHomeSync();
  const [checkoutOpen, setCheckoutOpen] = useState(false);

  const sorted = useMemo(
    () =>
      [...shopping].sort((a, b) => Number(a.done) - Number(b.done) || a.sort_order - b.sort_order),
    [shopping],
  );

  // Freeze the rendered order briefly after a toggle so a fast second tap
  // lands on the item the user is looking at, not one that just slid up to
  // take its place — the toggle itself still applies instantly (checkbox
  // state), only the visual reflow is delayed.
  const [frozenOrder, setFrozenOrder] = useState<string[] | null>(null);
  const freezeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  function freezeOrderBriefly() {
    if (frozenOrder === null) {
      setFrozenOrder(sorted.map((i) => i.id));
    }
    if (freezeTimer.current) clearTimeout(freezeTimer.current);
    freezeTimer.current = setTimeout(() => setFrozenOrder(null), 300);
  }

  const displayOrder = useMemo(() => {
    if (!frozenOrder) return sorted;
    const byId = new Map(shopping.map((i) => [i.id, i]));
    return frozenOrder.map((id) => byId.get(id)).filter((i): i is ShoppingItem => i !== undefined);
  }, [frozenOrder, sorted, shopping]);

  const pending = shopping.filter((i) => !i.done).length;

  const suggestion = useMemo(
    () => computeSuggestion(purchases, shopping, dismissed_suggestions),
    [purchases, shopping, dismissed_suggestions],
  );

  function addByName(rawName: string) {
    const trimmed = rawName.trim();
    if (!trimmed) return;
    const recentDays = daysSincePurchase(trimmed);
    addShoppingItems([
      {
        name: trimmed,
        warning_dismissed: false,
        ...(recentDays !== undefined ? { recent_purchase_days: recentDays } : {}),
      },
    ]);
  }

  return (
    <div>
      <PageHeader
        title="Zakupy"
        subtitle={pending > 0 ? `${pending} rzeczy do kupienia` : "Lista jest pusta"}
      />

      {suggestion && (
        <div className="mx-4 mt-3 flex items-center justify-between gap-3 rounded-2xl bg-muted px-4 py-3">
          <p className="text-sm font-medium">Kończy się {suggestion}? Dodaj do listy</p>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              size="sm"
              className="h-8 rounded-full px-3"
              onClick={() => addByName(suggestion)}
            >
              Dodaj
            </Button>
            <button
              type="button"
              onClick={() => dismissSuggestion(suggestion)}
              aria-label="Odrzuć sugestię"
              className="flex size-8 items-center justify-center rounded-full text-muted-foreground active:scale-90"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>
      )}

      <ul className="space-y-2 px-4 pb-3 pt-3">
        {displayOrder.map((item) => (
          <ShoppingListRow key={item.id} item={item} onToggleFreeze={freezeOrderBriefly} />
        ))}
        <AddItemRow onAdd={addByName} />
      </ul>

      {shopping.length > 0 && (
        <div className="px-4 pb-3">
          <Button
            className="h-12 w-full rounded-xl text-base"
            disabled={!shopping.some((i) => i.done)}
            onClick={() => setCheckoutOpen(true)}
          >
            Zakończ zakupy
          </Button>
        </div>
      )}

      <ReceiptCheckoutModal
        open={checkoutOpen}
        onOpenChange={setCheckoutOpen}
        boughtItems={shopping.filter((i) => i.done)}
      />
    </div>
  );
}

function AddItemRow({ onAdd }: { onAdd: (name: string) => void }) {
  const [active, setActive] = useState(false);
  const [draft, setDraft] = useState("");

  function commit() {
    const trimmed = draft.trim();
    if (!trimmed) return;
    onAdd(trimmed);
    setDraft("");
  }

  if (!active) {
    return (
      <li>
        <button
          type="button"
          onClick={() => setActive(true)}
          className="flex w-full items-center gap-3 rounded-2xl border-2 border-dashed border-border px-4 py-3 text-left text-muted-foreground transition-transform active:scale-[0.98]"
        >
          <Plus className="size-5" />
          <span className="text-[15px] font-medium">Dodaj produkt</span>
        </button>
      </li>
    );
  }

  return (
    <li>
      <Input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
        }}
        onBlur={() => {
          if (!draft.trim()) setActive(false);
        }}
        placeholder="Nazwa produktu"
        className="h-[52px] rounded-2xl px-4 text-[15px]"
      />
    </li>
  );
}

function ShoppingListRow({
  item,
  onToggleFreeze,
}: {
  item: ShoppingItem;
  onToggleFreeze: () => void;
}) {
  const { toggleShoppingItem, removeShoppingItem, dismissWarning, updateShoppingItem } =
    useHomeSync();
  const { bind, style, isRevealed, reset, consumeDragFlag } = useSwipeToDelete({
    onDelete: () => removeShoppingItem(item.id),
  });
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(item.name);

  const showWarning =
    item.recent_purchase_days !== undefined &&
    item.recent_purchase_days <= 7 &&
    !item.warning_dismissed;

  /** Shared guard for the checkbox/label tap targets: a swipe-drag or an
   * already-revealed delete action should never also trigger toggle/edit. */
  function guardedTap(): boolean {
    if (consumeDragFlag()) return false;
    if (isRevealed) {
      reset();
      return false;
    }
    return true;
  }

  function startEdit() {
    if (!guardedTap()) return;
    setDraftName(item.name);
    setEditing(true);
  }

  function commitEdit() {
    const trimmed = draftName.trim();
    if (trimmed && trimmed !== item.name) {
      updateShoppingItem(item.id, { name: trimmed });
    }
    setEditing(false);
  }

  return (
    <li className="relative overflow-hidden rounded-2xl">
      <div className="absolute inset-y-0 right-0 flex w-16 items-center justify-center rounded-2xl bg-[var(--accent-red)] text-white">
        <button
          type="button"
          onClick={() => removeShoppingItem(item.id)}
          aria-label="Usuń produkt"
          className="flex size-full items-center justify-center"
        >
          <Trash2 className="size-5" />
        </button>
      </div>

      <div
        {...bind}
        style={style}
        className="card-soft relative flex w-full items-center gap-3 rounded-2xl bg-card px-4 py-3 text-left ring-1 ring-border/60 transition-transform active:scale-[0.98]"
      >
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => {
            if (guardedTap()) {
              onToggleFreeze();
              toggleShoppingItem(item.id);
            }
          }}
          aria-label={item.done ? "Odznacz produkt" : "Zaznacz produkt"}
          className="-m-2 flex shrink-0 items-center justify-center p-2"
        >
          <span
            className={cn(
              "flex size-5 items-center justify-center rounded-full border-2",
              item.done ? "border-primary bg-primary" : "border-muted-foreground/40",
            )}
          />
        </button>
        <span className="min-w-0 flex-1">
          {editing ? (
            <Input
              autoFocus
              onPointerDown={(e) => e.stopPropagation()}
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitEdit();
                } else if (e.key === "Escape") {
                  setEditing(false);
                }
              }}
              onBlur={commitEdit}
              className="h-8 rounded-lg px-2 text-[15px]"
            />
          ) : (
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={startEdit}
              className="block w-full text-left"
            >
              <span
                className={cn(
                  "block text-[15px] font-medium",
                  item.done && "text-muted-foreground line-through",
                )}
              >
                {item.name}
                {item.amount && (
                  <span className="ml-1.5 text-sm text-muted-foreground">{item.amount}</span>
                )}
              </span>
            </button>
          )}
          {item.recipe_title && (
            <span className="mt-1 inline-block rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              Przepis: {item.recipe_title}
            </span>
          )}
        </span>

        {showWarning && (
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-[var(--status-warning)]/14 px-2 py-1 text-[11px] font-semibold text-[var(--status-warning)]">
            kupiono {item.recent_purchase_days} dni temu
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                removeShoppingItem(item.id);
              }}
              aria-label="Usuń produkt"
              className="flex size-4 items-center justify-center"
            >
              <Trash2 className="size-3" />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                dismissWarning(item.id);
              }}
              className="flex items-center gap-0.5"
            >
              <Check className="size-3" /> Zatwierdź
            </button>
          </span>
        )}
      </div>
    </li>
  );
}
