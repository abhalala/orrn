import { describe, expect, test } from "bun:test";

import { buildPoInput, checkLine, draftLineTotal, draftsFromIndent, draftsFromPo, draftTotals, emptyLine, isDay, poActions, poTone, type HeaderDraft, type LineDraft } from "./po-model";
import type { StoreUnit } from "@/features/store/store-qty";

const UNITS: Record<string, StoreUnit> = { flux: "kg", gas: "litre", valve: "piece" };
const unitOf = (id: string) => UNITS[id] ?? null;
const line = (patch: Partial<LineDraft>): LineDraft => ({ ...emptyLine("l1"), ...patch });
const header: HeaderDraft = { vendorId: "v1", deliveryDate: "", terms: "", note: "" };

describe("checkLine", () => {
  test("reads quantity, rate and GST exactly", () => {
    const r = checkLine(line({ itemId: "flux", qty: "1.005", rate: "84.505", gst: "18" }), unitOf);
    expect(r).toEqual({ ok: true, line: { itemId: "flux", qtyMilli: 1005, ratePaise: 8451, gstBp: 1800 } });
  });
  test("names each box that is wrong", () => {
    const r = checkLine(line({ itemId: null, qty: "", rate: "", gst: "40" }), unitOf);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems).toEqual({ item: true, qty: "empty", rate: true, gst: true });
  });
  test("a piece item takes whole numbers only", () => {
    const r = checkLine(line({ itemId: "valve", qty: "2.5", rate: "10", gst: "18" }), unitOf);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems.qty).toBe("whole");
  });
  test("a rate of zero is allowed, an unreadable one is not", () => {
    expect(checkLine(line({ itemId: "gas", qty: "10", rate: "0", gst: "0" }), unitOf).ok).toBe(true);
    expect(checkLine(line({ itemId: "gas", qty: "10", rate: "abc", gst: "0" }), unitOf).ok).toBe(false);
  });
});

describe("buildPoInput", () => {
  const good = line({ itemId: "flux", qty: "10", rate: "84.50", gst: "18" });
  test("sends every header field, empty ones as null", () => {
    const r = buildPoInput(header, [good], unitOf);
    expect(r).toEqual({
      ok: true,
      input: { vendorId: "v1", deliveryDate: null, terms: null, note: null, lines: [{ itemId: "flux", qtyMilli: 10_000, ratePaise: 8450, gstBp: 1800 }] },
    });
  });
  test("trims text and keeps a real delivery day", () => {
    const r = buildPoInput({ vendorId: "v1", deliveryDate: "2026-11-05", terms: "  30 days ", note: " " }, [good], unitOf);
    expect(r.ok && r.input).toMatchObject({ deliveryDate: "2026-11-05", terms: "30 days", note: null });
  });
  test("refuses a missing vendor, a bad date, no lines", () => {
    const r = buildPoInput({ ...header, vendorId: null, deliveryDate: "2026-02-30" }, [], unitOf);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems).toMatchObject({ vendor: true, date: true, noLines: true });
  });
  test("marks the second line of the same item", () => {
    const r = buildPoInput(header, [good, { ...good, key: "l2" }], unitOf);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems.lines).toEqual({ l2: { twice: true } });
  });
  test("a line whose quantity times rate is too large is marked", () => {
    const r = buildPoInput(header, [line({ itemId: "flux", qty: "99999", rate: "9999999", gst: "0" })], unitOf);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems.lines.l1?.large).toBe(true);
  });
});

describe("totals", () => {
  test("add the lines that parse and skip a half typed one", () => {
    const rows = [
      line({ itemId: "flux", qty: "10", rate: "100", gst: "18" }),
      { ...line({ itemId: "gas", qty: "", rate: "5", gst: "18" }), key: "l2" },
    ];
    expect(draftTotals(rows, unitOf)).toEqual({ amountPaise: 100_000, gstPaise: 18_000, totalPaise: 118_000 });
    expect(draftLineTotal(rows[0]!, unitOf)).toBe(118_000);
    expect(draftLineTotal(rows[1]!, unitOf)).toBeNull();
  });
});

describe("drafts from a saved order and from an indent", () => {
  test("a saved line comes back as the text that makes it", () => {
    const [d] = draftsFromPo([{ itemId: "flux", qtyMilli: 1_250, ratePaise: 8450, gstBp: 1250 }]);
    expect(d).toMatchObject({ itemId: "flux", qty: "1.25", rate: "84.50", gst: "12.5" });
    expect(checkLine(d!, unitOf)).toEqual({ ok: true, line: { itemId: "flux", qtyMilli: 1_250, ratePaise: 8450, gstBp: 1250 } });
  });
  test("an indent line keeps the quantity and leaves the rate to fill", () => {
    const [d] = draftsFromIndent([{ itemId: "gas", qtyMilli: 5_000 }]);
    expect(d).toMatchObject({ itemId: "gas", qty: "5", rate: "", gst: "18" });
  });
});

describe("isDay", () => {
  test("only a real YYYY-MM-DD", () => {
    expect(isDay("2026-11-05")).toBe(true);
    expect(isDay("2026-02-30")).toBe(false);
    expect(isDay("05/11/2026")).toBe(false);
  });
});

describe("actions by status", () => {
  test("a draft can be changed, sent and cancelled", () => {
    expect(poActions("draft", false, true)).toEqual({ edit: true, send: true, closeShort: false, cancel: true, print: true });
  });
  test("a sent order with nothing in can be cancelled; with goods in it cannot", () => {
    expect(poActions("issued", false, true).cancel).toBe(true);
    expect(poActions("issued", true, true).cancel).toBe(false);
  });
  test("only a part received order closes short", () => {
    expect(poActions("part_received", true, true)).toEqual({ edit: false, send: false, closeShort: true, cancel: false, print: true });
    expect(poActions("closed", true, true)).toEqual({ edit: false, send: false, closeShort: false, cancel: false, print: true });
  });
  test("a reader without po.manage may only print", () => {
    expect(poActions("draft", false, false)).toEqual({ edit: false, send: false, closeShort: false, cancel: false, print: true });
  });
  test("every status has a tone", () => {
    expect(["draft", "issued", "part_received", "closed", "cancelled"].map(poTone)).toEqual(["neutral", "blue", "amber", "green", "neutral"]);
  });
});
