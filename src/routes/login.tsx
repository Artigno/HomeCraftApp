import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiAuth } from "@/lib/api/client";
import { setAuthToken, ssoRedirectUrl } from "@/lib/auth";

const API_BASE =
  (import.meta.env["VITE_API_URL"] as string | undefined) ?? "https://api.homesync.local/api";

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: "Zaloguj się — HomeSync" }] }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    try {
      const path = mode === "login" ? "/login" : "/register";
      const body = mode === "login" ? { email, password } : { name, email, password };
      const res = await apiAuth<{ token: string }>(path, body);
      if (res.ok) {
        setAuthToken(res.data.token);
        void navigate({ to: "/", replace: true });
        return;
      }
      if (res.status === 429) {
        toast.error("Zbyt wiele prób — spróbuj ponownie za chwilę.");
      } else {
        toast.error(
          mode === "login" ? "Nieprawidłowy e-mail lub hasło." : "Nie udało się utworzyć konta.",
        );
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
        <h1 className="text-2xl font-bold tracking-tight">HomeSync</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {mode === "login" ? "Zaloguj się do swojego konta." : "Załóż nowe konto."}
        </p>

        <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-3">
          {mode === "register" && (
            <Input
              placeholder="Imię"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          )}
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
            {mode === "login" ? "Zaloguj się" : "Utwórz konto"}
          </Button>
        </form>

        <button
          type="button"
          onClick={() => setMode((m) => (m === "login" ? "register" : "login"))}
          className="mt-3 w-full text-center text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          {mode === "login" ? "Nie masz konta? Zarejestruj się" : "Masz już konto? Zaloguj się"}
        </button>

        <div className="mt-6 flex items-center gap-3 text-xs text-muted-foreground">
          <div className="h-px flex-1 bg-border" />
          lub
          <div className="h-px flex-1 bg-border" />
        </div>

        <div className="mt-4 flex flex-col gap-2">
          <Button variant="outline" asChild>
            <a href={ssoRedirectUrl("google", API_BASE)}>Kontynuuj z Google</a>
          </Button>
          <Button variant="outline" asChild>
            <a href={ssoRedirectUrl("apple", API_BASE)}>Kontynuuj z Apple</a>
          </Button>
        </div>
      </div>
    </div>
  );
}
