import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Check, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { TaskWizard } from "@/components/TaskWizard";
import { Button } from "@/components/ui/button";
import { getIcon } from "@/lib/icons";
import { accentBg, statusStyles } from "@/lib/accent";
import { cn } from "@/lib/utils";
import { daysBetween, taskStatus, useHomeSync } from "@/lib/store";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "HomeSync — konserwacja domu" },
      {
        name: "description",
        content:
          "Kolorowe kafelki zadań domowych z jednym tapnięciem: odkamienianie, filtry, zwierzaki i rośliny.",
      },
      { property: "og:title", content: "HomeSync — konserwacja domu" },
      {
        property: "og:description",
        content: "Wszystkie zadania domowe na jednym ekranie, logowane jednym tapnięciem.",
      },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const { tasks, logTask, removeTask } = useHomeSync();
  const [wizardOpen, setWizardOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);

  const sorted = useMemo(
    () =>
      [...tasks].sort(
        (a, b) =>
          daysBetween(a.last_done_at) / a.frequency_days -
          daysBetween(b.last_done_at) / b.frequency_days,
      ),
    [tasks],
  ).reverse();

  const overdue = sorted.filter((t) => taskStatus(t) === "overdue").length;

  return (
    <div>
      <PageHeader
        title="Dom"
        subtitle={
          overdue > 0 ? `${overdue} zadania po terminie` : "Wszystko pod kontrolą — nic zaległego"
        }
        action={
          <div className="flex gap-2 pt-1">
            <Button
              variant={editMode ? "default" : "secondary"}
              size="sm"
              className="rounded-full"
              onClick={() => setEditMode((v) => !v)}
            >
              {editMode ? "Gotowe" : "Edytuj"}
            </Button>
            <Button size="icon" className="size-9 rounded-full" onClick={() => setWizardOpen(true)}>
              <Plus className="size-5" />
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-3 px-4 pt-1">
        {sorted.map((task) => {
          const status = taskStatus(task);
          const s = statusStyles(status);
          const Icon = getIcon(task.icon);
          const days = daysBetween(task.last_done_at);
          const progress = Math.min(days / task.frequency_days, 1);

          return (
            <button
              key={task.id}
              type="button"
              onClick={() => {
                if (editMode) return;
                logTask(task.id);
                toast.success("Zapisano wykonanie", { description: task.name });
              }}
              className={cn(
                "card-soft relative flex min-h-36 flex-col justify-between rounded-3xl bg-card p-4 text-left ring-1 transition-transform active:scale-[0.97]",
                s.ring,
              )}
            >
              {editMode && (
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    removeTask(task.id);
                  }}
                  className="absolute -right-1.5 -top-1.5 flex size-7 items-center justify-center rounded-full bg-[var(--accent-red)] text-white"
                >
                  <Trash2 className="size-3.5" />
                </span>
              )}
              <div className="flex items-start justify-between">
                <span
                  className={cn(
                    "flex size-11 items-center justify-center rounded-2xl text-white",
                    accentBg(task.color),
                  )}
                >
                  <Icon className="size-5" />
                </span>
                <span className={cn("rounded-full px-2 py-1 text-[11px] font-semibold", s.chip)}>
                  {s.label}
                </span>
              </div>

              <div>
                <p className="text-[15px] font-semibold leading-tight">{task.name}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {days === 0 ? "dzisiaj" : `${days} dni temu`} · co {task.frequency_days} dni
                </p>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn("h-full rounded-full", s.dot)}
                    style={{ width: `${Math.max(progress * 100, 6)}%` }}
                  />
                </div>
              </div>
            </button>
          );
        })}

        <button
          type="button"
          onClick={() => setWizardOpen(true)}
          className="flex min-h-36 flex-col items-center justify-center gap-2 rounded-3xl border-2 border-dashed border-border text-muted-foreground transition-transform active:scale-[0.97]"
        >
          <Plus className="size-6" />
          <span className="text-sm font-medium">Nowe zadanie</span>
        </button>
      </div>

      <p className="flex items-center justify-center gap-1.5 px-4 py-6 text-xs text-muted-foreground">
        <Check className="size-3.5" /> Tapnij kafelek, aby zalogować wykonanie
      </p>

      <TaskWizard open={wizardOpen} onOpenChange={setWizardOpen} />
    </div>
  );
}
