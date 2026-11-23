import { describe, expect, test } from "bun:test";

import { defaultValidUntil, draftFromQuoteLine, lineComplete, lineProblems, lineRatePaise, newQuoteLine, prefillFromEnquiry, previewRequest, pricesByDraft, quoteTotals, toQuoteLineInput, validityProblem, type LinePrice, type QuoteLineDraft } from "./quote-model";

const breakup = (computed: number) => ({ computedPaisePerKg: computed, finalPaisePerKg: computed, components: [] }) as never;
const priced = (computed: number): LinePrice => ({ ok: true, breakup: breakup(computed) });

function line(p: Partial<QuoteLineDraft> = {}): QuoteLineDraft {
  return { ...newQuoteLine("k"), die: { id: "s1", label: "12170" }, mm: "3658", kgText: "100", ...p };
}

describe("quote line model", () => {
  test("a blank line is incomplete and says what is missing", () => {
    const p = lineProblems(newQuoteLine("k"), "mm", null);
    expect(p.die).toBeDefined();
    expect(p.length).toBeDefined();
    expect(p.kg).toBeDefined();
  });
  test("a complete line has no problems", () => {
    expect(lineComplete(line(), "mm")).toBe(true);
    expect(lineProblems(line(), "mm", 25000)).toEqual({});
  });
  test("pieces are optional but must be whole", () => {
    expect(lineProblems(line({ pcsText: "2.5" }), "mm", null).pcs).toBeDefined();
    expect(lineProblems(line({ pcsText: "" }), "mm", null).pcs).toBeUndefined();
  });
  test("a rate below the master is a problem, above or equal is not", () => {
    expect(lineProblems(line({ rate: "200" }), "mm", 25000).rate).toBe("price.quotes.form.errors.rateLow");
    expect(lineProblems(line({ rate: "260" }), "mm", 25000).rate).toBeUndefined();
    expect(lineProblems(line({ rate: "abc" }), "mm", 25000).rate).toBe("orders.form.errors.rate");
  });
  test("grams go to the server; pieces are never worked out from kg", () => {
    const i = toQuoteLineInput(line({ kgText: "52.44" }), "mm", 25000);
    expect(i.kgG).toBe(52_440);
    expect(i.cutLengthMm).toBe(3658);
    expect("pcs" in i).toBe(false);
    expect(i.finish).toBeNull();
  });
  test("a rate is sent only when above the master's", () => {
    expect("ratePaise" in toQuoteLineInput(line({ rate: "250" }), "mm", 25000)).toBe(false);
    expect(toQuoteLineInput(line({ rate: "260.5" }), "mm", 25000).ratePaise).toBe(26050);
    expect("ratePaise" in toQuoteLineInput(line({ rate: "" }), "mm", 25000)).toBe(false);
  });
  test("finish none is sent as null, anodise as itself", () => {
    expect(toQuoteLineInput(line({ finish: "anodise" }), "mm", null).finish).toBe("anodise");
  });
  test("an incomplete line throws", () => {
    expect(() => toQuoteLineInput(newQuoteLine("k"), "mm", null)).toThrow();
  });
});

describe("preview and totals", () => {
  test("only lines with a section and weight are asked, and answers go back to their draft", () => {
    const drafts = [newQuoteLine("a"), line({ key: "b" }), line({ key: "c", kgText: "10" })];
    const req = previewRequest(drafts);
    expect(req.lines).toHaveLength(2);
    expect(req.slot).toEqual([null, 0, 1]);
    const by = pricesByDraft(req.slot, [priced(100), priced(200)]);
    expect(by[0]).toBeUndefined();
    expect(by[1]).toEqual(priced(100));
    expect(by[2]).toEqual(priced(200));
  });
  test("the shown rate is the typed one only when above the master's", () => {
    expect(lineRatePaise(line({ rate: "300" }), priced(25000))).toBe(30000);
    expect(lineRatePaise(line({ rate: "100" }), priced(25000))).toBe(25000);
    expect(lineRatePaise(line(), undefined)).toBeNull();
  });
  test("totals add weight of every line and amount of the priced ones", () => {
    const drafts = [line({ kgText: "100" }), line({ kgText: "50" }), line({ kgText: "10" })];
    const t = quoteTotals(drafts, [priced(25000), { ok: false, missing: ["metal"] }, undefined]);
    expect(t).toEqual({ lines: 3, priced: 1, missing: 1, kgG: 160_000, amountPaise: 2_500_000 });
  });
  test("validity starts at the quote date plus the plant's days", () => {
    expect(defaultValidUntil("2026-11-22", 15)).toBe("2026-12-07");
    expect(validityProblem("2026-11-22", "2026-11-21")).toBe("price.quotes.form.errors.validBefore");
    expect(validityProblem("2026-11-22", "")).toBe("price.quotes.form.errors.validUntil");
    expect(validityProblem("2026-11-22", "2026-11-22")).toBeNull();
  });
});

describe("saved lines and enquiries", () => {
  test("a saved line keeps a rate as typed only when it was above the master's", () => {
    const base = { dieId: "s1", sectionCode: "12170", sectionName: null, cutLengthMm: 3658, pcs: null, kgG: 52_440, finish: "pvd", alloy: "6063", temper: "T5", note: null };
    const above = draftFromQuoteLine("k", { ...base, ratePaise: 26000, priceBreakup: breakup(25000) }, "mm");
    expect(above.rate).toBe("260.00");
    expect(above.kgText).toBe("52.440");
    expect(above.finish).toBe("pvd");
    const same = draftFromQuoteLine("k", { ...base, ratePaise: 25000, priceBreakup: breakup(25000) }, "mm");
    expect(same.rate).toBe("");
  });
  test("an enquiry fills the customer, section and kg it has", () => {
    const p = prefillFromEnquiry({ customerId: "c1", customerName: "Shah", sectionId: "s9", sectionCode: "12999", kgG: 2_000 }, "k");
    expect(p.customer).toEqual({ id: "c1", label: "Shah" });
    expect(p.line.die).toEqual({ id: "s9", label: "12999" });
    expect(p.line.kgText).toBe("2.000");
    expect(prefillFromEnquiry({ customerId: null, customerName: null, sectionId: null, sectionCode: null, kgG: null }, "k").customer).toBeNull();
  });
});
