import { useEffect, useState } from "react";
import { format } from "date-fns";
import { pl } from "date-fns/locale";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiGetPurchases } from "@/lib/api/client";
import type { Purchase } from "@/lib/api/types";

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
  }, [open, purchase]);

  const display = fresh ?? purchase;
  if (!display) return null;

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
            <li key={i} className="flex items-center justify-between py-2 text-sm">
              <span className="min-w-0 flex-1 truncate">{line.name}</span>
              <span className="shrink-0 font-medium">{line.price.toFixed(2)} zł</span>
            </li>
          ))}
        </ul>

        <div className="flex items-center justify-between border-t border-border pt-3 text-sm font-semibold">
          <span>Suma</span>
          <span>{display.total.toFixed(2)} zł</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
