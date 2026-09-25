import { Link, createFileRoute, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { ChevronLeft, Clock, ListPlus, TriangleAlert, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useHomeSync } from "@/lib/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/cookbook/$recipeId")({
  head: () => ({
    meta: [
      { title: "Przepis — HomeSync" },
      { name: "description", content: "Składniki, kroki i dodawanie brakujących rzeczy do listy." },
      { property: "og:title", content: "Przepis — HomeSync" },
      { property: "og:description", content: "Składniki i kroki przepisu w HomeSync." },
    ],
  }),
  component: RecipeDetail,
});

function RecipeDetail() {
  const { recipeId } = useParams({ from: "/cookbook/$recipeId" });
  const { recipes, shopping, addShoppingItems, daysSincePurchase } = useHomeSync();
  const recipe = recipes.find((r) => r.id === recipeId);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);

  if (!recipe) {
    return (
      <div className="px-4 pt-16 text-center">
        <p className="text-muted-foreground">Nie znaleziono przepisu.</p>
        <Link to="/cookbook" className="mt-4 inline-block text-primary underline">
          Wróć do przepisów
        </Link>
      </div>
    );
  }

  const onList = new Set(shopping.map((i) => i.name.toLowerCase()));

  function openPicker() {
    const missing = recipe!.ingredients
      .filter((i) => !onList.has(i.name.toLowerCase()))
      .map((i) => i.name);
    setSelected(missing);
    setOpen(true);
  }

  function confirmAdd() {
    const items = recipe!.ingredients
      .filter((i) => selected.includes(i.name))
      .map((i) => ({
        name: i.name,
        amount: i.amount,
        recipe_title: recipe!.title,
        recent_purchase_days: daysSincePurchase(i.name),
        warning_dismissed: false,
      }));
    addShoppingItems(items);
    setOpen(false);
    toast.success(`Dodano ${items.length} składników`, { description: recipe!.title });
  }

  return (
    <div>
      <div className="sticky top-0 z-30 flex items-center gap-2 bg-background/85 px-2 pt-safe pb-2 backdrop-blur-xl">
        <Link
          to="/cookbook"
          className="flex size-10 items-center justify-center rounded-full text-foreground active:scale-90"
        >
          <ChevronLeft className="size-6" />
        </Link>
        <p className="font-semibold">{recipe.title}</p>
      </div>

      <div className="px-4">
        <div className="card-soft flex items-center gap-4 rounded-3xl bg-card p-5">
          <span className="text-5xl">{recipe.emoji}</span>
          <div>
            <h1 className="text-xl font-bold leading-tight">{recipe.title}</h1>
            <div className="mt-1 flex gap-3 text-sm text-muted-foreground">
              <span className="flex items-center gap-1">
                <Clock className="size-4" />
                {recipe.prep_minutes} min
              </span>
              <span className="flex items-center gap-1">
                <Users className="size-4" />
                {recipe.servings} porcje
              </span>
            </div>
          </div>
        </div>

        <h2 className="mt-6 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Składniki
        </h2>
        <ul className="mt-2 divide-y divide-border overflow-hidden rounded-3xl bg-card card-soft">
          {recipe.ingredients.map((i) => {
            const bought = daysSincePurchase(i.name);
            return (
              <li key={i.name} className="flex items-center justify-between px-4 py-3">
                <span className="text-[15px]">{i.name}</span>
                <span className="flex items-center gap-2">
                  {bought !== undefined && bought <= 7 && (
                    <span className="rounded-full bg-[var(--status-warning)]/14 px-2 py-0.5 text-[11px] font-semibold text-[var(--status-warning)]">
                      kupiono {bought} dni temu
                    </span>
                  )}
                  <span className="text-sm text-muted-foreground">{i.amount}</span>
                </span>
              </li>
            );
          })}
        </ul>

        <h2 className="mt-6 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Przygotowanie
        </h2>
        <ol className="mt-2 space-y-2">
          {recipe.steps.map((s, idx) => (
            <li key={s} className="card-soft flex gap-3 rounded-2xl bg-card p-4">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                {idx + 1}
              </span>
              <p className="text-[15px] leading-snug">{s}</p>
            </li>
          ))}
        </ol>

        <Button className="mt-6 h-14 w-full rounded-2xl text-base" onClick={openPicker}>
          <ListPlus className="size-5" /> Dodaj brakujące składniki do listy
        </Button>
        <div className="h-8" />
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md rounded-3xl">
          <DialogHeader className="text-left">
            <DialogTitle>Brakujące składniki</DialogTitle>
            <DialogDescription>
              Odznacz to, co masz w domu. Ostrzegamy o niedawno kupionych produktach.
            </DialogDescription>
          </DialogHeader>

          <ul className="max-h-72 space-y-1 overflow-y-auto">
            {recipe.ingredients.map((i) => {
              const already = onList.has(i.name.toLowerCase());
              const bought = daysSincePurchase(i.name);
              const checked = selected.includes(i.name);
              return (
                <li key={i.name}>
                  <label
                    className={cn(
                      "flex items-center gap-3 rounded-2xl px-3 py-3 transition-colors",
                      checked ? "bg-muted" : "bg-transparent",
                    )}
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(v) =>
                        setSelected((s) =>
                          v ? [...s, i.name] : s.filter((n) => n !== i.name),
                        )
                      }
                    />
                    <span className="flex-1">
                      <span className="block text-[15px] font-medium">{i.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        {already ? "już na liście" : i.amount}
                      </span>
                    </span>
                    {bought !== undefined && bought <= 7 && (
                      <span className="flex items-center gap-1 rounded-full bg-[var(--status-warning)]/14 px-2 py-1 text-[11px] font-semibold text-[var(--status-warning)]">
                        <TriangleAlert className="size-3" />
                        {bought} dni
                      </span>
                    )}
                  </label>
                </li>
              );
            })}
          </ul>

          <Button className="h-12 rounded-xl text-base" onClick={confirmAdd} disabled={!selected.length}>
            Dodaj {selected.length} do listy zakupów
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
