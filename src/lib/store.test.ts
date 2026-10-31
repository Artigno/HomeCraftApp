import { describe, expect, it } from "vitest";
import { carryForwardUnflushedCreates } from "./store";

interface Row {
  id: string;
  name: string;
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
