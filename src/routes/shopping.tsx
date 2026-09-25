import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useHomeSync } from "@/lib/store";

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
  const { shopping, addShoppingItems, toggleShoppingItem, daysSincePurchase } = useHomeSync();
  const [name, setName] = useState("");

  const sorted = useMemo(
    () => [...shopping].sort((a, b) => Number(a.done) - Number(b.done)),
    [shopping],
  );

  const pending = shopping.filter((i) => !i.done).length;

  function handleQuickAdd() {
    const trimmed = name.trim();
    if (!trimmed) return;
    const recentDays = daysSincePurchase(trimmed);
    addShoppingItems([
      {
        name: trimmed,
        warning_dismissed: false,
        ...(recentDays !== undefined ? { recent_purchase_days: recentDays } : {}),
      },
    ]);
    setName("");
  }

  return (
    <div>
      <PageHeader
        title="Zakupy"
        subtitle={pending > 0 ? `${pending} rzeczy do kupienia` : "Lista jest pusta"}
      />

      <ul className="space-y-2 px-4 pt-1 pb-28">
        {sorted.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => toggleShoppingItem(item.id)}
              className="card-soft flex w-full items-center gap-3 rounded-2xl bg-card px-4 py-3 text-left ring-1 ring-border/60 transition-transform active:scale-[0.98]"
            >
              <span
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-full border-2",
                  item.done ? "border-primary bg-primary" : "border-muted-foreground/40",
                )}
              />
              <span className="flex-1">
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
            </button>
          </li>
        ))}
      </ul>

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
