import { describe, expect, test } from "bun:test";

import { createI18n } from "@orrn/i18n";

import {
  blockerText,
  blockersFromMessage,
  dieTitle,
  lateLabel,
  listInput,
  milliText,
  orderErrorLines,
  orderKgText,
  parseBlocker,
  pcsText,
  poRepeatFromMessage,
  STATUS_KEY,
  STATUS_TONE,
  stripCells,
  timelineLabel,
} from "../features/orders/order-model";
import { RequestTimeoutError } from "../lib/request-timeout";

const en = createI18n("en").t;
const hi = createI18n("hi").t;
const trpcError = (code: string, message: string) => ({ message, data: { code, httpStatus: code === "INTERNAL_SERVER_ERROR" ? 500 : 400 } });

describe("orders list (spec E2 Native)", () => {
  test("open view asks the server for booking, confirmed and dispatching; closed and cancelled by status", () => {
    expect(listInput("open", "")).toEqual({ limit: 30, openOnly: true });
    expect(listInput("closed", "")).toEqual({ limit: 30, status: "closed" });
    expect(listInput("cancelled", "")).toEqual({ limit: 30, status: "cancelled" });
  });

  test("a search term is passed through", () => {
    expect(listInput("open", "KD 4521")).toEqual({ limit: 30, openOnly: true, search: "KD 4521" });
  });

  test("the late chip is the server's lateDays and nothing else", () => {
    expect(lateLabel(18, en)).toBe("Late, 18 days");
    expect(lateLabel(null, en)).toBeNull();
    expect(lateLabel(undefined, en)).toBeNull();
    expect(lateLabel(0, en)).toBeNull();
    expect(lateLabel(18, hi)).not.toBe(lateLabel(18, en));
  });

  test("every status has a tone and a word", () => {
    for (const status of ["booking", "confirmed", "dispatching", "closed", "cancelled"] as const) {
      expect(STATUS_TONE[status]).toBeDefined();
      expect(en(STATUS_KEY[status])).not.toBe(STATUS_KEY[status]);
    }
    expect(STATUS_TONE.cancelled).toBe("red");
    expect(STATUS_TONE.closed).toBe("green");
  });
});

describe("figures are worded, not worked out (worked examples from spec E2)", () => {
  test("grams as kg to the gram, Indian grouping", () => {
    expect(orderKgText(553_500)).toBe("553.500");
    expect(orderKgText(334_400)).toBe("334.400");
    expect(orderKgText(1_280_000)).toBe("1,280.000");
    expect(milliText(12300)).toBe("12.300");
    expect(pcsText(1200)).toBe("1,200");
  });

  test("the eight-figure strip lists ordered, planned, pressed, aged, packed, in stock, dispatched, baki", () => {
    const cells = stripCells({
      orderedG: 540_000,
      orderedPcs: 30,
      plannedG: 100_000,
      pressedG: 50_000,
      agedG: 0,
      packedG: 200_000,
      inStockG: 150_000,
      dispatchedG: 40_000,
      bakiG: 500_000,
      bakiPcs: 28,
      overG: 0,
    });
    expect(cells.map((c) => c.key)).toEqual(["orderedG", "plannedG", "pressedG", "agedG", "packedG", "inStockG", "dispatchedG", "bakiG"]);
    expect(cells[0]).toMatchObject({ kg: "540.000", pcs: "30", open: false });
    expect(cells[7]).toMatchObject({ kg: "500.000", pcs: "28", open: true });
    expect(cells[1]!.pcs).toBeNull();
  });

  test("a settled line shows baki 0 as not open", () => {
    const cells = stripCells({ orderedG: 1, orderedPcs: null, plannedG: 0, pressedG: 0, agedG: 0, packedG: 0, inStockG: 0, dispatchedG: 1, bakiG: 0, bakiPcs: null, overG: 0 });
    expect(cells[7]!.open).toBe(false);
  });
});

describe("confirm blockers become sentences (D11: the server enforces them)", () => {
  test("codes parse", () => {
    expect(parseBlocker("po_number")).toEqual({ kind: "po_number" });
    expect(parseBlocker("no_lines")).toEqual({ kind: "no_lines" });
    expect(parseBlocker("line_2_die_or_tier")).toEqual({ kind: "line", n: 2, problem: "die_or_tier" });
    expect(parseBlocker("line_1_weird")).toEqual({ kind: "unknown", code: "line_1_weird" });
  });

  test("sentences in English and Hindi", () => {
    expect(blockerText("po_number", en)).toBe("Add the PO number.");
    expect(blockerText("line_1_pcs", en)).toBe("Line 1: add pieces");
    expect(blockerText("line_3_die_or_tier", en)).toBe("Line 3: pick a copy or a tier");
    expect(blockerText("line_1_pcs", hi)).not.toBe(blockerText("line_1_pcs", en));
  });

  test("the server's refusal text carries the codes", () => {
    expect(blockersFromMessage("Fill these before confirming: po_number, line_1_pcs, line_2_length")).toEqual(["po_number", "line_1_pcs", "line_2_length"]);
    expect(blockersFromMessage("Something else")).toEqual([]);
    expect(blockersFromMessage(undefined)).toEqual([]);
  });

  test("a refused confirm is shown as one sentence per blocker", () => {
    const lines = orderErrorLines(en, trpcError("BAD_REQUEST", "Fill these before confirming: po_number, line_1_alloy"));
    expect(lines).toEqual(["Add the PO number.", "Line 1: add the alloy"]);
  });

  test("a repeated PO names the PO and the order", () => {
    expect(poRepeatFromMessage("PO 4521 is already on SO-4 for this customer")).toEqual({ po: "4521", code: "SO-4" });
    expect(orderErrorLines(en, trpcError("CONFLICT", "PO 4521 is already on SO-4 for this customer"))).toEqual(["PO 4521 is already on order SO-4."]);
  });

  test("an owned die keeps its owner's name; other server sentences are said from the dictionary, never echoed", () => {
    expect(orderErrorLines(en, trpcError("FORBIDDEN", "This die belongs to KD Extrusion"))).toEqual(["This die belongs to KD Extrusion."]);
    expect(orderErrorLines(en, trpcError("BAD_REQUEST", "SO-4 line 2: 20.000 kg asked, only 12.000 kg is left to plan"))).toEqual(["SO-4 line 2: 20.000 kg asked, only 12.000 kg is left to plan."]);
    expect(orderErrorLines(hi, trpcError("BAD_REQUEST", "SO-4 line 2: 20.000 kg asked, only 12.000 kg is left to plan"))[0]).not.toContain("asked");
    expect(orderErrorLines(en, trpcError("BAD_REQUEST", "Only 12.000 kg is left to plan"))).toEqual([en("native.refusal.unknown")]);
  });

  test("an answer that never came says to check first, never to just retry", () => {
    const lines = orderErrorLines(en, new RequestTimeoutError(60_000));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe(en("native.saveUnsureBody"));
  });

  test("a 5xx or an unknown failure uses the shared wording", () => {
    expect(orderErrorLines(en, trpcError("INTERNAL_SERVER_ERROR", "boom"))).toEqual([en("native.saveUnsureBody")]);
    expect(orderErrorLines(en, trpcError("UNAUTHORIZED", "x"))).toEqual([en("errors.sessionExpired")]);
  });
});

describe("timeline and titles", () => {
  test("audit actions become plain lines", () => {
    expect(timelineLabel({ action: "order.confirm", meta: {} }).key).toBe("orders.timeline.confirm");
    expect(timelineLabel({ action: "plan.release", meta: { number: "PP-4" } })).toEqual({ key: "orders.timeline.planRelease", vars: { number: "PP-4" } });
    expect(timelineLabel({ action: "order.reallocate", meta: { status: "pending", bundles: 3, kgG: 120_000 } })).toEqual({
      key: "orders.timeline.reallocatePending",
      vars: { count: 3, kg: "120.000" },
    });
    expect(timelineLabel({ action: "something.new", meta: null })).toEqual({ key: "orders.timeline.other", vars: { action: "something.new" } });
  });

  test("a die is named by its code then its name", () => {
    expect(dieTitle({ sectionCode: "14701", name: "Patti 1" })).toBe("14701 Patti 1");
    expect(dieTitle({ sectionCode: "14701", name: null, series: "PATTI" })).toBe("14701 PATTI");
    expect(dieTitle({ sectionCode: "14701" })).toBe("14701");
  });
});
