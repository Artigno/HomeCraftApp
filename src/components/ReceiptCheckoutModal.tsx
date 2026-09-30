import { useEffect, useState } from "react";
import { Camera, Loader2, X } from "lucide-react";
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
import { apiParseReceipt } from "@/lib/api/client";
import type { ReceiptParseLine, ShoppingItem } from "@/lib/api/types";

const DEFAULT_CATEGORY = "Spożywcze";
const ESTIMATE_PER_ITEM = 12;
const GENERIC_PARSE_ERROR = "Nie udało się odczytać paragonu. Wprowadź dane ręcznie.";

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
  const [step, setStep] = useState<"capture" | "processing" | "review" | "form">("capture");
  const [store, setStore] = useState("");
  const [total, setTotal] = useState("");
  const [category, setCategory] = useState(DEFAULT_CATEGORY);
  const [lines, setLines] = useState<ReceiptParseLine[]>([]);
  const [purchasedAt, setPurchasedAt] = useState<string>("");

  useEffect(() => {
    if (!open) return;
    setStep("capture");
    setStore(purchases[0]?.store ?? "");
    setTotal(String(Math.round(boughtItems.length * ESTIMATE_PER_ITEM * 100) / 100));
    setCategory(purchases[0]?.category ?? DEFAULT_CATEGORY);
    setLines([]);
    setPurchasedAt("");
  }, [open, purchases, boughtItems.length]);

  function goToManualForm() {
    setStep("form");
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setStep("processing");
    try {
      const result = await apiParseReceipt(file);
      if (!result.ok) {
        toast.error(result.message ?? GENERIC_PARSE_ERROR);
        goToManualForm();
        return;
      }
      setStore(result.data.store);
      setCategory(result.data.category);
      setTotal(String(result.data.total));
      setLines(result.data.lines);
      setPurchasedAt(result.data.purchased_at);
      setStep("review");
    } catch {
      toast.error(GENERIC_PARSE_ERROR);
      goToManualForm();
    }
  }

  function updateLine(index: number, patch: Partial<ReceiptParseLine>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  function removeLine(index: number) {
    setLines((prev) => prev.filter((_, i) => i !== index));
  }

  function handleConfirmManual() {
    const parsedTotal = Number(total);
    completePurchase({
      store: store.trim() || "Sklep",
      total: Number.isFinite(parsedTotal) ? parsedTotal : 0,
      category: category.trim() || DEFAULT_CATEGORY,
    });
    toast.success("Zakupy zapisane", { description: `${boughtItems.length} produktów` });
    onOpenChange(false);
  }

  function handleConfirmReview() {
    const parsedTotal = Number(total);
    completePurchase({
      store: store.trim() || "Sklep",
      total: Number.isFinite(parsedTotal) ? parsedTotal : 0,
      category: category.trim() || DEFAULT_CATEGORY,
      lines: lines.map((l) => ({
        name: l.name,
        price: l.price,
        shopping_item_id: l.shopping_item_id,
      })),
      purchased_at: purchasedAt,
    });
    toast.success("Zakupy zapisane", { description: `${lines.length} produktów` });
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
                className="hidden"
                onChange={(e) => void handleFileSelected(e)}
              />
            </label>
            <Button variant="ghost" className="h-11 w-full rounded-xl" onClick={goToManualForm}>
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

        {step === "review" && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="review-store">Sklep</Label>
              <Input
                id="review-store"
                value={store}
                onChange={(e) => setStore(e.target.value)}
                className="h-11 rounded-xl"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="review-total">Suma (zł)</Label>
              <Input
                id="review-total"
                type="number"
                inputMode="decimal"
                value={total}
                onChange={(e) => setTotal(e.target.value)}
                className="h-11 rounded-xl"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="review-category">Kategoria</Label>
              <Input
                id="review-category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="h-11 rounded-xl"
              />
            </div>
            <div className="space-y-2">
              <Label>Produkty</Label>
              <div className="space-y-2">
                {lines.map((line, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <Input
                      value={line.name}
                      onChange={(e) => updateLine(index, { name: e.target.value })}
                      className="h-10 flex-1 rounded-xl"
                    />
                    <Input
                      type="number"
                      inputMode="decimal"
                      value={line.price}
                      onChange={(e) => updateLine(index, { price: Number(e.target.value) })}
                      className="h-10 w-24 rounded-xl"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-10 shrink-0 rounded-xl"
                      onClick={() => removeLine(index)}
                    >
                      <X className="size-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
            <Button className="h-12 w-full rounded-xl text-base" onClick={handleConfirmReview}>
              Zapisz zakupy
            </Button>
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
            <Button className="h-12 w-full rounded-xl text-base" onClick={handleConfirmManual}>
              Zapisz zakupy
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
