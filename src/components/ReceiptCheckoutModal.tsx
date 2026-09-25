import { useEffect, useRef, useState } from "react";
import { Camera, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useHomeSync } from "@/lib/store";
import type { ShoppingItem } from "@/lib/api/types";

const DEFAULT_CATEGORY = "Spożywcze";
const ESTIMATE_PER_ITEM = 12;

interface ReceiptCheckoutModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  boughtItems: ShoppingItem[];
}

export function ReceiptCheckoutModal({
  open,
  onOpenChange,
  boughtItems,
}: ReceiptCheckoutModalProps) {
  const { purchases, completePurchase } = useHomeSync();
  const [step, setStep] = useState<"capture" | "processing" | "form">("capture");
  const [store, setStore] = useState("");
  const [total, setTotal] = useState("");
  const [category, setCategory] = useState(DEFAULT_CATEGORY);
  const processingTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (!open) return;
    setStep("capture");
    setStore(purchases[0]?.store ?? "");
    setTotal(String(Math.round(boughtItems.length * ESTIMATE_PER_ITEM * 100) / 100));
    setCategory(purchases[0]?.category ?? DEFAULT_CATEGORY);
  }, [open, purchases, boughtItems.length]);

  useEffect(() => {
    if (open) return;
    clearTimeout(processingTimeout.current);
  }, [open]);

  useEffect(() => () => clearTimeout(processingTimeout.current), []);

  function startProcessing() {
    setStep("processing");
    processingTimeout.current = setTimeout(() => setStep("form"), 1200);
  }

  function handleConfirm() {
    const parsedTotal = Number(total);
    completePurchase({
      store: store.trim() || "Sklep",
      total: Number.isFinite(parsedTotal) ? parsedTotal : 0,
      category: category.trim() || DEFAULT_CATEGORY,
    });
    toast.success("Zakupy zapisane", { description: `${boughtItems.length} produktów` });
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-3xl">
        <DialogHeader className="text-left">
          <DialogTitle>Zakończ zakupy</DialogTitle>
          <DialogDescription>
            Dodaj zdjęcie paragonu lub pomiń je, a następnie potwierdź sklep, sumę i kategorię.
          </DialogDescription>
        </DialogHeader>

        {step === "capture" && (
          <div className="space-y-3">
            <label className="flex h-40 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border text-center text-muted-foreground">
              <Camera className="size-8" />
              <span className="text-sm font-medium">Zrób zdjęcie / Dodaj paragon</span>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={startProcessing}
              />
            </label>
            <Button variant="ghost" className="h-11 w-full rounded-xl" onClick={startProcessing}>
              Pomiń zdjęcie
            </Button>
          </div>
        )}

        {step === "processing" && (
          <div className="flex h-40 flex-col items-center justify-center gap-3 text-muted-foreground">
            <Loader2 className="size-8 animate-spin" />
            <p className="text-sm font-medium">Analizujemy paragon…</p>
          </div>
        )}

        {step === "form" && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="checkout-store">Sklep</Label>
              <Input
                id="checkout-store"
                value={store}
                onChange={(e) => setStore(e.target.value)}
                className="h-11 rounded-xl"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="checkout-total">Suma (zł)</Label>
              <Input
                id="checkout-total"
                type="number"
                inputMode="decimal"
                value={total}
                onChange={(e) => setTotal(e.target.value)}
                className="h-11 rounded-xl"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="checkout-category">Kategoria</Label>
              <Input
                id="checkout-category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="h-11 rounded-xl"
              />
            </div>
            <Button className="h-12 w-full rounded-xl text-base" onClick={handleConfirm}>
              Zapisz zakupy
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
