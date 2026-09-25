import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
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
  const [name, setName] = useState("");
  const [checkoutOpen, setCheckoutOpen] = useState(false);

  const sorted = useMemo(
    () => [...shopping].sort((a, b) => Number(a.done) - Number(b.done)),
    [shopping],
  );

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

  function handleQuickAdd() {
    addByName(name);
    setName("");
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

      <ul className={cn("space-y-2 px-4 pt-3", shopping.length > 0 ? "pb-3" : "pb-28")}>
        {sorted.map((item) => (
          <ShoppingListRow key={item.id} item={item} />
        ))}
      </ul>

      {shopping.length > 0 && (
        <div className="px-4 pb-28">
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

      <div className="fixed inset-x-0 bottom-16 z-30 mx-auto flex max-w-lg items-center gap-2 border-t border-border/70 bg-card/90 px-4 py-3 backdrop-blur-xl">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleQuickAdd();
          }}
          placeholder="Dodaj produkt..."
          className="h-11 flex-1 rounded-xl"
        />
        <Button size="icon" className="size-11 shrink-0 rounded-xl" onClick={handleQuickAdd}>
          <Plus className="size-5" />
        </Button>
      </div>
    </div>
  );
}

function ShoppingListRow({ item }: { item: ShoppingItem }) {
  const { toggleShoppingItem, removeShoppingItem, dismissWarning } = useHomeSync();
  const { bind, style, isRevealed, reset, consumeDragFlag } = useSwipeToDelete({
    onDelete: () => removeShoppingItem(item.id),
  });

  const showWarning =
    item.recent_purchase_days !== undefined &&
    item.recent_purchase_days <= 7 &&
    !item.warning_dismissed;

  function handleRowClick() {
    if (consumeDragFlag()) return;
    if (isRevealed) {
      reset();
      return;
    }
    toggleShoppingItem(item.id);
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
        role="button"
        tabIndex={0}
        onClick={handleRowClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") handleRowClick();
        }}
        {...bind}
        style={style}
        className="card-soft relative flex w-full items-center gap-3 rounded-2xl bg-card px-4 py-3 text-left ring-1 ring-border/60 transition-transform active:scale-[0.98]"
      >
        <span
          className={cn(
            "flex size-5 shrink-0 items-center justify-center rounded-full border-2",
            item.done ? "border-primary bg-primary" : "border-muted-foreground/40",
          )}
        />
        <span className="min-w-0 flex-1">
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
