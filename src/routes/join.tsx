import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiAuth } from "@/lib/api/client";
import { setAuthToken, setProfileComplete } from "@/lib/auth";

export const Route = createFileRoute("/join")({
  head: () => ({ meta: [{ title: "Dołącz do domu — HomeSync" }] }),
  component: JoinPage,
});

function JoinPage() {
  const navigate = useNavigate();
  const [shareCode, setShareCode] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    try {
      const res = await apiAuth<{ token: string }>("/join", {
        share_code: shareCode,
        email,
        password,
      });
      if (res.ok) {
        setAuthToken(res.data.token);
        setProfileComplete(false);
        void navigate({ to: "/", replace: true });
        return;
      }
      if (res.status === 429) {
        toast.error("Zbyt wiele prób — spróbuj ponownie za chwilę.");
      } else {
        toast.error("Nieprawidłowy lub już wykorzystany kod zaproszenia.");
      }
    } catch {
      toast.error("Brak połączenia z serwerem — spróbuj ponownie.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col justify-center px-6 pb-24 pt-safe">
      <div className="mx-auto w-full max-w-sm">
        <h1 className="text-2xl font-bold tracking-tight">Dołącz do domu</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Wpisz kod zaproszenia, który dostałeś/aś od właściciela konta.
        </p>

        <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-3">
          <Input
            placeholder="Kod zaproszenia"
            value={shareCode}
            onChange={(e) => setShareCode(e.target.value)}
            required
          />
          <Input
            type="email"
            placeholder="E-mail"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <Input
            type="password"
            placeholder="Hasło"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
          />
          <Button type="submit" disabled={pending}>
            Dołącz
          </Button>
        </form>
      </div>
    </div>
  );
}
