import { describe, expect, test } from "bun:test";
import { createI18n } from "@orrn/i18n";

import { orderErrorLines, orderErrorText } from "./errors";

const en = createI18n("en").t;
const hi = createI18n("hi").t;
const gu = createI18n("gu").t;
const err = (code: string, message: string) => ({ message, data: { code } });

describe("orderErrorLines", () => {
  test("confirm blockers become one sentence each", () => {
    expect(orderErrorLines(en, err("BAD_REQUEST", "Fill these before confirming: po_number, line_1_pcs"))).toEqual([
      "Add the PO number.",
      "Line 1: add pieces",
    ]);
  });

  test("a repeated PO is worded in the plant's language", () => {
    expect(orderErrorText(en, err("CONFLICT", "PO PO-4471 is already on SO-1 for this customer"))).toBe("PO PO-4471 is already on order SO-1.");
  });

  test("a plain server sentence is worded in the plant's language; an unknown one is never shown (BACKLOG 48)", () => {
    expect(orderErrorText(en, err("BAD_REQUEST", "Nothing is left to plan on SO-4 line 1"))).toBe(en("refusal.nothingLeftToPlan", { order: "SO-4", n: "1" }));
    expect(orderErrorText(hi, err("BAD_REQUEST", "Nothing is left to plan on SO-4 line 1"))).toBe(hi("refusal.nothingLeftToPlan", { order: "SO-4", n: "1" }));
    for (const t of [en, hi, gu]) {
      expect(orderErrorText(t, err("BAD_REQUEST", "Some new English sentence the server learnt"))).toBe(t("refusal.unknown"));
      expect(orderErrorText(t, err("CONFLICT", "Brand new conflict"))).toBe(t("errors.conflict"));
    }
  });

  test("the refusals a line edit or a plan can meet are worded in the plant's language (review I-1, m-8)", () => {
    expect(orderErrorText(en, err("FORBIDDEN", "This die belongs to KD Extrusion"))).toBe("This die belongs to KD Extrusion.");
    expect(orderErrorText(hi, err("FORBIDDEN", "This die belongs to KD Extrusion"))).toBe(hi("refusal.owned", { name: "KD Extrusion" }));
    expect(
      orderErrorText(en, err("BAD_REQUEST", "Line 1, 2 is on a released press plan; its kg, pieces, length and section can't change now")),
    ).toBe("Line 1, 2 is on a released press plan. Its kg, pieces, length and die can't change now.");
    expect(orderErrorText(en, err("BAD_REQUEST", "1,200.000 kg is already dispatched on line 2, more than the new 1,100.000 kg"))).toBe(
      "Line 2: 1,200.000 kg is already dispatched, more than the new 1,100.000 kg.",
    );
  });

  test("a lost request reads as a network problem", () => {
    expect(orderErrorText(en, new Error("Failed to fetch"))).toBe(en("errors.network"));
  });
});

describe("hold and release refusals (FP-OP-17)", () => {
  test("each server sentence is read in the reader's language, in all three", () => {
    const cases: [string, string, Record<string, string>][] = [
      ["26J101 is on dispatch D-00412; take it off the dispatch first", "onDispatch", { serial: "26J101", code: "D-00412" }],
      ["26J101 is already held for SO-14 line 2 (Shree Traders). Release it first.", "heldFor", { serial: "26J101", order: "SO-14", n: "2" }],
      ["26J101 is on SO-9 line 1; move it with Reallocate instead", "onOtherOrder", { serial: "26J101" }],
      ["26J101 is a different die from that line", "diffDie", { serial: "26J101" }],
      ["26J101 is dispatched; only bundles in the yard can be held", "holdNotAvailable", { serial: "26J101" }],
      ["SO-14 is closed; hold stock for an open order", "holdOrderClosed", { order: "SO-14", status: "Closed" }],
      ["26J101, 26J102 are not held for SO-14 line 2", "notHeldFor", { serials: "26J101, 26J102", order: "SO-14", n: "2" }],
      ["A bundle or the order changed meanwhile. Reload and try again.", "changed", {}],
    ];
    for (const t of [en, hi, gu]) {
      for (const [message, id, vars] of cases) {
        const said = orderErrorText(t, err("BAD_REQUEST", message));
        expect(said).not.toBe(t("refusal.unknown"));
        expect(said).not.toContain("meanwhile");
        if (t === en) expect(said).toBe(t(`refusal.${id}` as never, id === "holdOrderClosed" ? { ...vars, status: t("orders.status.closed") } : vars));
      }
    }
  });
});
