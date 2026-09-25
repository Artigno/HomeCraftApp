import type { AccentColor, TaskStatus } from "./api/types";

export function accentBg(color: AccentColor) {
  switch (color) {
    case "green":
      return "bg-[var(--accent-green)]";
    case "amber":
      return "bg-[var(--accent-amber)]";
    case "red":
      return "bg-[var(--accent-red)]";
    case "blue":
      return "bg-[var(--accent-blue)]";
    case "violet":
      return "bg-[var(--accent-violet)]";
    case "teal":
      return "bg-[var(--accent-teal)]";
  }
}

export function accentText(color: AccentColor) {
  switch (color) {
    case "green":
      return "text-[var(--accent-green)]";
    case "amber":
      return "text-[var(--accent-amber)]";
    case "red":
      return "text-[var(--accent-red)]";
    case "blue":
      return "text-[var(--accent-blue)]";
    case "violet":
      return "text-[var(--accent-violet)]";
    case "teal":
      return "text-[var(--accent-teal)]";
  }
}

export function statusStyles(status: TaskStatus) {
  switch (status) {
    case "good":
      return {
        ring: "ring-[var(--status-good)]/25",
        dot: "bg-[var(--status-good)]",
        text: "text-[var(--status-good)]",
        chip: "bg-[var(--status-good)]/12 text-[var(--status-good)]",
        label: "Świeże",
      };
    case "warning":
      return {
        ring: "ring-[var(--status-warning)]/35",
        dot: "bg-[var(--status-warning)]",
        text: "text-[var(--status-warning)]",
        chip: "bg-[var(--status-warning)]/14 text-[var(--status-warning)]",
        label: "Wkrótce",
      };
    case "overdue":
      return {
        ring: "ring-[var(--status-overdue)]/40",
        dot: "bg-[var(--status-overdue)]",
        text: "text-[var(--status-overdue)]",
        chip: "bg-[var(--status-overdue)]/14 text-[var(--status-overdue)]",
        label: "Zaległe",
      };
  }
}
