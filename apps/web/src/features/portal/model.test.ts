import { describe, expect, test } from "bun:test";

import {
  bandPosition,
  castState,
  certCasts,
  chemistryNote,
  kgPer12ftText,
  kgText,
  newPortalLine,
  portalLineProblems,
  portalLocale,
  portalOrderBody,
  ppmPercentText,
  requestIdFor,
  sectionMarker,
  sectionTitle,
  PORTAL_MAX_LINES,
} from "./model";

describe("figures", () => {
  test("kg is written to the gram with Indian grouping; kg/12ft to three decimals", () => {
    expect(kgText(1_300_000)).toBe("1,300.000");
    expect(kgText(553_500)).toBe("553.500");
    expect(kgPer12ftText(14_701)).toBe("14.701");
    expect(kgPer12ftText(6_240)).toBe("6.240");
  });
  test("ppm reads as the lab percent", () => {
    expect(ppmPercentText(4500)).toBe("0.450");
    expect(ppmPercentText(null)).toBe("-");
  });
});

describe("dies", () => {
  test("band position: over by the excess, under by the gap, in inside", () => {
    const band = { minG: 5_900, maxG: 6_100 };
    expect(bandPosition(6_240, band)).toEqual({ position: "over", offG: 140 });
    expect(bandPosition(5_850, band)).toEqual({ position: "under", offG: 50 });
    expect(bandPosition(5_967, band)).toEqual({ position: "in", offG: 0 });
    expect(bandPosition(null, band)).toBeNull();
    expect(bandPosition(6_000, null)).toBeNull();
  });
  test("owned beats granted as the marker", () => {
    expect(sectionMarker({ owned: true, granted: true })).toBe("owned");
    expect(sectionMarker({ owned: false, granted: true })).toBe("granted");
    expect(sectionMarker({ owned: false, granted: false })).toBeNull();
    expect(sectionTitle({ series: "Domal", sectionCode: "12170" })).toBe("Domal 12170");
  });
});

describe("certificate", () => {
  test("chemistry note by status", () => {
    expect(chemistryNote({ status: "pending", testedBundles: 0, untestedBundles: 2 }).key).toBe("portal.certificate.chemistryPending");
    expect(chemistryNote({ status: "partial", testedBundles: 1, untestedBundles: 1 })).toEqual({
      key: "portal.certificate.chemistryPartial",
      vars: { tested: 1, total: 2 },
    });
    expect(chemistryNote({ status: "ready", testedBundles: 2, untestedBundles: 0 }).key).toBe("portal.certificate.chemistryReady");
  });
  test("a version 1 snapshot has no casts", () => {
    expect(certCasts({})).toEqual([]);
    const base = { castNo: "K31", alloy: "6063", bundles: 1, pcs: 1, weightG: 1, sectionCodes: ["14701"], alBalance: true };
    expect(certCasts({ casts: [{ ...base, status: "pending", verdict: null, elements: [] }] })).toHaveLength(1);
  });
  test("a cast with no figures is pending, a failed cast says failed, a tested one shows its chemistry", () => {
    const el = [{ element: "si", ppm: 4500, pct: "0.450" }];
    expect(castState({ status: "pending", elements: [] })).toBe("pending");
    expect(castState({ status: "tested", elements: [] })).toBe("pending");
    expect(castState({ status: "failed", elements: el })).toBe("failed");
    expect(castState({ status: "tested", elements: el })).toBe("tested");
  });
});

describe("locale", () => {
  test("a saved choice wins, then the plant's party locale, then what is showing", () => {
    expect(portalLocale("en", "hi", "en")).toBe("en");
    expect(portalLocale(null, "hi", "en")).toBe("hi");
    expect(portalLocale(null, undefined, "gu")).toBe("gu");
  });
});

describe("new order", () => {
  const line = (patch: Partial<ReturnType<typeof newPortalLine>>) => ({ ...newPortalLine("a"), sectionId: "die-1", ...patch });

  test("inch plant: feet and inches become mm; pieces go as typed, no kg, no rate", () => {
    const body = portalOrderBody({ po: " PO-7 ", note: "", lines: [line({ feet: "12", qty: "200" })] }, "inch");
    expect(body).toEqual({ poNumber: "PO-7", lines: [{ sectionId: "die-1", cutLengthMm: 3658, pcs: 200 }] });
    expect(JSON.stringify(body)).not.toMatch(/rate|price/i);
  });
  test("mm plant: mm as typed; kg goes as grams", () => {
    const body = portalOrderBody({ po: "", note: "urgent", lines: [line({ mm: "3000", basis: "kg", qty: "553.5", note: " anodised " })] }, "mm");
    expect(body).toEqual({ note: "urgent", lines: [{ sectionId: "die-1", cutLengthMm: 3000, kgG: 553_500, note: "anodised" }] });
  });
  test("an incomplete line blocks the whole body and names what is missing", () => {
    const bad = line({ sectionId: "", feet: "", qty: "" });
    expect(portalOrderBody({ po: "", note: "", lines: [bad] }, "inch")).toBeNull();
    expect(portalLineProblems(bad, "inch")).toEqual({
      section: "portal.orders.errors.section",
      length: "portal.orders.errors.length",
      qty: "portal.orders.errors.qty",
    });
    expect(portalLineProblems(line({ feet: "12", qty: "2.5" }), "inch")).toEqual({ qty: "portal.orders.errors.qty" });
  });
  test("at most 20 lines and at least one", () => {
    const many = Array.from({ length: PORTAL_MAX_LINES + 1 }, (_, i) => line({ key: `k${i}`, feet: "12", qty: "1" }));
    expect(portalOrderBody({ po: "", note: "", lines: many }, "inch")).toBeNull();
    expect(portalOrderBody({ po: "", note: "", lines: many.slice(0, PORTAL_MAX_LINES) }, "inch")?.lines).toHaveLength(PORTAL_MAX_LINES);
    expect(portalOrderBody({ po: "", note: "", lines: [] }, "inch")).toBeNull();
  });
  test("a retry of the same form reuses the request id; an edit gets a new one", () => {
    let n = 0;
    const make = () => `id-${(n += 1)}`;
    const first = requestIdFor(null, { a: 1 }, make);
    expect(requestIdFor(first, { a: 1 }, make)).toBe(first);
    expect(requestIdFor(first, { a: 2 }, make).id).toBe("id-2");
  });
});
