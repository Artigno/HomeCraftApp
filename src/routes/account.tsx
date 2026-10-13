import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Check, Copy, LogOut, RefreshCw, Trash2, X } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  apiApprovePendingMember,
  apiGet,
  apiGetNotificationPreferences,
  apiGetVapidPublicKey,
  apiPatchNotificationPreferences,
  apiProfile,
  apiRegenerateShareCode,
  apiRejectPendingMember,
  apiRemoveMember,
  apiSubscribePush,
  apiUnsubscribePush,
} from "@/lib/api/client";
import { clearAuthToken, getIsOwner, getMyName, setMyName } from "@/lib/auth";
import type {
  ActivityPage,
  Household,
  NotificationPreferences,
  PendingMember,
} from "@/lib/api/types";

const PREF_LABELS: [keyof NotificationPreferences, string][] = [
  ["shopping_item_added", "Nowy produkt na liście zakupów"],
  ["shopping_finished", "Zakończone zakupy"],
  ["habit_logged", "Zarejestrowana czynność konserwacyjna"],
  ["recipe_added", "Nowy przepis"],
];

function isPushSupported() {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window;
}

function isIOSDevice() {
  return typeof navigator !== "undefined" && /iPhone|iPad|iPod/.test(navigator.userAgent);
}

function isStandaloneDisplay() {
  return (
    typeof window !== "undefined" &&
    (window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true)
  );
}

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(new ArrayBuffer(rawData.length));
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

async function getCurrentPushSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

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
  const [pushSupported, setPushSupported] = useState(false);
  const [iosBlocked, setIosBlocked] = useState(false);

  useEffect(() => {
    setPushSupported(isPushSupported());
    setIosBlocked(isIOSDevice() && !isStandaloneDisplay());
  }, []);
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [subLoading, setSubLoading] = useState(false);

  useEffect(() => {
    void apiGet<Household | null>("/household", null).then(setHousehold);
    void apiGet<ActivityPage | null>("/household/activity?page=1", null).then(setActivity);
    if (getIsOwner()) {
      void apiGet<PendingMember[] | null>("/household/pending-members", null).then(
        setPendingMembers,
      );
    }
    if (pushSupported) {
      void apiGetNotificationPreferences().then(setPrefs);
      void getCurrentPushSubscription()
        .then((sub) => setSubscribed(sub !== null))
        .catch(() => setSubscribed(false));
    }
  }, [pushSupported]);

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
                members: [
                  ...h.members,
                  { id: member.id, name: member.name, is_owner: false, joined_with_code: null },
                ],
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

  async function onCopyCode(code: string) {
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

  async function onTogglePreference(key: keyof NotificationPreferences, value: boolean) {
    setPrefs((p) => (p ? { ...p, [key]: value } : p));
    const res = await apiPatchNotificationPreferences({ [key]: value });
    if (!res.ok) {
      setPrefs((p) => (p ? { ...p, [key]: !value } : p));
      toast.error("Nie udało się zapisać ustawienia.");
    }
  }

  async function onEnableNotifications() {
    setSubLoading(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        toast.error("Brak zgody na powiadomienia.");
        return;
      }
      const vapidKey = await apiGetVapidPublicKey();
      if (!vapidKey) {
        toast.error("Nie udało się pobrać klucza powiadomień.");
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      });
      const json = subscription.toJSON() as {
        endpoint: string;
        keys: { p256dh: string; auth: string };
      };
      const res = await apiSubscribePush({ endpoint: json.endpoint, keys: json.keys });
      if (res.ok) {
        setSubscribed(true);
        toast.success("Włączono powiadomienia.");
      } else {
        toast.error("Nie udało się zarejestrować powiadomień.");
      }
    } catch {
      toast.error("Nie udało się włączyć powiadomień.");
    } finally {
      setSubLoading(false);
    }
  }

  async function onDisableNotifications() {
    setSubLoading(true);
    try {
      const subscription = await getCurrentPushSubscription();
      if (subscription) {
        await apiUnsubscribePush(subscription.endpoint);
        await subscription.unsubscribe();
      }
      setSubscribed(false);
      toast.success("Wyłączono powiadomienia.");
    } catch {
      toast.error("Nie udało się wyłączyć powiadomień.");
    } finally {
      setSubLoading(false);
    }
  }

  async function onLogout() {
    if (pushSupported) {
      try {
        const subscription = await getCurrentPushSubscription();
        if (subscription) await apiUnsubscribePush(subscription.endpoint);
      } catch {
        // best-effort — offline logout shouldn't be blocked by this
      }
    }
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
                <div className="flex flex-col">
                  <span>{m.name ?? "Bez imienia"}</span>
                  {m.joined_with_code && (
                    <button
                      type="button"
                      onClick={() => void onCopyCode(m.joined_with_code!)}
                      className="flex items-center gap-1 text-left text-xs text-muted-foreground"
                      aria-label={`Kopiuj kod logowania ${m.name ?? "domownika"}`}
                    >
                      <code className="tracking-wide">{m.joined_with_code}</code>
                      <Copy className="size-3" />
                    </button>
                  )}
                </div>
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
                  <span className="flex items-center gap-2">
                    {m.name}
                    {m.is_returning && (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                        Wraca
                      </span>
                    )}
                  </span>
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
                onClick={() => void onCopyCode(household.share_code!)}
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

        {pushSupported && (
          <section>
            <h2 className="text-sm font-semibold text-muted-foreground">Powiadomienia</h2>
            <div className="mt-2 flex flex-col gap-2">
              {PREF_LABELS.map(([key, label]) => (
                <div
                  key={key}
                  className="flex items-center justify-between rounded-2xl border border-border px-3 py-2"
                >
                  <span className="text-sm">{label}</span>
                  <Switch
                    checked={prefs?.[key] ?? true}
                    onCheckedChange={(checked) => void onTogglePreference(key, checked)}
                  />
                </div>
              ))}
            </div>

            {iosBlocked ? (
              <p className="mt-3 text-sm text-muted-foreground">
                Aby włączyć powiadomienia na iPhonie/iPadzie, najpierw dodaj aplikację do ekranu
                głównego (Udostępnij → Dodaj do ekranu początkowego), a następnie otwórz ją z ikony.
              </p>
            ) : (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="mt-3"
                onClick={() =>
                  void (subscribed ? onDisableNotifications() : onEnableNotifications())
                }
                disabled={subLoading}
              >
                {subscribed ? "Wyłącz powiadomienia" : "Włącz powiadomienia"}
              </Button>
            )}
          </section>
        )}

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

        <Button type="button" variant="outline" onClick={() => void onLogout()} className="mb-4">
          <LogOut className="mr-2 size-4" />
          Wyloguj
        </Button>
      </div>
    </div>
  );
}
