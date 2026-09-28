/**
 * Modular API client layer for the external Laravel REST API.
 *
 * The app is offline-first: every mutation is applied to local state
 * immediately and the matching HTTP call is pushed onto a durable queue that
 * is flushed whenever the device is online. If the backend is unreachable the
 * UI never blocks.
 */

import { clearAuthToken, getAuthToken } from "../auth";

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

/** Token missing/expired/revoked — clear it and bounce to login, per api-integration-guide.md §3. */
function handleUnauthorized() {
  clearAuthToken();
  if (!isBrowser()) return;
  const loginPath = `${import.meta.env.BASE_URL}login`;
  // Avoid a pointless reload loop when this fires while already on /login
  // (e.g. queued requests from before the user logged in getting flushed).
  if (!window.location.pathname.endsWith("/login")) window.location.href = loginPath;
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

export { API_BASE };

if (isBrowser()) {
  window.addEventListener("online", () => void flushQueue());
  // Requests queued while logged out (e.g. the seed-data creates pushed on
  // first hydration, which happens on /login too, before a token exists)
  // 401 and stay stuck in the queue by design — retry them the moment a
  // token actually shows up, instead of waiting for the next unrelated
  // enqueue() call to happen to trigger a flush.
  window.addEventListener("homesync:auth", () => void flushQueue());
}
