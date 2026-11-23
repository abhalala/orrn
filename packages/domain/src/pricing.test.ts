/** XE-PRICE: price master resolution and the line rate (worked examples in paise). */
import { describe, expect, test } from "bun:test";

import {
  activeRatesOf,
  addDaysYmd,
  computeLineRate,
  conversionKey,
  customerTermKey,
  enquiryOverdue,
  estimateGstPaise,
  lineAmountPaise,
  lmePaisePerKg,
  overrideNeedsApproval,
  priceKey,
  proformaTotals,
  quoteExpired,
  readPricingSettings,
  resolveRate,
  roundDiv,
  spreadByWeight,
  type PriceRateRow,
} from "./pricing";

const row = (over: Partial<PriceRateRow>): PriceRateRow => ({
  id: over.id ?? crypto.randomUUID(),
  kind: "metal",
  key: "nalco",
  paise: 25_000,
  effectiveFrom: "2026-11-01",
  status: "active",
  createdAt: 1,
  ...over,
});

describe("roundDiv", () => {
  test("half up for positives, symmetric for negatives", () => {
    expect(roundDiv(5, 2)).toBe(3);
    expect(roundDiv(4, 2)).toBe(2);
    expect(roundDiv(1, 3)).toBe(0);
    expect(roundDiv(2, 3)).toBe(1);
    expect(roundDiv(-5, 2)).toBe(-3);
    expect(() => roundDiv(1, 0)).toThrow();
  });
});

describe("lmePaisePerKg", () => {
  test("2,500.00 USD/t at Rs 83.50 = Rs 208.75/kg; plus Rs 12/kg premium = 22,075 paise", () => {
    expect(lmePaisePerKg({ usdPerTonneCents: 250_000, inrPerUsdPaise: 8_350, premiumPaisePerKg: 0 })).toBe(20_875);
    expect(lmePaisePerKg({ usdPerTonneCents: 250_000, inrPerUsdPaise: 8_350, premiumPaisePerKg: 1_200 })).toBe(22_075);
  });
  test("rounds half up once: 2,345.67 USD/t at Rs 84.13 = 197.341... -> 19,734 paise", () => {
    // 234_567 × 8_413 = 1_973_412_171 ; / 100_000 = 19_734.12 -> 19_734
    expect(lmePaisePerKg({ usdPerTonneCents: 234_567, inrPerUsdPaise: 8_413, premiumPaisePerKg: 0 })).toBe(19_734);
  });
  test("refuses negative or fractional inputs", () => {
    expect(() => lmePaisePerKg({ usdPerTonneCents: -1, inrPerUsdPaise: 8_350, premiumPaisePerKg: 0 })).toThrow();
    expect(() => lmePaisePerKg({ usdPerTonneCents: 1.5, inrPerUsdPaise: 8_350, premiumPaisePerKg: 0 })).toThrow();
  });
});

describe("keys", () => {
  test("priceKey squeezes and lowers; conversion and customer keys", () => {
    expect(priceKey("  Hard   Anodise ")).toBe("hard anodise");
    expect(conversionKey.default()).toBe("default");
    expect(conversionKey.series(" Domal ")).toBe("series:domal");
    expect(conversionKey.die("d1")).toBe("die:d1");
    expect(customerTermKey("c1", "fixed")).toBe("c1:fixed");
  });
});

describe("resolveRate", () => {
  const rows = [
    row({ id: "a", effectiveFrom: "2026-11-01", paise: 25_000 }),
    row({ id: "b", effectiveFrom: "2026-11-10", paise: 25_500 }),
    row({ id: "c", effectiveFrom: "2026-11-10", paise: 25_600, createdAt: 5 }),
    row({ id: "p", effectiveFrom: "2026-11-12", paise: 30_000, status: "pending" }),
    row({ id: "r", effectiveFrom: "2026-11-13", paise: 31_000, status: "rejected" }),
    row({ id: "f", effectiveFrom: "2026-12-01", paise: 26_000 }),
    row({ id: "lme", key: "lme", effectiveFrom: "2026-11-01", paise: 22_000 }),
  ];
  test("latest active row on or before the date; same day, the later one wins", () => {
    expect(resolveRate(rows, "metal", "nalco", "2026-11-05")?.id).toBe("a");
    expect(resolveRate(rows, "metal", "nalco", "2026-11-10")?.id).toBe("c");
    expect(resolveRate(rows, "metal", "nalco", "2026-11-30")?.id).toBe("c");
    expect(resolveRate(rows, "metal", "nalco", "2026-12-01")?.id).toBe("f");
  });
  test("until a change is approved the old rate applies (pending and rejected never apply)", () => {
    expect(resolveRate(rows, "metal", "nalco", "2026-11-14")?.paise).toBe(25_600);
  });
  test("before the first rate, or for another key, nothing", () => {
    expect(resolveRate(rows, "metal", "nalco", "2026-10-31")).toBeNull();
    expect(resolveRate(rows, "metal", "manual", "2026-11-30")).toBeNull();
    expect(resolveRate(rows, "conversion", "nalco", "2026-11-30")).toBeNull();
  });
  test("activeRatesOf: one current row per key", () => {
    const fin = [
      row({ kind: "finish", key: "anodise", paise: 1_500 }),
      row({ kind: "finish", key: "anodise", paise: 1_800, effectiveFrom: "2026-11-05" }),
      row({ kind: "finish", key: "pvd", paise: 4_000 }),
      row({ kind: "finish", key: "powder", paise: 2_000, status: "pending" }),
    ];
    expect(activeRatesOf(fin, "finish", "2026-11-06").map((r) => [r.key, r.paise])).toEqual([
      ["anodise", 1_800],
      ["pvd", 4_000],
    ]);
  });
});

describe("readPricingSettings", () => {
  test("defaults and checks", () => {
    expect(readPricingSettings(undefined)).toEqual({ metalSource: "nalco", estimatedGstBp: 1800, quoteValidDays: 15 });
    expect(readPricingSettings({ metalSource: "lme", estimatedGstBp: 1200, quoteValidDays: 7 })).toEqual({ metalSource: "lme", estimatedGstBp: 1200, quoteValidDays: 7 });
    expect(readPricingSettings({ metalSource: "gold", estimatedGstBp: -1, quoteValidDays: 0 })).toEqual({ metalSource: "nalco", estimatedGstBp: 1800, quoteValidDays: 15 });
  });
});

const metal = { source: "nalco" as const, paisePerKg: 25_000, rateDate: "2026-11-01", rateId: "m1" };
const conversion = { paisePerKg: 4_500, from: "default" as const, rateId: "c1" };

describe("computeLineRate", () => {
  test("metal 250 + conversion 45 + 6061 surcharge 8 + anodise 18 = Rs 321/kg", () => {
    const out = computeLineRate({
      rateDate: "2026-11-15",
      metal,
      conversion,
      alloy: { alloy: "6061", paisePerKg: 800, rateId: "a1" },
      finish: { finish: "anodise", paisePerKg: 1_800, rateId: "f1" },
      kgG: 1_000_000,
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.breakup.computedPaisePerKg).toBe(32_100);
    expect(out.breakup.finalPaisePerKg).toBe(32_100);
    expect(out.breakup).toMatchObject({ v: 1, rateDate: "2026-11-15", metal: { source: "nalco", rateId: "m1", lme: null }, alloy: { alloy: "6061" }, finish: { finish: "anodise" }, override: null });
  });

  test("add-ons per kg: 500 pcs × Rs 2 cutting + Rs 600 packing on 1,234.5 kg = 1.296... -> 130 paise/kg", () => {
    const out = computeLineRate({
      rateDate: "2026-11-15",
      metal,
      conversion,
      components: [
        { key: "cutting", label: "Cutting", basis: "piece", paise: 200, qty: 500, totalPaise: 100_000, rateId: "k1" },
        { key: "packing", label: "Packing", basis: "order", paise: 60_000, qty: 1, totalPaise: 60_000, rateId: "k2" },
      ],
      kgG: 1_234_500,
    });
    if (!out.ok) throw new Error("expected ok");
    // 160_000 paise × 1000 / 1_234_500 g = 129.6 -> 130
    expect(out.breakup.componentsPaisePerKg).toBe(130);
    expect(out.breakup.computedPaisePerKg).toBe(25_000 + 4_500 + 130);
  });

  test("a customer discount comes off the sum; never below zero", () => {
    const a = computeLineRate({ rateDate: "2026-11-15", metal, conversion, discountPaisePerKg: 1_000, kgG: 1000 });
    if (!a.ok) throw new Error("expected ok");
    expect(a.breakup.computedPaisePerKg).toBe(28_500);
    expect(a.breakup.discountPaisePerKg).toBe(1_000);
    const b = computeLineRate({ rateDate: "2026-11-15", metal, conversion, discountPaisePerKg: 99_999, kgG: 1000 });
    if (!b.ok) throw new Error("expected ok");
    expect(b.breakup.computedPaisePerKg).toBe(0);
  });

  test("a customer's fixed rate replaces the sum (the parts stay on record)", () => {
    const out = computeLineRate({ rateDate: "2026-11-15", metal, conversion, fixedPaisePerKg: 30_000, discountPaisePerKg: 500, kgG: 1000 });
    if (!out.ok) throw new Error("expected ok");
    expect(out.breakup).toMatchObject({ fixedPaisePerKg: 30_000, computedPaisePerKg: 30_000, discountPaisePerKg: 0, metal: { paisePerKg: 25_000 } });
  });

  test("an override becomes the final rate; the computed one stays beside it", () => {
    const out = computeLineRate({
      rateDate: "2026-11-15",
      metal,
      conversion,
      kgG: 1000,
      override: { ratePaise: 28_000, reason: "Old customer", rateId: "o1", approvalId: "ap1", approvedBy: "u2", requestedBy: "u1" },
    });
    if (!out.ok) throw new Error("expected ok");
    expect(out.breakup.computedPaisePerKg).toBe(29_500);
    expect(out.breakup.finalPaisePerKg).toBe(28_000);
    expect(out.breakup.override).toMatchObject({ approvalId: "ap1", approvedBy: "u2" });
  });

  test("names what is missing", () => {
    expect(computeLineRate({ rateDate: "2026-11-15", metal: null, conversion: null, kgG: 0 })).toEqual({ ok: false, missing: ["metal", "conversion", "weight"] });
    expect(computeLineRate({ rateDate: "2026-11-15", metal, conversion: null, kgG: 5 })).toEqual({ ok: false, missing: ["conversion"] });
  });

  test("an LME base keeps its inputs in the snapshot", () => {
    const lme = { usdPerTonneCents: 250_000, inrPerUsdPaise: 8_350, premiumPaisePerKg: 1_200 };
    const out = computeLineRate({ rateDate: "2026-11-15", metal: { source: "lme", paisePerKg: lmePaisePerKg(lme), rateDate: "2026-11-14", rateId: "l1", lme }, conversion, kgG: 1000 });
    if (!out.ok) throw new Error("expected ok");
    expect(out.breakup.metal).toEqual({ source: "lme", paisePerKg: 22_075, rateDate: "2026-11-14", rateId: "l1", lme });
    expect(out.breakup.finalPaisePerKg).toBe(26_575);
  });
});

describe("overrideNeedsApproval", () => {
  test("only below the computed rate", () => {
    expect(overrideNeedsApproval(30_000, 29_999)).toBe(true);
    expect(overrideNeedsApproval(30_000, 30_000)).toBe(false);
    expect(overrideNeedsApproval(30_000, 31_000)).toBe(false);
  });
});

describe("spreadByWeight", () => {
  test("parts add up exactly; largest remainder; zero-weight lines carry nothing", () => {
    expect(spreadByWeight(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(spreadByWeight(1000, [3000, 1000])).toEqual([750, 250]);
    expect(spreadByWeight(10, [0, 5])).toEqual([0, 10]);
    expect(spreadByWeight(0, [1, 2])).toEqual([0, 0]);
    const parts = spreadByWeight(99_999, [1_234_567, 7, 98_765]);
    expect(parts.reduce((s, v) => s + v, 0)).toBe(99_999);
  });
});

describe("amounts and GST", () => {
  test("1,234.567 kg at Rs 321/kg = Rs 3,96,296.01; 18 % estimated GST", () => {
    expect(lineAmountPaise(1_234_567, 32_100)).toBe(39_629_601); // 39_629_600.7 -> 601
    expect(estimateGstPaise(39_629_601, 1800)).toBe(7_133_328); // 7_133_328.18
    expect(proformaTotals([{ kgG: 1_234_567, paisePerKg: 32_100 }], 1800)).toEqual({ subtotalPaise: 39_629_601, gstBp: 1800, gstPaise: 7_133_328, totalPaise: 46_762_929 });
  });
  test("totals add an extra charge before GST", () => {
    expect(proformaTotals([{ kgG: 1000, paisePerKg: 10_000 }], 1000, 5_000)).toEqual({ subtotalPaise: 15_000, gstBp: 1000, gstPaise: 1_500, totalPaise: 16_500 });
  });
});

describe("dates and states", () => {
  test("addDaysYmd crosses months and years", () => {
    expect(addDaysYmd("2026-11-22", 15)).toBe("2026-12-07");
    expect(addDaysYmd("2026-12-25", 10)).toBe("2027-01-04");
  });
  test("enquiry overdue only while open and the follow-up is before today", () => {
    expect(enquiryOverdue({ status: "open", followUpDate: "2026-11-21" }, "2026-11-22")).toBe(true);
    expect(enquiryOverdue({ status: "quoted", followUpDate: "2026-11-21" }, "2026-11-22")).toBe(true);
    expect(enquiryOverdue({ status: "open", followUpDate: "2026-11-22" }, "2026-11-22")).toBe(false);
    expect(enquiryOverdue({ status: "won", followUpDate: "2026-11-01" }, "2026-11-22")).toBe(false);
    expect(enquiryOverdue({ status: "open", followUpDate: null }, "2026-11-22")).toBe(false);
  });
  test("quote expired after its valid-until date while draft or sent", () => {
    expect(quoteExpired({ status: "sent", validUntil: "2026-11-21" }, "2026-11-22")).toBe(true);
    expect(quoteExpired({ status: "sent", validUntil: "2026-11-22" }, "2026-11-22")).toBe(false);
    expect(quoteExpired({ status: "converted", validUntil: "2026-11-01" }, "2026-11-22")).toBe(false);
  });
});
