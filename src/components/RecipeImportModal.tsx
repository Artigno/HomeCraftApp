import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Link2, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiGetRecipeImport, apiStartRecipeImport } from "@/lib/api/client";

const POLL_INTERVAL_MS = 2_500;
const MAX_POLL_ATTEMPTS = 48; // ~2 minutes

type ModalState =
  | { step: "idle" }
  | { step: "pending"; id: string }
  | { step: "failed"; message: string }
  | { step: "timed-out" };

export function RecipeImportModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const [url, setUrl] = useState("");
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [state, setState] = useState<ModalState>({ step: "idle" });
  const attemptsRef = useRef(0);

  // Reset to a clean entry surface whenever the modal is (re)opened, and
  // make sure no interval survives a close mid-poll.
  useEffect(() => {
    if (!open) return;
    setUrl("");
    setInlineError(null);
    setState({ step: "idle" });
    attemptsRef.current = 0;
  }, [open]);

  useEffect(() => {
    if (state.step !== "pending") return;
    const importId = state.id;

    const interval = window.setInterval(() => {
      void (async () => {
        attemptsRef.current += 1;
        const result = await apiGetRecipeImport(importId);

        if (!result.ok) {
          // A 404 mid-poll (wrong/expired id) is terminal, same as any other failure.
          setState({ step: "failed", message: "Nie udało się sprawdzić statusu importu." });
          return;
        }

        if (result.data.status === "ready") {
          void navigate({ to: "/cookbook/new", search: { importId } });
          return;
        }

        if (result.data.status === "failed") {
          setState({
            step: "failed",
            message: result.data.error ?? "Import się nie powiódł.",
          });
          return;
        }

        if (attemptsRef.current >= MAX_POLL_ATTEMPTS) {
          setState({ step: "timed-out" });
        }
      })();
    }, POLL_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, [state, navigate]);

  async function submit() {
    const trimmed = url.trim();
    if (!trimmed || !/^https?:\/\//i.test(trimmed)) {
      setInlineError("Podaj poprawny link (zaczynający się od http:// lub https://)");
      return;
    }
    setInlineError(null);

    const result = await apiStartRecipeImport(trimmed);
    if (!result.ok) {
      setInlineError(result.message ?? "Nie udało się rozpocząć importu. Spróbuj ponownie.");
      return;
    }

    attemptsRef.current = 0;
    setState({ step: "pending", id: result.data.id });
  }

  function retry() {
    setState({ step: "idle" });
    setInlineError(null);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-3xl">
        <DialogHeader className="text-left">
          <DialogTitle>Zaimportuj z linku</DialogTitle>
          <DialogDescription>
            Wklej link do TikToka lub aniagotuje.pl — przygotujemy szkic przepisu do sprawdzenia i
            zapisania.
          </DialogDescription>
        </DialogHeader>

        {(state.step === "idle" || state.step === "failed") && (
          <div className="flex flex-col gap-3">
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://..."
              className="h-11 rounded-xl"
              autoFocus
            />
            {inlineError && <p className="text-sm text-destructive">{inlineError}</p>}
            {state.step === "failed" && <p className="text-sm text-destructive">{state.message}</p>}
            <Button className="h-11 rounded-xl" onClick={() => void submit()}>
              {state.step === "failed" ? "Spróbuj ponownie" : "Importuj"}
            </Button>
          </div>
        )}

        {state.step === "pending" && (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <Loader2 className="size-8 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Analizujemy przepis…</p>
          </div>
        )}

        {state.step === "timed-out" && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              To trwa dłużej niż zwykle — spróbuj sprawdzić ponownie za chwilę.
            </p>
            <Button variant="outline" className="h-11 rounded-xl" onClick={retry}>
              <Link2 className="size-4" /> Zacznij od nowa
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
