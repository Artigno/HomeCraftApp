import { useEffect, useState } from "react";
import { format } from "date-fns";
import { pl } from "date-fns/locale";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiGetPurchases, apiGetShoppingItems, apiPatchPurchaseLine } from "@/lib/api/client";
import type { Purchase, ShoppingItem } from "@/lib/api/types";

const UNLINKED = "__unlinked__";

export function PurchaseDetailModal({
  purchase,
  open,
  onOpenChange,
}: {
  purchase: Purchase | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [fresh, setFresh] = useState<Purchase | null>(null);
  const [shoppingItems, setShoppingItems] = useState<ShoppingItem[]>([]);

  // receipt_image_url is a temporary S3 URL (10-minute TTL) — the copy
  // already held from the list fetch may be stale by the time the user taps
  // a row, so re-fetch on open instead of trusting it.
  useEffect(() => {
    if (!open || !purchase) {
      setFresh(null);
      return;
    }
    void apiGetPurchases({}).then((result) => {
      setFresh(result?.find((p) => p.id === purchase.id) ?? null);
    });
    // The picker's source list of current shopping items — reuses the same
    // endpoint that backs the shopping-list screen, per the backend handoff
    // (no dedicated "pick a product" endpoint exists).
    void apiGetShoppingItems().then((result) => {
      setShoppingItems(result?.ok ? result.items : []);
    });
  }, [open, purchase]);

  const display = fresh ?? purchase;
  if (!display) return null;

  function relink(lineId: number | undefined, value: string) {
    if (lineId === undefined || !display) return;
    const shoppingItemId = value === UNLINKED ? null : value;
    const previous = display.lines.find((l) => l.id === lineId);
    const previousShoppingItemId = previous?.shopping_item_id ?? null;
    const previousShoppingItemName = previous?.shopping_item_name ?? null;
    const name = shoppingItems.find((i) => i.id === shoppingItemId)?.name ?? null;

    setFresh((current) => {
      if (!current) return current;
      return {
        ...current,
        lines: current.lines.map((l) =>
          l.id === lineId
            ? { ...l, shopping_item_id: shoppingItemId, shopping_item_name: name }
            : l,
        ),
      };
    });

    void apiPatchPurchaseLine(display.id, lineId, shoppingItemId).then((result) => {
      if (result.ok) return;
      setFresh((current) => {
        if (!current) return current;
        return {
          ...current,
          lines: current.lines.map((l) =>
            l.id === lineId
              ? {
                  ...l,
                  shopping_item_id: previousShoppingItemId,
                  shopping_item_name: previousShoppingItemName,
                }
              : l,
          ),
        };
      });
      toast.error("Nie udało się zapisać powiązania", {
        description:
          result.status === 422 ? "Ten produkt nie należy do Twojego gospodarstwa." : undefined,
      });
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-3xl">
        <DialogHeader className="text-left">
          <DialogTitle>{display.store}</DialogTitle>
          <DialogDescription>
            {format(new Date(display.purchased_at), "d MMMM yyyy", { locale: pl })}
          </DialogDescription>
        </DialogHeader>

        {display.receipt_image_url ? (
          <img
            src={display.receipt_image_url}
            alt="Paragon"
            className="max-h-80 w-full rounded-2xl object-contain"
          />
        ) : (
          <p className="text-sm text-muted-foreground">Brak zdjęcia paragonu.</p>
        )}

        <ul className="mt-2 divide-y divide-border">
          {display.lines.map((line, i) => (
            <li key={line.id ?? i} className="flex flex-col gap-1.5 py-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="min-w-0 flex-1 truncate">{line.name}</span>
                <span className="shrink-0 font-medium">{line.price.toFixed(2)} zł</span>
              </div>
              {line.qty !== undefined && line.unit_price !== undefined && line.qty !== 1 && (
                <span className="text-xs text-muted-foreground">
                  {line.qty} × {line.unit_price.toFixed(2)} zł
                </span>
              )}
              <Select
                value={line.shopping_item_id ?? UNLINKED}
                onValueChange={(value) => relink(line.id, value)}
              >
                <SelectTrigger className="h-8 w-full rounded-lg text-xs">
                  <SelectValue placeholder="Niepowiązane" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNLINKED}>Niepowiązane</SelectItem>
                  {shoppingItems.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </li>
          ))}
        </ul>

        {display.lines.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Zmiana dotyczy tylko przyszłych paragonów — nie wpływa na ten zakup.
          </p>
        )}

        <div className="flex items-center justify-between border-t border-border pt-3 text-sm font-semibold">
          <span>Suma</span>
          <span>{display.total.toFixed(2)} zł</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
