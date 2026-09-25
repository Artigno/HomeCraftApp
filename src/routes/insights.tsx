import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { format } from "date-fns";
import { pl } from "date-fns/locale";
import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { PageHeader } from "@/components/PageHeader";
import { groupByField, groupByMonth } from "@/lib/analytics";
import { useHomeSync } from "@/lib/store";
import { cn } from "@/lib/utils";

const CHART_COLORS = [
  "var(--accent-green)",
  "var(--accent-amber)",
  "var(--accent-red)",
  "var(--accent-blue)",
  "var(--accent-violet)",
  "var(--accent-teal)",
];

export const Route = createFileRoute("/insights")({
  head: () => ({
    meta: [
      { title: "Budżet — HomeSync" },
      { name: "description", content: "Analiza wydatków na zakupy." },
      { property: "og:title", content: "Budżet — HomeSync" },
      { property: "og:description", content: "Analiza wydatków na zakupy." },
    ],
  }),
  component: Insights,
});

function Insights() {
  const { purchases } = useHomeSync();
  const [groupBy, setGroupBy] = useState<"store" | "category">("store");

  const donutData = useMemo(() => groupByField(purchases, groupBy), [purchases, groupBy]);
  const monthlyData = useMemo(() => groupByMonth(purchases), [purchases]);
  const recent = useMemo(
    () =>
      [...purchases].sort(
        (a, b) => new Date(b.purchased_at).getTime() - new Date(a.purchased_at).getTime(),
      ),
    [purchases],
  );

  return (
    <div className="pb-28">
      <PageHeader title="Budżet" subtitle="Analiza wydatków na zakupy" />

      <div className="px-4">
        {purchases.length === 0 ? (
          <p className="pt-8 text-center text-sm text-muted-foreground">Brak zakupów do analizy.</p>
        ) : (
          <>
            <div className="mt-3 flex items-center justify-center gap-1 rounded-full bg-muted p-1">
              {(["store", "category"] as const).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setGroupBy(key)}
                  className={cn(
                    "flex-1 rounded-full py-2 text-sm font-medium transition-colors",
                    groupBy === key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground",
                  )}
                >
                  {key === "store" ? "Sklep" : "Kategoria"}
                </button>
              ))}
            </div>

            <div className="card-soft mt-4 rounded-3xl bg-card p-4">
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={donutData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={60}
                    outerRadius={90}
                    paddingAngle={2}
                  >
                    {donutData.map((entry, i) => (
                      <Cell key={entry.name} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value: number) => `${value.toFixed(2)} zł`} />
                </PieChart>
              </ResponsiveContainer>
              <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5">
                {donutData.map((entry, i) => (
                  <li key={entry.name} className="flex items-center gap-2 text-sm">
                    <span
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ background: CHART_COLORS[i % CHART_COLORS.length] }}
                    />
                    <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                    <span className="shrink-0 text-muted-foreground">
                      {entry.value.toFixed(2)} zł
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <h2 className="mt-6 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Wydatki miesięczne
            </h2>
            <div className="card-soft mt-2 rounded-3xl bg-card p-4">
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={monthlyData}>
                  <XAxis
                    dataKey="month"
                    tickLine={false}
                    axisLine={false}
                    fontSize={12}
                    stroke="var(--muted-foreground)"
                  />
                  <Tooltip formatter={(value: number) => `${value.toFixed(2)} zł`} />
                  <Bar dataKey="total" fill="var(--accent-blue)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <h2 className="mt-6 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Ostatnie zakupy
            </h2>
            <ul className="mt-2 divide-y divide-border overflow-hidden rounded-3xl bg-card card-soft">
              {recent.map((p) => (
                <li key={p.id} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <p className="text-[15px] font-medium">{p.store}</p>
                    <p className="text-xs text-muted-foreground">
                      {format(new Date(p.purchased_at), "d MMMM yyyy", { locale: pl })}
                    </p>
                  </div>
                  <span className="text-[15px] font-semibold">{p.total.toFixed(2)} zł</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
