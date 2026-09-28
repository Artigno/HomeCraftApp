import { Link, createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { ChevronLeft, CircleDashed, Plus, Ruler, Square, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useHomeSync } from "@/lib/store";
import type { Tin, TinShape } from "@/lib/api/types";

export const Route = createFileRoute("/cookbook/tins")({
  head: () => ({
    meta: [
      { title: "Moje blaszki — HomeSync" },
      { name: "description", content: "Wymiary blaszek i foremek, które masz w domu." },
    ],
  }),
  component: TinsPage,
});

function describeTin(tin: Tin): string {
  if (tin.shape === "round") return tin.diameter_cm ? `⌀ ${tin.diameter_cm} cm` : "okrągła";
  const size = [tin.width_cm, tin.length_cm].filter(Boolean).join(" × ");
  return size ? `${size} cm` : "prostokątna";
}

function TinsPage() {
  const { tins, addTin, removeTin } = useHomeSync();
  const [open, setOpen] = useState(false);

  return (
    <div>
      <div className="sticky top-0 z-30 flex items-center gap-2 bg-background/85 px-2 pt-safe pb-2 backdrop-blur-xl">
        <Link
          to="/cookbook"
          className="flex size-10 items-center justify-center rounded-full text-foreground active:scale-90"
        >
          <ChevronLeft className="size-6" />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">Moje blaszki</p>
          <p className="text-xs text-muted-foreground">
            {tins.length ? `${tins.length} w Twojej kuchni` : "Dodaj swoją pierwszą blaszkę"}
          </p>
        </div>
        <Button size="icon" className="size-10 shrink-0 rounded-full" onClick={() => setOpen(true)}>
          <Plus className="size-5" />
        </Button>
      </div>

      {tins.length === 0 ? (
        <div className="px-4 pt-8 text-center text-sm text-muted-foreground">
          Brak zapisanych blaszek. Dodaj wymiary, żeby przepisy mogły się do nich odwoływać.
        </div>
      ) : (
        <ul className="space-y-2 px-4 pt-3 pb-8">
          {tins.map((tin) => (
            <li
              key={tin.id}
              className="card-soft flex items-center gap-3 rounded-2xl bg-card px-4 py-3 ring-1 ring-border/60"
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                {tin.shape === "round" ? (
                  <CircleDashed className="size-5" />
                ) : (
                  <Square className="size-5" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-medium">{tin.name}</span>
                <span className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                  <Ruler className="size-3" />
                  {describeTin(tin)}
                  {tin.height_cm ? ` · wys. ${tin.height_cm} cm` : ""}
                </span>
              </span>
              <button
                type="button"
                onClick={() => removeTin(tin.id)}
                aria-label="Usuń blaszkę"
                className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground active:scale-90"
              >
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <AddTinSheet open={open} onOpenChange={setOpen} onAdd={addTin} />
    </div>
  );
}

function AddTinSheet({
  open,
  onOpenChange,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (tin: Omit<Tin, "id">) => void;
}) {
  const [name, setName] = useState("");
  const [shape, setShape] = useState<TinShape>("round");
  const [diameter, setDiameter] = useState("");
  const [width, setWidth] = useState("");
  const [length, setLength] = useState("");
  const [height, setHeight] = useState("");

  if (!open) return null;

  function reset() {
    setName("");
    setShape("round");
    setDiameter("");
    setWidth("");
    setLength("");
    setHeight("");
  }

  function submit() {
    if (!name.trim()) return;
    if (shape === "round" && !diameter) return;
    if (shape === "rectangular" && (!width || !length)) return;

    onAdd({
      name: name.trim(),
      shape,
      ...(shape === "round" ? { diameter_cm: Number(diameter) } : {}),
      ...(shape === "rectangular" ? { width_cm: Number(width), length_cm: Number(length) } : {}),
      ...(height ? { height_cm: Number(height) } : {}),
    });
    reset();
    onOpenChange(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" role="dialog">
      <div className="w-full max-w-lg rounded-t-3xl bg-card p-5 pb-safe">
        <h2 className="text-lg font-semibold">Nowa blaszka</h2>

        <div className="mt-4 flex flex-col gap-3">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nazwa (np. Tortownica)"
            className="h-11 rounded-xl"
          />

          <Select value={shape} onValueChange={(v) => setShape(v as TinShape)}>
            <SelectTrigger className="h-11 rounded-xl">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="round">Okrągła</SelectItem>
              <SelectItem value="rectangular">Prostokątna</SelectItem>
            </SelectContent>
          </Select>

          {shape === "round" ? (
            <Input
              type="number"
              inputMode="decimal"
              value={diameter}
              onChange={(e) => setDiameter(e.target.value)}
              placeholder="Średnica (cm)"
              className="h-11 rounded-xl"
            />
          ) : (
            <div className="flex gap-3">
              <Input
                type="number"
                inputMode="decimal"
                value={width}
                onChange={(e) => setWidth(e.target.value)}
                placeholder="Szerokość (cm)"
                className="h-11 rounded-xl"
              />
              <Input
                type="number"
                inputMode="decimal"
                value={length}
                onChange={(e) => setLength(e.target.value)}
                placeholder="Długość (cm)"
                className="h-11 rounded-xl"
              />
            </div>
          )}

          <Input
            type="number"
            inputMode="decimal"
            value={height}
            onChange={(e) => setHeight(e.target.value)}
            placeholder="Wysokość (cm, opcjonalnie)"
            className="h-11 rounded-xl"
          />
        </div>

        <div className="mt-5 flex gap-2">
          <Button
            variant="outline"
            className="h-12 flex-1 rounded-xl"
            onClick={() => onOpenChange(false)}
          >
            Anuluj
          </Button>
          <Button className="h-12 flex-1 rounded-xl" onClick={submit}>
            Zapisz
          </Button>
        </div>
      </div>
    </div>
  );
}
