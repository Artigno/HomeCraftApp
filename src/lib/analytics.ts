import { format } from "date-fns";
import { pl } from "date-fns/locale";
import type { Purchase } from "./api/types";

export function groupByField(
  purchases: Purchase[],
  field: "store" | "category",
): Array<{ name: string; value: number }> {
  const totals = new Map<string, number>();
  for (const p of purchases) {
    const key = p[field];
    totals.set(key, (totals.get(key) ?? 0) + p.total);
  }
  return Array.from(totals, ([name, value]) => ({ name, value: Math.round(value * 100) / 100 }));
}

export function groupByMonth(purchases: Purchase[]): Array<{ month: string; total: number }> {
  const totals = new Map<string, number>();
  for (const p of purchases) {
    const key = format(new Date(p.purchased_at), "yyyy-MM");
    totals.set(key, (totals.get(key) ?? 0) + p.total);
  }
  return Array.from(totals, ([key, total]) => ({
    month: format(new Date(`${key}-01`), "LLL yyyy", { locale: pl }),
    total: Math.round(total * 100) / 100,
    sortKey: key,
  }))
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey))
    .map(({ month, total }) => ({ month, total }));
}
