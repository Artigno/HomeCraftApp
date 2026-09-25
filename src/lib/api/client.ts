/**
 * Modular API client layer for the external Laravel REST API.
 *
 * The app is offline-first: every mutation is applied to local state
 * immediately and the matching HTTP call is pushed onto a durable queue that
 * is flushed whenever the device is online. If the backend is unreachable the
 * UI never blocks.
 */

const API_BASE =
  (import.meta.env['VITE_API_URL'] as string | undefined) ?? "https://api.homesync.local/api";

const QUEUE_KEY = "homesync.request-queue";

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
      try {
        const res = await fetch(`${API_BASE}${next.path}`, {
          method: next.method,
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: next.body ? JSON.stringify(next.body) : undefined,
        });
        if (!res.ok && res.status >= 500) break; // retry later
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
    const res = await fetch(`${API_BASE}${path}`, { headers: { Accept: "application/json" } });
    if (!res.ok) return fallback;
    return (await res.json()) as T;
  } catch {
    return fallback;
  }
}

if (isBrowser()) {
  window.addEventListener("online", () => void flushQueue());
}
