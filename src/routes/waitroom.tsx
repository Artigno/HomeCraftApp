import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import { apiGet } from "@/lib/api/client";
import type { JoinStatus } from "@/lib/api/types";

const POLL_MS = 4_000;

export const Route = createFileRoute("/waitroom")({
  head: () => ({ meta: [{ title: "Oczekiwanie na zatwierdzenie — HomeSync" }] }),
  component: WaitroomPage,
});

function WaitroomPage() {
  const navigate = useNavigate();
  const stopped = useRef(false);

  useEffect(() => {
    stopped.current = false;

    async function poll() {
      while (!stopped.current) {
        const status = await apiGet<JoinStatus | null>("/household/join-status", null);
        if (status?.approved) {
          void navigate({ to: "/", replace: true });
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      }
    }

    void poll();
    return () => {
      stopped.current = true;
    };
  }, [navigate]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 pb-24 pt-safe text-center">
      <Loader2 className="size-8 animate-spin text-muted-foreground" />
      <div>
        <h1 className="text-xl font-bold tracking-tight">Prawie gotowe</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Czekamy aż ktoś z domowników Cię zatwierdzi.
        </p>
      </div>
    </div>
  );
}
