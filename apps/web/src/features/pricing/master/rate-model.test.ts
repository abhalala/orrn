import { describe, expect, test } from "bun:test";
import { lmePaisePerKg } from "@orrn/domain";

import {
  buildPropose,
  bpToPercent,
  daysOf,
  emptyForm,
  formFromItem,
  groupByKind,
  hundredths,
  lmeFormFrom,
  lmePreview,
  missingParts,
  percentToBp,
  rateTitle,
  rateUnit,
  type RateItem,
  type RateRow,
} from "./rate-model";

const row = (over: Partial<RateRow> = {}): RateRow => ({ id: "r1", paise: 20_000, effectiveFrom: "2026-11-01", status: "active", detail: {}, ...over });
const item = (over: Partial<RateItem> = {}): RateItem => ({ kind: "metal", key: "nalco", name: null, current: row(), pending: [], upcoming: [], ...over });

describe("typed numbers", () => {
  test("hundredths is exact and rounds half up", () => {
    expect(hundredths("83.50")).toBe(8350);
    expect(hundredths("2,500.5")).toBe(250_050);
    expect(hundredths("0.285")).toBe(29);
    expect(hundredths("1.005")).toBe(101);
    expect(hundredths(".5")).toBe(50);
    for (const bad of ["", "abc", "-1", "1e3", "2,5", "1.2.3"]) expect(hundredths(bad)).toBeNull();
  });

  test("percent and days", () => {
    expect(percentToBp("18")).toBe(1800);
    expect(percentToBp("12.5")).toBe(1250);
    expect(percentToBp("101")).toBeNull();
    expect(bpToPercent(1800)).toBe("18");
    expect(bpToPercent(1250)).toBe("12.5");
    expect(bpToPercent(1205)).toBe("12.05");
    expect(daysOf("15")).toBe(15);
    expect(daysOf("0")).toBeNull();
    expect(daysOf("366")).toBeNull();
    expect(daysOf("1.5")).toBeNull();
  });
});

describe("London metal preview", () => {
  test("matches the server formula as you type", () => {
    const p = lmePreview({ usd: "2500", inr: "83.50", premium: "" });
    expect(p?.paisePerKg).toBe(20_875);
    expect(p?.paisePerKg).toBe(lmePaisePerKg({ usdPerTonneCents: 250_000, inrPerUsdPaise: 8350, premiumPaisePerKg: 0 }));
    expect(lmePreview({ usd: "2500", inr: "83.50", premium: "12.5" })?.paisePerKg).toBe(22_125);
    expect(lmePreview({ usd: "2500", inr: "83.50", premium: "12.5" })?.inputs).toEqual({ usdPerTonneCents: 250_000, inrPerUsdPaise: 8350, premiumPaisePerKg: 1250 });
  });

  test("nothing while a box is empty or wrong", () => {
    expect(lmePreview({ usd: "", inr: "83.5", premium: "" })).toBeNull();
    expect(lmePreview({ usd: "2500", inr: "x", premium: "" })).toBeNull();
    expect(lmePreview({ usd: "0", inr: "83.5", premium: "" })).toBeNull();
    expect(lmePreview({ usd: "2500", inr: "83.5", premium: "-1" })).toBeNull();
  });

  test("a stored row refills the boxes", () => {
    expect(lmeFormFrom({ usdPerTonneCents: 250_000, inrPerUsdPaise: 8350, premiumPaisePerKg: 1250 })).toEqual({ usd: "2500.00", inr: "83.50", premium: "12.50" });
    expect(lmeFormFrom(undefined)).toEqual({ usd: "", inr: "", premium: "" });
  });
});

describe("grouping and names", () => {
  const items: RateItem[] = [
    item({ kind: "conversion", key: "die:s1", name: "A-101" }),
    item({ kind: "conversion", key: "series:domal", current: row({ detail: { series: "Domal" } }) }),
    item({ kind: "conversion", key: "default" }),
    item({ kind: "metal", key: "manual" }),
    item({ kind: "metal", key: "nalco" }),
    item({ kind: "component", key: "cutting", current: row({ detail: { label: "Cutting", basis: "order", always: true } }) }),
    item({ kind: "customer", key: "c1:discount", name: "KD Extrusion" }),
    item({ kind: "line", key: "x" }),
  ];

  test("every kind has a list, the default conversion comes first, line rows are left out", () => {
    const g = groupByKind(items);
    expect(g.metal.map((i) => i.key)).toEqual(["nalco", "manual"]);
    expect(g.conversion.map((i) => i.key)).toEqual(["default", "series:domal", "die:s1"]);
    expect(g.alloy).toEqual([]);
    expect(g.finish).toEqual([]);
    expect(g.customer).toHaveLength(1);
    expect(Object.values(g).flat()).toHaveLength(7);
  });

  test("titles and units", () => {
    expect(rateTitle(items[0]!)).toEqual({ type: "conversionDie", code: "A-101" });
    expect(rateTitle(items[1]!)).toEqual({ type: "conversionSeries", series: "Domal" });
    expect(rateTitle(items[2]!)).toEqual({ type: "conversionDefault" });
    expect(rateTitle(items[5]!)).toEqual({ type: "plain", text: "Cutting" });
    expect(rateTitle(items[6]!)).toEqual({ type: "customer", name: "KD Extrusion", mode: "discount" });
    expect(rateUnit(items[5]!)).toBe("order");
    expect(rateUnit(items[4]!)).toBe("kg");
  });

  test("a rate that only has a pending change still gets a name and shows no current rate", () => {
    const only = item({ kind: "alloy", key: "6063", current: null, pending: [row({ status: "pending", detail: { alloy: "6063" } })] });
    expect(rateTitle(only)).toEqual({ type: "plain", text: "6063" });
  });

  test("missing parts follow the chosen metal list", () => {
    expect(missingParts([], "nalco")).toEqual(["metal", "conversion"]);
    expect(missingParts([item(), item({ kind: "conversion", key: "default" })], "nalco")).toEqual([]);
    expect(missingParts([item(), item({ kind: "conversion", key: "default" })], "lme")).toEqual(["metal"]);
    expect(missingParts([item({ current: null, pending: [row({ status: "pending" })] })], "nalco")).toEqual(["metal", "conversion"]);
  });
});

describe("building the propose input", () => {
  const withReason = (f: ReturnType<typeof emptyForm>) => ({ ...f, reason: "Nalco revised the list" });

  test("a Nalco metal rate", () => {
    const r = buildPropose(withReason({ ...emptyForm("metal"), metalSource: "nalco", rate: "205.50" }));
    expect(r).toEqual({ ok: true, input: { change: { kind: "metal", source: "nalco", paisePerKg: 20_550 }, reason: "Nalco revised the list" } });
  });

  test("London metal sends the three numbers, never a computed rate", () => {
    const f = withReason({ ...emptyForm("metal"), metalSource: "lme", lme: { usd: "2500", inr: "83.50", premium: "10" }, effectiveFrom: "2026-12-01" });
    expect(buildPropose(f)).toEqual({
      ok: true,
      input: { change: { kind: "metal", source: "lme", lme: { usdPerTonneCents: 250_000, inrPerUsdPaise: 8350, premiumPaisePerKg: 1000 } }, effectiveFrom: "2026-12-01", reason: "Nalco revised the list" },
    });
  });

  test("a reason is required, and every wrong box is named", () => {
    expect(buildPropose({ ...emptyForm("metal"), rate: "200" })).toEqual({ ok: false, errors: { reason: true } });
    expect(buildPropose({ ...emptyForm("metal"), reason: "ab" })).toEqual({ ok: false, errors: { reason: true, rate: true } });
    expect(buildPropose(withReason({ ...emptyForm("metal"), metalSource: "lme" }))).toEqual({ ok: false, errors: { lme: true } });
    expect(buildPropose(withReason({ ...emptyForm("metal"), rate: "200", effectiveFrom: "1 Dec" }))).toEqual({ ok: false, errors: { date: true } });
  });

  test("conversion by scope", () => {
    expect(buildPropose(withReason({ ...emptyForm("conversion"), rate: "40" }))).toMatchObject({ ok: true, input: { change: { kind: "conversion", scope: "default", paisePerKg: 4000 } } });
    expect(buildPropose(withReason({ ...emptyForm("conversion"), scope: "series", rate: "40" }))).toEqual({ ok: false, errors: { series: true } });
    expect(buildPropose(withReason({ ...emptyForm("conversion"), scope: "die", rate: "40" }))).toEqual({ ok: false, errors: { die: true } });
    expect(buildPropose(withReason({ ...emptyForm("conversion"), scope: "die", sectionId: "s1", rate: "40" }))).toMatchObject({
      ok: true,
      input: { change: { scope: "die", sectionId: "s1" } },
    });
  });

  test("alloy, finish, add-on and customer terms", () => {
    expect(buildPropose(withReason({ ...emptyForm("alloy"), alloy: " 6063 ", rate: "3" }))).toMatchObject({ input: { change: { kind: "alloy", alloy: "6063", paisePerKg: 300 } } });
    expect(buildPropose(withReason({ ...emptyForm("finish"), finish: "", rate: "3" }))).toEqual({ ok: false, errors: { finish: true } });
    expect(buildPropose(withReason({ ...emptyForm("component"), label: "Cutting", basis: "order", always: true, rate: "150" }))).toMatchObject({
      input: { change: { kind: "component", label: "Cutting", basis: "order", always: true, paise: 15_000 } },
    });
    expect(buildPropose(withReason({ ...emptyForm("customer"), rate: "2" }))).toEqual({ ok: false, errors: { customer: true } });
    expect(buildPropose(withReason({ ...emptyForm("customer"), customerId: "c1", mode: "fixed", rate: "250" }))).toMatchObject({
      input: { change: { kind: "customer", customerId: "c1", mode: "fixed", paisePerKg: 25_000 } },
    });
  });

  test("change rate on a row keeps its key", () => {
    const f = formFromItem(item({ kind: "customer", key: "c9:discount", name: "KD" }), "nalco");
    expect(f).toMatchObject({ kind: "customer", customerId: "c9", mode: "discount", rate: "" });
    const g = formFromItem(item({ kind: "conversion", key: "die:s7", name: "A-7" }), "nalco");
    expect(g).toMatchObject({ scope: "die", sectionId: "s7" });
    const l = formFromItem(item({ key: "lme", current: row({ detail: { usdPerTonneCents: 250_000, inrPerUsdPaise: 8350, premiumPaisePerKg: 0 } }) }), "nalco");
    expect(l).toMatchObject({ metalSource: "lme", lme: { usd: "2500.00", inr: "83.50", premium: "0.00" } });
  });
});
