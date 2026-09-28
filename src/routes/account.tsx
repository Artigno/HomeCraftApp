import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Check, Copy, LogOut, RefreshCw, Trash2, X } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  apiApprovePendingMember,
  apiGet,
  apiProfile,
  apiRegenerateShareCode,
  apiRejectPendingMember,
  apiRemoveMember,
} from "@/lib/api/client";
import { clearAuthToken, getIsOwner, getMyName, setMyName } from "@/lib/auth";
import type { ActivityPage, Household, PendingMember } from "@/lib/api/types";

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
  const [pendingMembers, setPendingMembers] = useState<PendingMember[] | null>(null);
  const [processingId, setProcessingId] = useState<number | null>(null);

  useEffect(() => {
    void apiGet<Household | null>("/household", null).then(setHousehold);
    void apiGet<ActivityPage | null>("/household/activity?page=1", null).then(setActivity);
    if (getIsOwner()) {
      void apiGet<PendingMember[] | null>("/household/pending-members", null).then(
        setPendingMembers,
      );
    }
  }, []);

  async function onSaveName(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setSavingName(true);
    try {
      const res = await apiProfile(trimmed);
      if (res.ok) {
        setMyName(trimmed);
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

  async function onApprove(member: PendingMember) {
    setProcessingId(member.id);
    try {
      const res = await apiApprovePendingMember(member.id);
      if (res.ok) {
        setPendingMembers((list) => list?.filter((m) => m.id !== member.id) ?? list);
        setHousehold((h) =>
          h
            ? {
                ...h,
                members: [...h.members, { id: member.id, name: member.name, is_owner: false }],
              }
            : h,
        );
        toast.success(`Zatwierdzono ${member.name}.`);
      } else if (res.status === 403) {
        setCanRegenerate(false);
        toast.error("Tylko właściciel domu może zatwierdzać dołączenia.");
      } else {
        toast.error("Nie udało się zatwierdzić.");
      }
    } catch {
      toast.error("Brak połączenia z serwerem.");
    } finally {
      setProcessingId(null);
    }
  }

  async function onReject(member: PendingMember) {
    setProcessingId(member.id);
    try {
      const res = await apiRejectPendingMember(member.id);
      if (res.ok) {
        setPendingMembers((list) => list?.filter((m) => m.id !== member.id) ?? list);
        toast.success(`Odrzucono ${member.name}.`);
      } else if (res.status === 403) {
        setCanRegenerate(false);
        toast.error("Tylko właściciel domu może odrzucać dołączenia.");
      } else {
        toast.error("Nie udało się odrzucić.");
      }
    } catch {
      toast.error("Brak połączenia z serwerem.");
    } finally {
      setProcessingId(null);
    }
  }

  async function onRemoveMember(member: { id: number; name: string | null }) {
    setProcessingId(member.id);
    try {
      const res = await apiRemoveMember(member.id);
      if (res.ok) {
        setHousehold((h) =>
          h ? { ...h, members: h.members.filter((m) => m.id !== member.id) } : h,
        );
        toast.success(`Usunięto ${member.name ?? "domownika"}.`);
      } else if (res.status === 403) {
        setCanRegenerate(false);
        toast.error("Tylko właściciel domu może usuwać domowników.");
      } else {
        toast.error("Nie udało się usunąć.");
      }
    } catch {
      toast.error("Brak połączenia z serwerem.");
    } finally {
      setProcessingId(null);
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
                <div className="flex items-center gap-2">
                  {m.is_owner && (
                    <span className="text-xs font-medium text-muted-foreground">Właściciel</span>
                  )}
                  {canRegenerate && !m.is_owner && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => void onRemoveMember(m)}
                      disabled={processingId === m.id}
                      aria-label={`Usuń ${m.name ?? "domownika"}`}
                    >
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>

          {canRegenerate && pendingMembers && pendingMembers.length > 0 && (
            <div className="mt-3 flex flex-col gap-2">
              <h3 className="text-xs font-semibold text-muted-foreground">
                Oczekują na zatwierdzenie
              </h3>
              {pendingMembers.map((m) => (
                <div
                  key={m.id}
                  className="flex items-center justify-between rounded-2xl border border-border bg-muted/40 px-3 py-2"
                >
                  <span>{m.name}</span>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => void onApprove(m)}
                      disabled={processingId === m.id}
                      aria-label={`Zatwierdź ${m.name}`}
                    >
                      <Check className="size-4 text-[var(--status-good)]" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => void onReject(m)}
                      disabled={processingId === m.id}
                      aria-label={`Odrzuć ${m.name}`}
                    >
                      <X className="size-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

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
