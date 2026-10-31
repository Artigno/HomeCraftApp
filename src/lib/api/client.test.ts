import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// flushQueue is isBrowser()-gated (`typeof window !== "undefined"`) and uses
// window.localStorage + window.dispatchEvent — stub just enough of a browser
// global to exercise the real code path in Node.
function installWindowStub() {
  const store = new Map<string, string>();
  const listeners = new Map<string, Set<(e: Event) => void>>();
  const win = {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
    addEventListener: (type: string, fn: (e: Event) => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener: (type: string, fn: (e: Event) => void) => {
      listeners.get(type)?.delete(fn);
    },
    dispatchEvent: (e: Event) => {
      listeners.get((e as CustomEvent).type)?.forEach((fn) => fn(e));
      return true;
    },
  };
  vi.stubGlobal("window", win);
  return win;
}

describe("flushQueue", () => {
  beforeEach(() => {
    installWindowStub();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("does not silently stall a real flush right after an empty-queue flush", async () => {
    const { enqueue, flushQueue } = await import("./client");

    // An empty-queue flush (exactly what every page mount fires) must not
    // leave flushPromise stuck on a stale already-settled reference — see
    // the comment on flushQueue in client.ts for the race this guards.
    await flushQueue();

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(new Response(null, { status: 201 }));

    enqueue("POST", "/shopping-items/batch", { tag_id: "t1", items: [] });
    await flushQueue();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toContain("/shopping-items/batch");
  });
});
