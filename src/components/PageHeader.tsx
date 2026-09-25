import type { ReactNode } from "react";
import { CloudOff, RefreshCw } from "lucide-react";
import { useHomeSync } from "@/lib/store";

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  const { pendingSync } = useHomeSync();

  return (
    <header className="sticky top-0 z-30 bg-background/85 px-4 pt-safe pb-3 backdrop-blur-xl">
      <div className="flex items-start justify-between gap-3 pt-2">
        <div>
          <h1 className="text-[28px] font-bold leading-tight tracking-tight">{title}</h1>
          {subtitle && <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>}
        </div>
        {action}
      </div>
      {pendingSync > 0 && (
        <div className="mt-3 flex items-center gap-2 rounded-xl bg-[var(--status-warning)]/12 px-3 py-2 text-xs font-medium text-[var(--status-warning)]">
          <CloudOff className="size-3.5" />
          {pendingSync} zmian czeka na synchronizację z serwerem
          <RefreshCw className="ml-auto size-3.5 animate-spin" />
        </div>
      )}
    </header>
  );
}
