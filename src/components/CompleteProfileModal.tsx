import { useState } from "react";
import type { FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useHomeSync } from "@/lib/store";

export function CompleteProfileModal() {
  const { profileGateOpen, resolveProfileGate, cancelProfileGate } = useHomeSync();
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setPending(true);
    try {
      const res = await resolveProfileGate(trimmed);
      if (res.ok) {
        setName("");
      } else {
        toast.error("Nie udało się zapisać imienia — spróbuj ponownie.");
      }
    } catch {
      toast.error("Brak połączenia z serwerem — spróbuj ponownie.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={profileGateOpen} onOpenChange={(open) => !open && cancelProfileGate()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Jak masz na imię?</DialogTitle>
          <DialogDescription>
            Zanim coś dodasz lub zmienisz, ustaw swoje imię — inni domownicy zobaczą je w historii
            aktywności.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <Input
            placeholder="Imię"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
          />
          <Button type="submit" disabled={pending || !name.trim()}>
            Zapisz
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
