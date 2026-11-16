import { describe, expect, it } from "vitest";
import { applyPendingLogOverride, carryForwardUnflushedCreates } from "./store";
import type { MaintenanceTask } from "./api/types";

interface Row {
  id: string;
  name: string;
}

function task(overrides: Partial<MaintenanceTask>): MaintenanceTask {
  return {
    id: "t1",
    name: "Umyj ekspres",
    icon: "coffee",
    color: "blue",
    frequency_days: 14,
    last_done_at: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("carryForwardUnflushedCreates", () => {
  it("carries forward a local row missing from the fetched set when its id is pending", () => {
    const fetched: Row[] = [{ id: "a", name: "A" }];
    const local: Row[] = [
      { id: "a", name: "A" },
      { id: "b", name: "B (not flushed yet)" },
    ];
    const pendingIds = new Set(["b"]);

    const result = carryForwardUnflushedCreates(fetched, local, pendingIds);

    expect(result).toEqual([
      { id: "a", name: "A" },
      { id: "b", name: "B (not flushed yet)" },
    ]);
  });

  it("does not duplicate a row that already landed server-side", () => {
    const fetched: Row[] = [
      { id: "a", name: "A" },
      { id: "b", name: "B" },
    ];
    const local: Row[] = [
      { id: "a", name: "A" },
      { id: "b", name: "B" },
    ];
    const pendingIds = new Set(["b"]);

    const result = carryForwardUnflushedCreates(fetched, local, pendingIds);

    expect(result).toEqual(fetched);
  });

  it("returns the fetched set unchanged when nothing is pending", () => {
    const fetched: Row[] = [{ id: "a", name: "A" }];
    const local: Row[] = [{ id: "a", name: "A" }];

    const result = carryForwardUnflushedCreates(fetched, local, new Set());

    expect(result).toBe(fetched);
  });

  it("ignores a pending id that was already removed locally", () => {
    const fetched: Row[] = [];
    const local: Row[] = [];
    const pendingIds = new Set(["ghost"]);

    const result = carryForwardUnflushedCreates(fetched, local, pendingIds);

    expect(result).toEqual([]);
  });
});

describe("applyPendingLogOverride", () => {
  it("keeps the local last_done_at when its /maintenance-logs POST hasn't flushed yet", () => {
    // Reproduces the "Dom" tab bug: logTask() optimistically sets today's
    // date locally and queues a POST, but a resync that races ahead of the
    // flush still has the backend's stale (October) last_done_at.
    const local = [task({ last_done_at: "2026-11-06T12:00:00.000Z" })];
    const fetched = [task({ last_done_at: "2026-10-01T00:00:00.000Z" })];

    const result = applyPendingLogOverride(fetched, local, new Set(["t1"]));

    expect(result[0]!.last_done_at).toBe("2026-11-06T12:00:00.000Z");
  });

  it("takes the fetched value once the log is no longer pending", () => {
    const local = [task({ last_done_at: "2026-11-06T12:00:00.000Z" })];
    const fetched = [task({ last_done_at: "2026-11-06T12:00:00.000Z" })];

    const result = applyPendingLogOverride(fetched, local, new Set());

    expect(result).toBe(fetched);
  });

  it("leaves unrelated tasks untouched", () => {
    const local = [
      task({ id: "t1" }),
      task({ id: "t2", last_done_at: "2026-11-01T00:00:00.000Z" }),
    ];
    const fetched = [
      task({ id: "t1", last_done_at: "2026-10-01T00:00:00.000Z" }),
      task({ id: "t2", last_done_at: "2026-11-01T00:00:00.000Z" }),
    ];

    const result = applyPendingLogOverride(fetched, local, new Set(["t1"]));

    expect(result[1]).toEqual(fetched[1]);
  });
});
