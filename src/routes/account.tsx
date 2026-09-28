import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Copy, LogOut, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiGet, apiProfile, apiRegenerateShareCode, flushQueue } from "@/lib/api/client";
import { clearAuthToken, getIsOwner, getMyName, setMyName, setProfileComplete } from "@/lib/auth";
import type { ActivityPage, Household } from "@/lib/api/types";

export const Route = createFileRoute("/account")({
  head: () => ({ meta: [{ title: "Konto — HomeSync" }] }),
  component: AccountPage,
});

const ACTION_LABEL: Record<"created" | "updated" | "deleted", string> = {
  created: "dodał(a)",
  updated: "zaktualizował(a)",
  deleted: "usunął/usunęła",
};

function AccountPage() {
  const router = useRouter();
  const [household, setHousehold] = useState<Household | null>(null);
  const [activity, setActivity] = useState<ActivityPage | null>(null);
  const [name, setName] = useState(() => getMyName() ?? "");
  const [savingName, setSavingName] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [canRegenerate, setCanRegenerate] = useState(() => getIsOwner());

  useEffect(() => {
    void apiGet<Household | null>("/household", null).then(setHousehold);
    void apiGet<ActivityPage | null>("/household/activity?page=1", null).then(setActivity);
  }, []);

  async function onSaveName(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setSavingName(true);
    try {
      const res = await apiProfile(trimmed);
      if (res.ok) {
        setProfileComplete(true);
        setMyName(trimmed);
        void flushQueue();
        toast.success("Zapisano imię.");
      } else {
        toast.error("Nie udało się zapisać imienia.");
      }
    } catch {
      toast.error("Brak połączenia z serwerem.");
    } finally {
      setSavingName(false);
    }
  }

  async function onRegenerate() {
    setRegenerating(true);
    try {
      const res = await apiRegenerateShareCode();
      if (res.ok) {
        setHousehold((h) => (h ? { ...h, share_code: res.share_code } : h));
      } else if (res.status === 403) {
        setCanRegenerate(false);
        toast.error("Tylko właściciel domu może wygenerować kod.");
      } else {
        toast.error("Nie udało się wygenerować kodu.");
      }
    } catch {
      toast.error("Brak połączenia z serwerem.");
    } finally {
      setRegenerating(false);
    }
  }

  async function onCopyCode() {
    const code = household?.share_code;
    if (!code) return;
    try {
      if (!navigator.clipboard) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(code);
      toast.success("Skopiowano kod.");
    } catch {
      toast.error("Nie udało się skopiować kodu.");
    }
  }

  async function onLoadMore() {
    if (!activity || activity.meta.current_page >= activity.meta.last_page) return;
    const nextPage = activity.meta.current_page + 1;
    const next = await apiGet<ActivityPage | null>(`/household/activity?page=${nextPage}`, null);
    if (next) {
      setActivity((prev) =>
        prev ? { data: [...prev.data, ...next.data], meta: next.meta } : next,
      );
    }
  }

  function onLogout() {
    clearAuthToken();
    void router.navigate({ to: "/login", replace: true });
  }

  const hasMorePages = activity !== null && activity.meta.current_page < activity.meta.last_page;

  return (
    <div>
      <PageHeader title="Konto" subtitle="Profil, domownicy i historia zmian" />

      <div className="flex flex-col gap-6 px-4 pt-1">
        <section>
          <h2 className="text-sm font-semibold text-muted-foreground">Profil</h2>
          <form onSubmit={onSaveName} className="mt-2 flex gap-2">
            <Input
              placeholder="Imię"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
            <Button type="submit" disabled={savingName || !name.trim()}>
              Zapisz
            </Button>
          </form>
        </section>

        <section>
          <h2 className="text-sm font-semibold text-muted-foreground">Domownicy</h2>
          <ul className="mt-2 flex flex-col gap-2">
            {household?.members.map((m) => (
              <li
                key={m.id}
                className="flex items-center justify-between rounded-2xl border border-border px-3 py-2"
              >
                <span>{m.name ?? "Bez imienia"}</span>
                {m.is_owner && (
                  <span className="text-xs font-medium text-muted-foreground">Właściciel</span>
                )}
              </li>
            ))}
          </ul>

          {household?.share_code && (
            <div className="mt-3 flex items-center gap-2 rounded-2xl border border-border px-3 py-2">
              <code className="flex-1 text-sm font-semibold tracking-wide">
                {household.share_code}
              </code>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => void onCopyCode()}
                aria-label="Kopiuj kod"
              >
                <Copy className="size-4" />
              </Button>
            </div>
          )}

          {household && canRegenerate && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="mt-2"
              onClick={() => void onRegenerate()}
              disabled={regenerating}
            >
              <RefreshCw className="mr-2 size-4" />
              Nowy kod
            </Button>
          )}
        </section>

        <section>
          <h2 className="text-sm font-semibold text-muted-foreground">Aktywność</h2>
          <ul className="mt-2 flex flex-col gap-2">
            {activity?.data.map((entry) => (
              <li key={entry.id} className="rounded-2xl border border-border px-3 py-2 text-sm">
                <span className="font-medium">{entry.actor_name}</span> {ACTION_LABEL[entry.action]}{" "}
                <span className="font-medium">{entry.subject_label}</span>
              </li>
            ))}
          </ul>
          {hasMorePages && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-2"
              onClick={() => void onLoadMore()}
            >
              Załaduj więcej
            </Button>
          )}
        </section>

        <Button type="button" variant="outline" onClick={onLogout} className="mb-4">
          <LogOut className="mr-2 size-4" />
          Wyloguj
        </Button>
      </div>
    </div>
  );
}
