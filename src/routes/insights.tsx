import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { pl } from "date-fns/locale";
import { X } from "lucide-react";
import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { PageHeader } from "@/components/PageHeader";
import { groupByField, groupByMonth } from "@/lib/analytics";
import { apiGetPurchases, type PurchaseFilters } from "@/lib/api/client";
import type { Purchase } from "@/lib/api/types";
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

const EMPTY_FILTERS: PurchaseFilters = { store: "", category: "", from: "", to: "", product: "" };

function Insights() {
  const { purchases } = useHomeSync();
  const [groupBy, setGroupBy] = useState<"store" | "category">("store");
  const [filters, setFilters] = useState<PurchaseFilters>(EMPTY_FILTERS);
  const [filtered, setFiltered] = useState<Purchase[] | null>(null);
  const hasActiveFilter = Object.values(filters).some((v) => v);

  const storeOptions = useMemo(
    () => [...new Set(purchases.map((p) => p.store))].sort(),
    [purchases],
  );
  const categoryOptions = useMemo(
    () => [...new Set(purchases.map((p) => p.category))].sort(),
    [purchases],
  );

  // Debounced — only hit the backend once the user pauses typing, and only
  // when some filter is actually set; otherwise reuse the already-synced
  // local list instead of an extra request for the common no-filter case.
  useEffect(() => {
    if (!hasActiveFilter) {
      setFiltered(null);
      return;
    }
    const timer = setTimeout(() => {
      void apiGetPurchases(filters).then((result) => {
        if (result !== null) setFiltered(result);
      });
    }, 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.store, filters.category, filters.from, filters.to, filters.product]);

  const activePurchases = hasActiveFilter && filtered !== null ? filtered : purchases;

  const donutData = useMemo(
    () => groupByField(activePurchases, groupBy),
    [activePurchases, groupBy],
  );
  const monthlyData = useMemo(() => groupByMonth(activePurchases), [activePurchases]);
  const recent = useMemo(
    () =>
      [...activePurchases].sort(
        (a, b) => new Date(b.purchased_at).getTime() - new Date(a.purchased_at).getTime(),
      ),
    [activePurchases],
  );

  return (
    <div className="pb-28">
      <PageHeader title="Budżet" subtitle="Analiza wydatków na zakupy" />

      <div className="px-4">
        {purchases.length === 0 ? (
          <p className="pt-8 text-center text-sm text-muted-foreground">Brak zakupów do analizy.</p>
        ) : (
          <>
            <div className="mt-3 space-y-2 rounded-3xl bg-card p-3 card-soft">
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  list="insights-store-options"
                  placeholder="Sklep"
                  value={filters.store}
                  onChange={(e) => setFilters((f) => ({ ...f, store: e.target.value }))}
                  className="rounded-xl border border-input bg-background px-3 py-2 text-sm"
                />
                <datalist id="insights-store-options">
                  {storeOptions.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
                <input
                  type="text"
                  list="insights-category-options"
                  placeholder="Kategoria"
                  value={filters.category}
                  onChange={(e) => setFilters((f) => ({ ...f, category: e.target.value }))}
                  className="rounded-xl border border-input bg-background px-3 py-2 text-sm"
                />
                <datalist id="insights-category-options">
                  {categoryOptions.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
                <input
                  type="date"
                  value={filters.from}
                  onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))}
                  className="rounded-xl border border-input bg-background px-3 py-2 text-sm"
                />
                <input
                  type="date"
                  value={filters.to}
                  onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))}
                  className="rounded-xl border border-input bg-background px-3 py-2 text-sm"
                />
              </div>
              <input
                type="text"
                placeholder="Szukaj produktu…"
                value={filters.product}
                onChange={(e) => setFilters((f) => ({ ...f, product: e.target.value }))}
                className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
              />
              {hasActiveFilter && (
                <button
                  type="button"
                  onClick={() => setFilters(EMPTY_FILTERS)}
                  className="flex items-center gap-1 text-xs font-medium text-muted-foreground"
                >
                  <X className="size-3.5" /> Wyczyść filtry
                </button>
              )}
            </div>

            {activePurchases.length === 0 ? (
              <p className="pt-8 text-center text-sm text-muted-foreground">
                Brak zakupów dla tych filtrów.
              </p>
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
                        groupBy === key
                          ? "bg-card text-foreground shadow-sm"
                          : "text-muted-foreground",
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
          </>
        )}
      </div>
    </div>
  );
}
