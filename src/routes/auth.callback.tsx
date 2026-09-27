import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { setAuthToken } from "@/lib/auth";

const searchSchema = z.object({
  token: z.string().optional(),
  error: z.string().optional(),
});

export const Route = createFileRoute("/auth/callback")({
  validateSearch: searchSchema,
  component: AuthCallback,
});

const ERROR_MESSAGES: Record<string, string> = {
  sso_failed: "Logowanie nie powiodło się, spróbuj ponownie.",
  email_conflict: "Konto z tym adresem e-mail już istnieje — zaloguj się hasłem.",
};

function AuthCallback() {
  const { token, error } = Route.useSearch();
  const navigate = useNavigate();
  const [message] = useState(
    error ? (ERROR_MESSAGES[error] ?? "Logowanie nie powiodło się.") : null,
  );

  useEffect(() => {
    if (token) {
      setAuthToken(token);
      void navigate({ to: "/", replace: true });
    }
  }, [token, navigate]);

  if (message) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-sm text-foreground">{message}</p>
        <Link to="/login" className="text-sm text-primary underline-offset-4 hover:underline">
          Powrót do logowania
        </Link>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <p className="text-sm text-muted-foreground">Logowanie…</p>
    </div>
  );
}
