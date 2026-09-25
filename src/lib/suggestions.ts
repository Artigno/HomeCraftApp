import type { Purchase, ShoppingItem } from "./api/types";

/**
 * At most one suggestion at a time (the most overdue), per spec — keeps the
 * banner non-intrusive rather than listing every repeat-buy candidate.
 */
export function computeSuggestion(
  purchases: Purchase[],
  shopping: ShoppingItem[],
  dismissed: string[],
): string | undefined {
  const onListNotDone = new Set(
    shopping.filter((i) => !i.done).map((i) => i.name.trim().toLowerCase()),
  );
  const dismissedSet = new Set(dismissed.map((n) => n.trim().toLowerCase()));

  const purchasesByName = new Map<string, { originalName: string; timestamps: number[] }>();
  for (const purchase of purchases) {
    const purchasedAt = new Date(purchase.purchased_at).getTime();
    for (const line of purchase.lines) {
      const key = line.name.trim().toLowerCase();
      const entry = purchasesByName.get(key) ?? { originalName: line.name, timestamps: [] };
      entry.timestamps.push(purchasedAt);
      purchasesByName.set(key, entry);
    }
  }

  let best: { name: string; overdueBy: number } | undefined;

  for (const [key, { originalName, timestamps }] of purchasesByName) {
    if (timestamps.length < 2) continue;
    if (onListNotDone.has(key) || dismissedSet.has(key)) continue;

    const sorted = [...timestamps].sort((a, b) => a - b);
    const intervals = sorted.slice(1).map((t, i) => (t - sorted[i]!) / 86_400_000);
    const averageInterval = intervals.reduce((sum, d) => sum + d, 0) / intervals.length;

    const daysSinceLast = (Date.now() - sorted[sorted.length - 1]!) / 86_400_000;
    if (daysSinceLast < averageInterval) continue;

    const overdueBy = daysSinceLast - averageInterval;
    if (!best || overdueBy > best.overdueBy) {
      best = { name: originalName, overdueBy };
    }
  }

  return best?.name;
}
