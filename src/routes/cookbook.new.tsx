import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ChevronLeft, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useHomeSync } from "@/lib/store";

export const Route = createFileRoute("/cookbook/new")({
  head: () => ({
    meta: [{ title: "Nowy przepis — HomeSync" }],
  }),
  component: NewRecipePage,
});

interface IngredientRow {
  name: string;
  amount: string;
}

function NewRecipePage() {
  const { tins, addRecipe } = useHomeSync();
  const navigate = useNavigate();

  const [title, setTitle] = useState("");
  const [emoji, setEmoji] = useState("🍽️");
  const [tags, setTags] = useState("");
  const [prepMinutes, setPrepMinutes] = useState("30");
  const [servings, setServings] = useState("2");
  const [tinId, setTinId] = useState<string>("none");
  const [ingredients, setIngredients] = useState<IngredientRow[]>([{ name: "", amount: "" }]);
  const [steps, setSteps] = useState<string[]>([""]);

  function updateIngredient(index: number, field: keyof IngredientRow, value: string) {
    setIngredients((rows) => rows.map((r, i) => (i === index ? { ...r, [field]: value } : r)));
  }

  function updateStep(index: number, value: string) {
    setSteps((rows) => rows.map((s, i) => (i === index ? value : s)));
  }

  function submit() {
    if (!title.trim()) {
      toast.error("Podaj nazwę przepisu");
      return;
    }
    const cleanIngredients = ingredients
      .map((i) => ({ name: i.name.trim(), amount: i.amount.trim() }))
      .filter((i) => i.name);
    const cleanSteps = steps.map((s) => s.trim()).filter(Boolean);
    const cleanTags = tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    addRecipe({
      title: title.trim(),
      emoji: emoji.trim() || "🍽️",
      tags: cleanTags,
      prep_minutes: Number(prepMinutes) || 0,
      servings: Number(servings) || 1,
      ingredients: cleanIngredients,
      steps: cleanSteps,
      ...(tinId !== "none" ? { tin_id: tinId } : {}),
    });

    toast.success("Przepis dodany", { description: title.trim() });
    void navigate({ to: "/cookbook" });
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
        <p className="font-semibold">Nowy przepis</p>
      </div>

      <div className="flex flex-col gap-4 px-4 pb-28 pt-3">
        <div className="flex gap-3">
          <Input
            value={emoji}
            onChange={(e) => setEmoji(e.target.value)}
            placeholder="🍽️"
            className="h-11 w-16 rounded-xl text-center text-xl"
            maxLength={4}
          />
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Nazwa przepisu"
            className="h-11 flex-1 rounded-xl"
          />
        </div>

        <Input
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          placeholder="Tagi (po przecinku, np. Obiad, Szybkie)"
          className="h-11 rounded-xl"
        />

        <div className="flex gap-3">
          <Input
            type="number"
            inputMode="numeric"
            value={prepMinutes}
            onChange={(e) => setPrepMinutes(e.target.value)}
            placeholder="Czas (min)"
            className="h-11 rounded-xl"
          />
          <Input
            type="number"
            inputMode="numeric"
            value={servings}
            onChange={(e) => setServings(e.target.value)}
            placeholder="Porcje"
            className="h-11 rounded-xl"
          />
        </div>

        {tins.length > 0 && (
          <Select value={tinId} onValueChange={setTinId}>
            <SelectTrigger className="h-11 rounded-xl">
              <SelectValue placeholder="Blaszka (opcjonalnie)" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Bez blaszki</SelectItem>
              {tins.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <div>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Składniki
          </h2>
          <div className="flex flex-col gap-2">
            {ingredients.map((row, i) => (
              <div key={i} className="flex gap-2">
                <Input
                  value={row.name}
                  onChange={(e) => updateIngredient(i, "name", e.target.value)}
                  placeholder="Składnik"
                  className="h-11 flex-1 rounded-xl"
                />
                <Input
                  value={row.amount}
                  onChange={(e) => updateIngredient(i, "amount", e.target.value)}
                  placeholder="Ilość"
                  className="h-11 w-24 rounded-xl"
                />
                <button
                  type="button"
                  onClick={() => setIngredients((rows) => rows.filter((_, idx) => idx !== i))}
                  aria-label="Usuń składnik"
                  className="flex size-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground active:scale-90"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))}
          </div>
          <Button
            variant="outline"
            className="mt-2 h-10 w-full rounded-xl"
            onClick={() => setIngredients((rows) => [...rows, { name: "", amount: "" }])}
          >
            <Plus className="size-4" /> Dodaj składnik
          </Button>
        </div>

        <div>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Przygotowanie
          </h2>
          <div className="flex flex-col gap-2">
            {steps.map((step, i) => (
              <div key={i} className="flex gap-2">
                <Textarea
                  value={step}
                  onChange={(e) => updateStep(i, e.target.value)}
                  placeholder={`Krok ${i + 1}`}
                  className="min-h-11 flex-1 rounded-xl"
                  rows={2}
                />
                <button
                  type="button"
                  onClick={() => setSteps((rows) => rows.filter((_, idx) => idx !== i))}
                  aria-label="Usuń krok"
                  className="flex size-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground active:scale-90"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))}
          </div>
          <Button
            variant="outline"
            className="mt-2 h-10 w-full rounded-xl"
            onClick={() => setSteps((rows) => [...rows, ""])}
          >
            <Plus className="size-4" /> Dodaj krok
          </Button>
        </div>

        <Button className="mt-2 h-12 w-full rounded-xl text-base" onClick={submit}>
          Zapisz przepis
        </Button>
      </div>
    </div>
  );
}
