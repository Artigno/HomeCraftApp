import { useState } from "react";
import { Sparkles, Wand2 } from "lucide-react";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { IconPicker } from "@/components/IconPicker";
import { useHomeSync } from "@/lib/store";
import type { AccentColor } from "@/lib/api/types";
import { toast } from "sonner";

/** Lightweight on-device schema suggestion (mirrors POST /api/ai/task-schema). */
function suggestSchema(prompt: string): {
  frequency_days: number;
  icon: string;
  color: AccentColor;
  optionalField: string;
} {
  const p = prompt.toLowerCase();
  const rules: Array<[RegExp, number, string, AccentColor, string]> = [
    [/królik|klatka|chomik|kot|pies|zwierz/, 4, "Rabbit", "violet", "Rodzaj ściółki"],
    [/ekspres|kawa|odkamien/, 14, "Coffee", "amber", "Środek do odkamieniania"],
    [/filtr|wentyl|hvac|klimat/, 90, "Fan", "blue", "Rozmiar filtra"],
    [/roślin|kwiat|podlew|ogród/, 3, "Sprout", "green", "Ilość wody"],
    [/pościel|pranie|ręcznik/, 21, "WashingMachine", "teal", "Program prania"],
    [/auto|samoch|olej|opon/, 180, "Car", "red", "Przebieg"],
    [/lodów|piekarn|kuchni/, 30, "Refrigerator", "teal", "Użyty środek"],
    [/zęb|lek|wizyt|zdrow/, 180, "Stethoscope", "blue", "Notatka"],
  ];
  for (const [re, days, icon, color, field] of rules) {
    if (re.test(p)) return { frequency_days: days, icon, color, optionalField: field };
  }
  return { frequency_days: 30, icon: "Sparkles", color: "blue", optionalField: "Notatka" };
}

export function TaskWizard({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { addTask } = useHomeSync();
  const [step, setStep] = useState<1 | 2>(1);
  const [prompt, setPrompt] = useState("");
  const [icon, setIcon] = useState("Sparkles");
  const [color, setColor] = useState<AccentColor>("blue");
  const [frequency, setFrequency] = useState(30);
  const [optionalField, setOptionalField] = useState("Notatka");

  function analyze() {
    if (!prompt.trim()) return;
    const s = suggestSchema(prompt);
    setIcon(s.icon);
    setColor(s.color);
    setFrequency(s.frequency_days);
    setOptionalField(s.optionalField);
    setStep(2);
  }

  function reset() {
    setStep(1);
    setPrompt("");
    setIcon("Sparkles");
    setColor("blue");
    setFrequency(30);
  }

  function save() {
    addTask({ name: prompt.trim(), icon, color, frequency_days: frequency, note: optionalField });
    toast.success("Dodano zadanie", { description: `${prompt} · co ${frequency} dni` });
    onOpenChange(false);
    reset();
  }

  return (
    <Drawer
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) reset();
      }}
    >
      <DrawerContent className="mx-auto max-w-lg">
        <DrawerHeader className="text-left">
          <DrawerTitle className="flex items-center gap-2 text-xl">
            <Wand2 className="size-5 text-[var(--accent-violet)]" />
            {step === 1 ? "Co chcesz śledzić?" : "Propozycja konfiguracji"}
          </DrawerTitle>
          <DrawerDescription>
            {step === 1
              ? "Jedno zdanie wystarczy — resztę ustawimy automatycznie."
              : "Sprawdź, popraw jednym tapnięciem i zapisz."}
          </DrawerDescription>
        </DrawerHeader>

        <div className="space-y-4 px-4 pb-6">
          {step === 1 ? (
            <>
              <Input
                autoFocus
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && analyze()}
                placeholder="np. Czyszczenie klatki królika"
                className="h-12 rounded-xl text-base"
              />
              <div className="flex flex-wrap gap-2">
                {["Odkamienianie ekspresu", "Klatka królika", "Filtr HVAC", "Pranie pościeli"].map(
                  (s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setPrompt(s)}
                      className="rounded-full bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground active:scale-95"
                    >
                      {s}
                    </button>
                  ),
                )}
              </div>
              <Button className="h-12 w-full rounded-xl text-base" onClick={analyze}>
                <Sparkles className="size-4" /> Zaproponuj konfigurację
              </Button>
            </>
          ) : (
            <>
              <div className="rounded-2xl bg-muted/70 p-3 text-sm">
                <p className="font-semibold">{prompt}</p>
                <p className="text-muted-foreground">
                  Pola: Data ostatniego wykonania + opcjonalnie „{optionalField}”
                </p>
              </div>

              <div>
                <p className="mb-2 text-sm font-medium">Częstotliwość</p>
                <div className="flex flex-wrap gap-2">
                  {[2, 3, 4, 7, 14, 21, 30, 90, 180].map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setFrequency(d)}
                      className={
                        "min-w-14 rounded-xl px-3 py-2 text-sm font-semibold transition-transform active:scale-95 " +
                        (frequency === d
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground")
                      }
                    >
                      {d} dni
                    </button>
                  ))}
                </div>
              </div>

              <IconPicker value={icon} color={color} onChange={setIcon} onColorChange={setColor} />

              <div className="flex gap-2">
                <Button variant="secondary" className="h-12 flex-1 rounded-xl" onClick={() => setStep(1)}>
                  Wstecz
                </Button>
                <Button className="h-12 flex-[2] rounded-xl text-base" onClick={save}>
                  Zapisz zadanie
                </Button>
              </div>
            </>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
