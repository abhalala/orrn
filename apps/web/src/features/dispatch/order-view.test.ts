import { describe, expect, test } from "bun:test";

import { addAllSerials, orderState, otherOrderItems, suggestGroups } from "./order-view";

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
