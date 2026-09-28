/**
 * Modular API client layer for the external Laravel REST API.
 *
 * The app is offline-first: every mutation is applied to local state
 * immediately and the matching HTTP call is pushed onto a durable queue that
 * is flushed whenever the device is online. If the backend is unreachable the
 * UI never blocks.
 */

import { clearAuthToken, getAuthToken, isAuthenticated } from "../auth";

const API_BASE =
  (import.meta.env["VITE_API_URL"] as string | undefined) ?? "https://api.homesync.local/api";

const QUEUE_KEY = "homesync.request-queue";
const FAILED_QUEUE_KEY = "homesync.request-queue.failed";

export interface QueuedRequest {
  id: string;
  method: "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  body?: unknown;
  queued_at: string;
}

function isBrowser() {
  return typeof window !== "undefined";
}

export function readQueue(): QueuedRequest[] {
  if (!isBrowser()) return [];
  try {
    return JSON.parse(window.localStorage.getItem(QUEUE_KEY) ?? "[]") as QueuedRequest[];
  } catch {
    return [];
  }
}

function writeQueue(queue: QueuedRequest[]) {
  if (!isBrowser()) return;
  window.localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  window.dispatchEvent(new CustomEvent("homesync:queue", { detail: queue.length }));
}

/** Requests rejected by the backend (4xx) — dead-lettered here instead of silently discarded. */
export function readFailedQueue(): QueuedRequest[] {
  if (!isBrowser()) return [];
  try {
    return JSON.parse(window.localStorage.getItem(FAILED_QUEUE_KEY) ?? "[]") as QueuedRequest[];
  } catch {
    return [];
  }
}

function recordFailed(request: QueuedRequest) {
  if (!isBrowser()) return;
  window.localStorage.setItem(FAILED_QUEUE_KEY, JSON.stringify([...readFailedQueue(), request]));
}

function authHeaders(): Record<string, string> {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

let unauthorizedHandled = false;

/**
 * Token missing/expired/revoked, per api-integration-guide.md §3. Clears the
 * token and asks the already-mounted app to navigate to /login itself
 * (see __root.tsx's "homesync:unauthorized" listener) instead of doing a
 * hard `window.location.href` reload — a reload fired while React is still
 * hydrating the SSR-streamed shell interrupts that hydration and crashes
 * the page (React error #422 + a router invariant), which is what actually
 * broke this page: several parallel GETs (syncFromBackend) can all 401 at
 * once, each racing a reload against React's in-flight hydration.
 */
function handleUnauthorized() {
  if (unauthorizedHandled) return;
  unauthorizedHandled = true;
  clearAuthToken();
  if (isBrowser()) window.dispatchEvent(new CustomEvent("homesync:unauthorized"));
}

/**
 * A 403 with `{error: "household_approval_pending"}` means this account
 * joined via share code and the owner hasn't approved it yet — every
 * household-scoped endpoint returns this until approval. Unlike a 401,
 * the token is still valid (don't clear it), so just ask the mounted app
 * to navigate to /waitroom (see __root.tsx's "homesync:pending" listener).
 * Covers both a fresh join and a resumed session that's still pending.
 */
async function checkPending(res: Response): Promise<boolean> {
  if (res.status !== 403) return false;
  const body = (await res
    .clone()
    .json()
    .catch(() => undefined)) as { error?: string } | undefined;
  if (body?.error !== "household_approval_pending") return false;
  if (isBrowser()) window.dispatchEvent(new CustomEvent("homesync:pending"));
  return true;
}

/** Queue a mutation against the Laravel API and try to flush immediately. */
export function enqueue(
  method: QueuedRequest["method"],
  path: string,
  body?: unknown,
): QueuedRequest {
  const request: QueuedRequest = {
    id: crypto.randomUUID(),
    method,
    path,
    body,
    queued_at: new Date().toISOString(),
  };
  writeQueue([...readQueue(), request]);
  void flushQueue();
  return request;
}

let flushing = false;

export async function flushQueue(): Promise<void> {
  if (!isBrowser() || flushing || !navigator.onLine) return;
  flushing = true;
  try {
    let queue = readQueue();
    while (queue.length > 0) {
      const next = queue[0];
      if (!next) break;
      try {
        const res = await fetch(`${API_BASE}${next.path}`, {
          method: next.method,
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            ...authHeaders(),
          },
          ...(next.body ? { body: JSON.stringify(next.body) } : {}),
          signal: AbortSignal.timeout(10_000),
        });
        if (res.status === 401) {
          handleUnauthorized();
          break; // don't dead-letter or retry — the queue is retried after re-login
        }
        if (await checkPending(res)) break; // stay queued — retried once the owner approves
        if (!res.ok && res.status >= 500) break; // retry later
        if (!res.ok) recordFailed(next); // 4xx — backend rejected it, dead-letter instead of silent drop
      } catch {
        break; // still offline / backend down -> keep the queue intact
      }
      queue = readQueue().slice(1);
      writeQueue(queue);
    }
  } finally {
    flushing = false;
  }
}

export async function apiGet<T>(path: string, fallback: T): Promise<T> {
  if (!isBrowser() || !navigator.onLine) return fallback;
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: { Accept: "application/json", ...authHeaders() },
    });
    if (res.status === 401) {
      handleUnauthorized();
      return fallback;
    }
    if (await checkPending(res)) return fallback;
    if (!res.ok) return fallback;
    return (await res.json()) as T;
  } catch {
    return fallback;
  }
}

/** Auth-only calls (register/login/logout) — not queued, caller awaits the result directly. */
export async function apiAuth<T>(
  path: string,
  body?: unknown,
  init?: { requireAuth?: boolean },
): Promise<{ ok: true; status: number; data: T } | { ok: false; status: number; data: unknown }> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init?.requireAuth ? authHeaders() : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(10_000),
  });
  const data = res.status === 204 ? undefined : await res.json().catch(() => undefined);
  return res.ok
    ? { ok: true, status: res.status, data: data as T }
    : { ok: false, status: res.status, data };
}

/**
 * PATCH /profile — synchronous, not queued, since the caller (account.tsx's
 * rename form) needs to know the result immediately rather than firing and
 * forgetting. Returns 204 with no body on success.
 */
export async function apiProfile(name: string): Promise<{ ok: boolean; status: number }> {
  const res = await fetch(`${API_BASE}/profile`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify({ name }),
    signal: AbortSignal.timeout(10_000),
  });
  return { ok: res.ok, status: res.status };
}

/** POST /household/share-code — synchronous, owner-only (403 for non-owners). */
export async function apiRegenerateShareCode(): Promise<
  { ok: true; share_code: string } | { ok: false; status: number }
> {
  const res = await fetch(`${API_BASE}/household/share-code`, {
    method: "POST",
    headers: { Accept: "application/json", ...authHeaders() },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return { ok: false, status: res.status };
  const data = (await res.json()) as { share_code: string };
  return { ok: true, share_code: data.share_code };
}

/** POST /household/pending-members/{id}/approve — synchronous, owner-only. */
export async function apiApprovePendingMember(
  id: number,
): Promise<{ ok: boolean; status: number }> {
  const res = await fetch(`${API_BASE}/household/pending-members/${id}/approve`, {
    method: "POST",
    headers: { Accept: "application/json", ...authHeaders() },
    signal: AbortSignal.timeout(10_000),
  });
  return { ok: res.ok, status: res.status };
}

/** POST /household/pending-members/{id}/reject — synchronous, owner-only, deletes the account. */
export async function apiRejectPendingMember(id: number): Promise<{ ok: boolean; status: number }> {
  const res = await fetch(`${API_BASE}/household/pending-members/${id}/reject`, {
    method: "POST",
    headers: { Accept: "application/json", ...authHeaders() },
    signal: AbortSignal.timeout(10_000),
  });
  return { ok: res.ok, status: res.status };
}

/** DELETE /household/members/{id} — synchronous, owner-only, keeps the member's data. */
export async function apiRemoveMember(id: number): Promise<{ ok: boolean; status: number }> {
  const res = await fetch(`${API_BASE}/household/members/${id}`, {
    method: "DELETE",
    headers: { Accept: "application/json", ...authHeaders() },
    signal: AbortSignal.timeout(10_000),
  });
  return { ok: res.ok, status: res.status };
}

export { API_BASE };

if (isBrowser()) {
  window.addEventListener("online", () => void flushQueue());
  // Requests queued while logged out (e.g. the seed-data creates pushed on
  // first hydration, which happens on /login too, before a token exists)
  // 401 and stay stuck in the queue by design — retry them the moment a
  // token actually shows up, instead of waiting for the next unrelated
  // enqueue() call to happen to trigger a flush.
  window.addEventListener("homesync:auth", () => {
    // "homesync:auth" fires on both login AND clearAuthToken (i.e. from
    // handleUnauthorized() itself) — only reset the guard on an actual
    // (re)login. Resetting it unconditionally here re-armed it before the
    // redirect from the first 401 could even happen, so every other request
    // in the same Promise.all that also 401'd re-triggered the whole clear
    // + event + reset cycle again, in a tight loop, which is what crashed
    // the page instead of cleanly redirecting to /login.
    if (isAuthenticated()) unauthorizedHandled = false;
    void flushQueue();
  });
}
