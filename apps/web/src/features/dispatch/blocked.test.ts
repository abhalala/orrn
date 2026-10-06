import { describe, expect, test } from "bun:test";

import { blockedCount, blockText, itemBlock, sortBlockedFirst } from "./blocked";

const t = ((key: string, vars?: Record<string, unknown>) => (vars ? `${key} ${JSON.stringify(vars)}` : key)) as never;

describe("itemBlock", () => {
  test("Building: only bundles still in stock can be held", () => {
    expect(itemBlock({ status: "available", heldBy: null }, "draft")).toBeNull();
    expect(itemBlock({ status: "reserved", heldBy: "DSP-000041" }, "draft")).toEqual({ kind: "heldElsewhere", code: "DSP-000041" });
    // Held, but the server could not name the dispatch (another company's id, a deleted dispatch).
    expect(itemBlock({ status: "reserved", heldBy: null }, "draft")).toEqual({ kind: "heldElsewhere", code: null });
    expect(itemBlock({ status: "reserved" }, "draft")).toEqual({ kind: "heldElsewhere", code: null });
    expect(itemBlock({ status: "dispatched", heldBy: null }, "draft")).toEqual({ kind: "dispatched" });
    expect(itemBlock({ status: "void", heldBy: null }, "draft")).toEqual({ kind: "void" });
  });

  test("Held: every bundle must be held by this dispatch", () => {
    expect(itemBlock({ status: "reserved", heldBy: null }, "reserved")).toBeNull();
    expect(itemBlock({ status: "reserved", heldBy: "DSP-000041" }, "reserved")).toEqual({ kind: "heldElsewhere", code: "DSP-000041" });
    expect(itemBlock({ status: "available", heldBy: null }, "reserved")).toEqual({ kind: "notHeld" });
    expect(itemBlock({ status: "void", heldBy: null }, "reserved")).toEqual({ kind: "void" });
    expect(itemBlock({ status: "dispatched", heldBy: null }, "reserved")).toEqual({ kind: "dispatched" });
  });

  test("a dispatched or cancelled dispatch marks nothing", () => {
    expect(itemBlock({ status: "dispatched", heldBy: null }, "completed")).toBeNull();
    expect(itemBlock({ status: "available", heldBy: null }, "cancelled")).toBeNull();
  });
});

describe("blockedCount and sortBlockedFirst", () => {
  const items = [
    { serial: "A", status: "available" as const, heldBy: null },
    { serial: "B", status: "reserved" as const, heldBy: "DSP-000041" },
    { serial: "C", status: "available" as const, heldBy: null },
    { serial: "D", status: "void" as const, heldBy: null },
  ];

  test("counts the bundles that stop the next step", () => {
    expect(blockedCount(items, "draft")).toBe(2);
    expect(blockedCount(items, "reserved")).toBe(4);
    expect(blockedCount(items, "completed")).toBe(0);
  });

  test("puts marked bundles first and keeps the order otherwise", () => {
    expect(sortBlockedFirst(items, "draft").map((i) => i.serial)).toEqual(["B", "D", "A", "C"]);
    expect(sortBlockedFirst(items, "completed").map((i) => i.serial)).toEqual(["A", "B", "C", "D"]);
  });
});

describe("blockText", () => {
  test("words each reason with the floor's keys", () => {
    expect(blockText(t, { kind: "heldElsewhere", code: "DSP-000041" })).toBe('scan.continuous.heldBy {"code":"DSP-000041"}');
    expect(blockText(t, { kind: "heldElsewhere", code: null })).toBe("scan.continuous.heldElsewhere");
    expect(blockText(t, { kind: "dispatched" })).toBe("scan.continuous.dispatched");
    expect(blockText(t, { kind: "void" })).toBe("status.bundle.void");
    expect(blockText(t, { kind: "notHeld" })).toBe("dispatch.build.notHeld");
  });
});
