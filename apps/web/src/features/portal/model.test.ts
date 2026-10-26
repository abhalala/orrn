import { describe, expect, test } from "bun:test";

import {
  bandPosition,
  castState,
  certCasts,
  chemistryNotes,
  kgPer12ftText,
  kgText,
  newPortalLine,
  portalLineProblems,
  portalErrorKey,
  portalDispatchDay,
  portalLocale,
  portalOrderErrorKey,
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
  const chem = (p: Partial<Parameters<typeof chemistryNotes>[0]["chemistry"]>, casts: number) => ({
    chemistry: { status: "pending" as const, testedBundles: 0, untestedBundles: 0, noCastBundles: 0, failedCasts: 0, ...p },
    castCount: casts,
  });
  const keys = (notes: ReturnType<typeof chemistryNotes>) => notes.map((n) => n.key);

  test("casts named but none tested: chemistry pending", () => {
    expect(keys(chemistryNotes(chem({ status: "pending", untestedBundles: 2 }, 1)))).toEqual(["portal.certificate.chemistryPending"]);
  });
  test("no bundle names a cast: only the missing cast number is said, never 'not tested yet'", () => {
    const notes = chemistryNotes(chem({ status: "pending", untestedBundles: 4, noCastBundles: 4 }, 0));
    expect(notes).toEqual([{ key: "portal.certificate.noCastBundles", vars: { n: 4 } }]);
    expect(chemistryNotes(chem({ status: "pending", untestedBundles: 1, noCastBundles: 1 }, 0))).toEqual([{ key: "portal.certificate.noCastBundlesOne", vars: {} }]);
  });
  test("some tested, some with a cast not yet tested: partial counts only bundles that name a cast", () => {
    expect(chemistryNotes(chem({ status: "partial", testedBundles: 2, untestedBundles: 1 }, 2))).toEqual([
      { key: "portal.certificate.chemistryPartial", vars: { tested: 2, total: 3 } },
    ]);
    // 1 tested, 3 untested of which 2 name no cast: total is the 2 bundles that name a cast.
    expect(chemistryNotes(chem({ status: "partial", testedBundles: 1, untestedBundles: 3, noCastBundles: 2 }, 1))).toEqual([
      { key: "portal.certificate.chemistryPartial", vars: { tested: 1, total: 2 } },
      { key: "portal.certificate.noCastBundles", vars: { n: 2 } },
    ]);
  });
  test("every cast tested: the ready note; bundles without a cast are still counted after it", () => {
    expect(keys(chemistryNotes(chem({ status: "ready", testedBundles: 2 }, 1)))).toEqual(["portal.certificate.chemistryReady"]);
    expect(keys(chemistryNotes(chem({ status: "partial", testedBundles: 2, untestedBundles: 1, noCastBundles: 1 }, 1)))).toEqual([
      "portal.certificate.chemistryReady",
      "portal.certificate.noCastBundlesOne",
    ]);
  });
  test("failed casts are counted in plain words and replace the ready note", () => {
    expect(chemistryNotes(chem({ status: "ready", testedBundles: 3, failedCasts: 2 }, 2))).toEqual([{ key: "portal.certificate.castsFailed", vars: { n: 2 } }]);
    expect(chemistryNotes(chem({ status: "ready", testedBundles: 3, failedCasts: 1 }, 2))).toEqual([{ key: "portal.certificate.castsFailedOne", vars: {} }]);
    expect(keys(chemistryNotes(chem({ status: "partial", testedBundles: 1, untestedBundles: 1, failedCasts: 1 }, 2)))).toEqual([
      "portal.certificate.chemistryPartial",
      "portal.certificate.castsFailedOne",
    ]);
  });
  test("an old (version 1) snapshot without the counts reads as before", () => {
    expect(keys(chemistryNotes({ chemistry: { status: "pending", testedBundles: 0, untestedBundles: 2 }, castCount: 0 }))).toEqual(["portal.certificate.chemistryPending"]);
    expect(keys(chemistryNotes({ chemistry: { status: "ready", testedBundles: 2, untestedBundles: 0 }, castCount: 0 }))).toEqual(["portal.certificate.chemistryReady"]);
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

describe("order errors in the party's words", () => {
  const err = (code: string, message: string) => ({ message, data: { code } });
  test("a die closed while the form was open is said plainly", () => {
    expect(portalOrderErrorKey(err("NOT_FOUND", "Not found"))).toBe("portal.orders.errors.dieClosed");
  });
  test("the server's strict-input sentences map to the party's language", () => {
    expect(portalOrderErrorKey(err("BAD_REQUEST", "Line 2: enter pieces or kg"))).toBe("portal.orders.errors.qty");
    expect(portalOrderErrorKey(err("BAD_REQUEST", JSON.stringify([{ message: "Add at least one line" }])))).toBe("portal.orders.errors.noLines");
    expect(portalOrderErrorKey(err("BAD_REQUEST", JSON.stringify([{ message: "At most 20 lines" }])))).toBe("portal.orders.errors.tooManyLines");
    expect(portalOrderErrorKey(err("BAD_REQUEST", "Line: the plant picks this (copy). Leave it out."))).toBe("portal.orders.errors.plantPicks");
    expect(portalOrderErrorKey(err("BAD_REQUEST", "The plant sets the rate. Send the order without a rate."))).toBe("portal.orders.errors.plantPicks");
    expect(portalOrderErrorKey(err("BAD_REQUEST", JSON.stringify([{ code: "too_big", path: ["lines", 0, "cutLengthMm"], message: "Too big" }])))).toBe("portal.orders.errors.range");
  });
  test("a PO already on another order and a reused save", () => {
    expect(portalOrderErrorKey(err("CONFLICT", "PO 77 is already on another order of this customer"))).toBe("portal.orders.errors.poUsed");
    expect(portalOrderErrorKey(err("CONFLICT", "This save was already used for another order (SO-9). Reload the order screen and save again."))).toBe("portal.orders.errors.reload");
  });
  test("the module being off, a network failure and anything else keep the general words", () => {
    expect(portalOrderErrorKey(err("FORBIDDEN", "That module is not on for this plant"))).toBe("portal.orders.errors.ordersOff");
    expect(portalOrderErrorKey(err("FORBIDDEN", "The party portal is off for this plant"))).toBe("portal.errors.disabled");
    expect(portalOrderErrorKey({ message: "Failed to fetch" })).toBe("errors.network");
    expect(portalOrderErrorKey(err("INTERNAL_SERVER_ERROR", "boom"))).toBe("errors.generic");
    expect(portalErrorKey(err("NOT_FOUND", "x"))).toBe("portal.errors.notFound");
  });
});

describe("dispatch day", () => {
  test("the party reads the server's ship day as a calendar day, in English or Hindi digits-as-Latin", () => {
    expect(portalDispatchDay({ shipDay: { ymd: "2026-10-28" } }, "en")).toBe("28 Oct 2026");
    expect(portalDispatchDay({ shipDay: { ymd: "2026-10-28" } }, "hi")).toContain("28");
    expect(portalDispatchDay({ shipDay: null }, "en")).toBe("");
    expect(portalDispatchDay({}, "en")).toBe("");
  });
});
