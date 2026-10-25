import { describe, expect, test } from "bun:test";

import { ADD_CHUNK, addAllSerials, addInChunks, orderState, otherOrderItems, suggestGroups } from "./order-view";

describe("orderState", () => {
  const base = { bakiG: 1_000_000, onDispatchG: 0, overG: 0 };
  test("empty load, a load that leaves baki, a load that finishes the order, a load past it", () => {
    expect(orderState(base)).toBe("empty");
    expect(orderState({ ...base, onDispatchG: 240_000 })).toBe("open");
    expect(orderState({ ...base, onDispatchG: 1_000_000 })).toBe("done");
    expect(orderState({ ...base, onDispatchG: 1_100_000, overG: 100_000 })).toBe("over");
  });
});

describe("otherOrderItems", () => {
  test("counts the bundles that went to another order and names each order once", () => {
    const items = [
      { orderId: "a", orderNumber: "SO-14" },
      { orderId: "b", orderNumber: "SO-15" },
      { orderId: "b", orderNumber: "SO-15" },
      { orderId: null, orderNumber: null },
    ];
    expect(otherOrderItems(items, "a")).toEqual({ count: 2, orders: ["SO-15"] });
    expect(otherOrderItems([], "a")).toEqual({ count: 0, orders: [] });
  });
});

describe("suggestions", () => {
  const items = [
    { id: "1", serial: "26J1", group: "order" as const, weightG: 120_000, pcs: 10, fits: true },
    { id: "2", serial: "26J2", group: "order" as const, weightG: 120_000, pcs: 10, fits: false },
    { id: "3", serial: "26J3", group: "plant" as const, weightG: 100_000, pcs: 8, fits: true },
  ];
  test("the order's stock first, plant stock second", () => {
    const g = suggestGroups(items);
    expect(g.order.map((i) => i.serial)).toEqual(["26J1", "26J2"]);
    expect(g.plant.map((i) => i.serial)).toEqual(["26J3"]);
  });
  test("add all sends what fits, in the listed order", () => {
    expect(addAllSerials(items)).toEqual(["26J1", "26J3"]);
    expect(addAllSerials([])).toEqual([]);
  });
});

describe("addInChunks (review r1 I-4)", () => {
  const items = Array.from({ length: 150 }, (_, i) => ({ serial: `B${i + 1}`, lineId: i < 120 ? "l1" : "l2" }));

  test("150 that fit go in two calls of at most 100, one after the other, with progress after each", async () => {
    const calls: { serials: string[]; lines: string[] }[] = [];
    const progress: [number, number][] = [];
    let inFlight = 0;
    const res = await addInChunks(
      items,
      async (serials, lines) => {
        inFlight += 1;
        expect(inFlight).toBe(1); // sequential
        calls.push({ serials, lines });
        await Promise.resolve();
        inFlight -= 1;
        return { added: serials };
      },
      (done, total) => progress.push([done, total]),
    );
    expect(ADD_CHUNK).toBe(100);
    expect(calls.map((c) => c.serials.length)).toEqual([100, 50]);
    expect(calls[0]!.serials[0]).toBe("B1");
    expect(calls[1]!.serials[0]).toBe("B101");
    expect(calls.map((c) => c.lines)).toEqual([["l1"], ["l1", "l2"]]);
    expect(progress).toEqual([
      [100, 150],
      [150, 150],
    ]);
    expect(res).toMatchObject({ sent: 150, error: null });
    expect(res.reports).toHaveLength(2);
  });

  test("a failed call stops the run and says how far it got", async () => {
    let n = 0;
    const res = await addInChunks(items, async (serials) => {
      n += 1;
      if (n === 2) throw new Error("network");
      return { added: serials };
    });
    expect(n).toBe(2);
    expect(res.sent).toBe(100);
    expect(res.reports).toHaveLength(1);
    expect((res.error as Error).message).toBe("network");
  });
});
