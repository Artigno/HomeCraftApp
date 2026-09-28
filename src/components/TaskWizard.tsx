import { useEffect, useState } from "react";
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
import { cn } from "@/lib/utils";
import type { AccentColor, MaintenanceTask } from "@/lib/api/types";
import { toast } from "sonner";

const FREQUENCY_PRESETS = [2, 3, 4, 7, 14, 21, 30, 90, 180, 365];

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

export function TaskWizard({
  open,
  onOpenChange,
  editingTask,
  editMode = "details",
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** When set, the drawer opens straight into the edit screen for this task. */
  editingTask?: MaintenanceTask | null;
  /** "date" shows only the last-done date picker — a smaller sheet for the
   * common "forgot to tap yesterday" fix, split out so the full edit sheet
   * (name/frequency/icon) stays short enough to fit on screen. */
  editMode?: "details" | "date";
}) {
  const { addTask, updateTask } = useHomeSync();
  const isEditing = !!editingTask;
  const [step, setStep] = useState<1 | 2>(isEditing ? 2 : 1);
  const [prompt, setPrompt] = useState("");
  const [icon, setIcon] = useState("Sparkles");
  const [color, setColor] = useState<AccentColor>("blue");
  const [frequency, setFrequency] = useState(30);
  const [customFrequency, setCustomFrequency] = useState("");
  const [optionalField, setOptionalField] = useState("Notatka");
  const [lastDoneDate, setLastDoneDate] = useState("");

  useEffect(() => {
    if (!open) return;
    if (editingTask) {
      setStep(2);
      setPrompt(editingTask.name);
      setIcon(editingTask.icon);
      setColor(editingTask.color);
      setFrequency(editingTask.frequency_days);
      setOptionalField(editingTask.note ?? "Notatka");
      setLastDoneDate(editingTask.last_done_at.slice(0, 10));
    } else {
      setStep(1);
    }
  }, [open, editingTask]);

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
    setCustomFrequency("");
  }

  function saveDate() {
    if (!editingTask) return;
    // Keep the original time-of-day, only the calendar date is user-editable
    // here — good enough since status/progress are computed in whole days.
    const originalTime = editingTask.last_done_at.slice(10);
    updateTask(editingTask.id, {
      last_done_at: lastDoneDate
        ? new Date(`${lastDoneDate}${originalTime}`).toISOString()
        : editingTask.last_done_at,
    });
    toast.success("Zaktualizowano datę wykonania", { description: editingTask.name });
    onOpenChange(false);
    reset();
  }

  function save() {
    if (isEditing && editMode === "date") return saveDate();
    if (!prompt.trim()) return;
    if (isEditing) {
      updateTask(editingTask.id, {
        name: prompt.trim(),
        icon,
        color,
        frequency_days: frequency,
        note: optionalField,
      });
      toast.success("Zaktualizowano zadanie", { description: `${prompt} · co ${frequency} dni` });
    } else {
      addTask({ name: prompt.trim(), icon, color, frequency_days: frequency, note: optionalField });
      toast.success("Dodano zadanie", { description: `${prompt} · co ${frequency} dni` });
    }
    onOpenChange(false);
    reset();
  }

  const isDateOnly = isEditing && editMode === "date";

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
            {isDateOnly
              ? "Popraw datę wykonania"
              : isEditing
                ? "Edytuj zadanie"
                : step === 1
                  ? "Co chcesz śledzić?"
                  : "Propozycja konfiguracji"}
          </DrawerTitle>
          <DrawerDescription>
            {isDateOnly
              ? editingTask?.name
              : isEditing
                ? "Popraw nazwę, częstotliwość albo wygląd kafelka."
                : step === 1
                  ? "Jedno zdanie wystarczy — resztę ustawimy automatycznie."
                  : "Sprawdź, popraw jednym tapnięciem i zapisz."}
          </DrawerDescription>
        </DrawerHeader>

        <div className="space-y-4 px-4 pb-6">
          {isDateOnly ? (
            <>
              <Input
                autoFocus
                type="date"
                value={lastDoneDate}
                max={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setLastDoneDate(e.target.value)}
                className="h-12 rounded-xl text-base"
              />
              <Button className="h-12 w-full rounded-xl text-base" onClick={save}>
                Zapisz datę
              </Button>
            </>
          ) : step === 1 ? (
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
              {isEditing ? (
                <Input
                  autoFocus
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="Nazwa zadania"
                  className="h-12 rounded-xl text-base"
                />
              ) : (
                <div className="rounded-2xl bg-muted/70 p-3 text-sm">
                  <p className="font-semibold">{prompt}</p>
                  <p className="text-muted-foreground">
                    Pola: Data ostatniego wykonania + opcjonalnie „{optionalField}”
                  </p>
                </div>
              )}

              <div>
                <p className="mb-2 text-sm font-medium">Częstotliwość</p>
                <div className="flex flex-wrap gap-2">
                  {FREQUENCY_PRESETS.map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => {
                        setFrequency(d);
                        setCustomFrequency("");
                      }}
                      className={
                        "min-w-14 rounded-xl px-3 py-2 text-sm font-semibold transition-transform active:scale-95 " +
                        (frequency === d && !customFrequency
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground")
                      }
                    >
                      {d} dni
                    </button>
                  ))}
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    value={customFrequency}
                    onChange={(e) => {
                      setCustomFrequency(e.target.value);
                      const n = Number(e.target.value);
                      if (n > 0) setFrequency(n);
                    }}
                    placeholder="Inna liczba dni (np. 365)"
                    className="h-11 rounded-xl"
                  />
                </div>
              </div>

              <IconPicker value={icon} color={color} onChange={setIcon} onColorChange={setColor} />

              <div className="flex gap-2">
                {!isEditing && (
                  <Button
                    variant="secondary"
                    className="h-12 flex-1 rounded-xl"
                    onClick={() => setStep(1)}
                  >
                    Wstecz
                  </Button>
                )}
                <Button
                  className={cn("h-12 rounded-xl text-base", isEditing ? "w-full" : "flex-[2]")}
                  onClick={save}
                >
                  {isEditing ? "Zapisz zmiany" : "Zapisz zadanie"}
                </Button>
              </div>
            </>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
