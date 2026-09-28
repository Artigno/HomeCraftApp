import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Check, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { TaskWizard } from "@/components/TaskWizard";
import { Button } from "@/components/ui/button";
import { getIcon } from "@/lib/icons";
import { accentBg, statusStyles } from "@/lib/accent";
import { cn } from "@/lib/utils";
import { daysBetween, taskStatus, useHomeSync } from "@/lib/store";
import { useLongPress } from "@/hooks/use-long-press";
import type { MaintenanceTask } from "@/lib/api/types";

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
  const [editingTask, setEditingTask] = useState<MaintenanceTask | null>(null);
  const [actionsTask, setActionsTask] = useState<MaintenanceTask | null>(null);

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
        {sorted.map((task) => (
          <TaskTile
            key={task.id}
            task={task}
            editMode={editMode}
            onRemove={() => removeTask(task.id)}
            onOpenActions={() => setActionsTask(task)}
          />
        ))}

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
        <Check className="size-3.5" /> Tapnij kafelek, aby zalogować wykonanie · przytrzymaj, aby
        edytować
      </p>

      <TaskWizard
        open={wizardOpen || !!editingTask}
        onOpenChange={(o) => {
          setWizardOpen(o);
          if (!o) setEditingTask(null);
        }}
        editingTask={editingTask}
      />

      {actionsTask && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40"
          role="dialog"
          onClick={() => setActionsTask(null)}
        >
          <div
            className="w-full max-w-lg rounded-t-3xl bg-card p-3 pb-safe"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="px-3 py-2 text-sm font-semibold text-muted-foreground">
              {actionsTask.name}
            </p>
            <button
              type="button"
              onClick={() => {
                setEditingTask(actionsTask);
                setActionsTask(null);
              }}
              className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left text-[15px] active:bg-muted"
            >
              <Pencil className="size-5" /> Edytuj
            </button>
            <button
              type="button"
              onClick={() => {
                removeTask(actionsTask.id);
                setActionsTask(null);
              }}
              className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left text-[15px] text-destructive active:bg-muted"
            >
              <Trash2 className="size-5" /> Usuń
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function TaskTile({
  task,
  editMode,
  onRemove,
  onOpenActions,
}: {
  task: MaintenanceTask;
  editMode: boolean;
  onRemove: () => void;
  onOpenActions: () => void;
}) {
  const { logTask } = useHomeSync();
  const status = taskStatus(task);
  const s = statusStyles(status);
  const Icon = getIcon(task.icon);
  const days = daysBetween(task.last_done_at);
  const progress = Math.min(days / task.frequency_days, 1);
  const { bind, consumeLongPress } = useLongPress(onOpenActions);

  return (
    <button
      type="button"
      {...bind}
      onClick={() => {
        if (consumeLongPress()) return;
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
            onRemove();
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
}
