import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createI18n } from "@orrn/i18n";

import { holdableItems, orderErrorLines, timelineLabel } from "../features/orders/order-model";

const ROOT = join(import.meta.dir, "..");
const read = (file: string) => readFileSync(join(ROOT, file), "utf8");
const en = createI18n("en").t;
const hi = createI18n("hi").t;

describe("hold stock for an order line on the phone", () => {
  test("only unheld bundles on no line or this line can be picked", () => {
    const items = [
      { id: "plant", lineId: null, heldForLineId: null },
      { id: "this", lineId: "line-1", heldForLineId: null },
      { id: "other", lineId: "line-2", heldForLineId: null },
      { id: "held", lineId: null, heldForLineId: "line-1" },
    ];
    expect(holdableItems(items, "line-1").map((item) => item.id)).toEqual(["plant", "this"]);
  });

  test("the order detail uses order.manage and opens the same two sheets as the web", () => {
    const screen = read("features/orders/order-detail.tsx");
    expect(screen).toContain('<Can do="order.manage">');
    expect(screen).toContain('t("orders.hold.button")');
    expect(screen).toContain('t("orders.hold.list")');
    expect(screen).toContain('t("orders.hold.chip"');
    expect(screen).toContain("<HoldStockSheet target={holdLine}");
    expect(screen).toContain("<HeldSheet target={heldLine}");
    expect(screen).toContain("openOrder={isOpenStatus(status)}");
  });

  test("the sheets call the web's procedures and show its confirmations, warnings and release choices", () => {
    const sheet = read("features/orders/hold-sheet.tsx");
    expect(sheet).toContain("trpc.orders.matchStock.queryOptions");
    expect(sheet).toContain("trpc.orders.hold.mutationOptions");
    expect(sheet).toContain("trpc.orders.holds.queryOptions");
    expect(sheet).toContain("trpc.orders.release.mutationOptions");
    expect(sheet).toContain('t("orders.hold.submit"');
    expect(sheet).toContain('t("orders.hold.releaseSelected"');
    expect(sheet).toContain('t("orders.hold.releaseAll")');
    expect(sheet).toContain('t("orders.hold.lengthWarning"');
    expect(sheet).toContain("orderErrorLines(t, error)");
    expect(sheet).toContain("await refreshAfterHold(queryClient)");
  });

  test("hold and release refusals use the shared translation, never the server's English", () => {
    const error = { message: "26J101 is already held for SO-14 line 2 (Shree Traders). Release it first.", data: { code: "BAD_REQUEST", httpStatus: 400 } };
    expect(orderErrorLines(en, error)).toEqual([en("refusal.heldFor", { serial: "26J101", order: "SO-14", n: "2" })]);
    expect(orderErrorLines(hi, error)[0]).not.toContain("Release it first");
  });

  test("hold and release audit rows have their own timeline wording", () => {
    expect(timelineLabel({ action: "order.hold", meta: { serials: ["26J101"], kgG: 12_000, lineNo: 2 } })).toEqual({
      key: "orders.timeline.hold",
      vars: { count: 1, kg: "12.000", line: 2 },
    });
    expect(timelineLabel({ action: "order.release", meta: { bundleIds: ["b1", "b2"], kgG: 24_000, lineNo: 2 } }).key).toBe("orders.timeline.release");
  });
});
