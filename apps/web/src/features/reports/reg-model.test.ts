import { describe, expect, test } from "bun:test";

import { en, type MessageKey } from "@orrn/i18n/en";

import {
  achievedText,
  collectPages,
  materialGroupText,
  materialsCsv,
  planActualCsv,
  recutsCsv,
  rejectionReason,
  rejectionsCsv,
  unpackedCsv,
  wipCsv,
  type MaterialsData,
  type PlanActualData,
  type RecutRow,
  type RecutsData,
  type RejectionRow,
  type RejectionsData,
  type UnpackedData,
  type WipRow,
} from "./reg-model";
import { parsePlanActualSearch, parseRecutsSearch, parseRegRange, parseRejectionsSearch, parseWipSearch } from "./reg-search";

function t(key: MessageKey, vars: Record<string, unknown> = {}): string {
  const raw = key.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], en);
  if (typeof raw !== "string") throw new Error(`missing ${key}`);
  return raw.replace(/\{(\w+)\}/g, (_, v) => String(vars[v] ?? `{${v}}`));
}

const lines = (csv: string) => csv.trimEnd().split("\n");

describe("rejections CSV", () => {
  const row: RejectionRow = {
    source: "press", id: "q1", day: "2026-11-20", runId: "r1", runNumber: "R-12", sectionId: "s1", sectionCode: "12170", copyCode: "12170-1",
    pressLineId: "p1", pressCode: "P1", shiftId: null, shiftName: "Day", reasonKey: "x", reasonCode: "BLS", reasonLabel: "=Blister", pcs: 4, kgG: 12_500, note: null,
  };
  const totals: RejectionsData["totals"] = { entries: 1, pcs: 4, kgG: 12_500 };
  test("header, a row and the totals row, kg in kg, a formula-like reason written as text", () => {
    const out = lines(rejectionsCsv([row], totals, t));
    expect(out[0]).toBe("Day,Source,Run number,Section,Copy,Press,Shift,Reason,Pieces,Weight kg");
    expect(out[1]).toBe("2026-11-20,Press QC,R-12,12170,12170-1,P1,Day,'=Blister,4,12.500");
    expect(out[2]).toBe("Total,,,,,,,,4,12.500");
  });
  test("reason: label, else code, else empty", () => {
    expect(rejectionReason({ reasonLabel: "", reasonCode: "BLS" })).toBe("BLS");
    expect(rejectionReason({ reasonLabel: "", reasonCode: null })).toBe("");
  });
});

describe("recuts CSV", () => {
  const row: RecutRow = { bundleId: "b1", serial: "26I4086", day: "2026-11-20", sectionId: "s1", sectionCode: "12170", copyCode: null, lengthMm: 3000, fromLengthMm: 3658, pcs: 10, weightG: 40_000, lossG: 8_800, reason: null };
  const totals: RecutsData["totals"] = { bundles: 1, pcs: 10, weightG: 40_000, lossG: 8_800 };
  test("header, a row and totals", () => {
    const out = lines(recutsCsv([row], totals, t));
    expect(out[0]).toBe("Day,Bundle,Section,Copy,Trolley length,Cut length,Pieces,Weight kg,Lost kg,Reason");
    expect(out[1]).toBe("2026-11-20,26I4086,12170,,3658,3000,10,40.000,8.800,");
    expect(out[2]).toBe("Total,,,,,,10,40.000,8.800,");
  });
});

describe("wip CSV", () => {
  const row = {
    lineId: "l1", orderId: "o1", orderNumber: "SO-7", orderDate: "2026-11-01", expectedDate: null, poNumber: null, customerId: "c1", customerName: "Domal", lineNo: 2, sectionCode: "12170", cutLengthMm: 3658, bakiG: 5_000_000,
    wip: { orderedG: 6_000_000, notPlanned: 1_000_000, planned: 500_000, onPress: 0, ageing: 0, unpacked: 0, packed: 500_000, dispatched: 4_000_000, overG: 0, stage: "packed" },
  } as unknown as WipRow;
  test("one row per line with every stage in kg", () => {
    const out = lines(wipCsv([row], t));
    expect(out[0]).toBe("Order,PO,Party,Line,Section,Cut length,Baki kg,Not planned kg,Planned kg,On the press kg,Ageing kg,Waiting to pack kg,Packed kg,Dispatched kg");
    expect(out[1]).toBe("SO-7,,Domal,2,12170,3658,5000.000,1000.000,500.000,0.000,0.000,0.000,500.000,4000.000");
  });
});

describe("plan against actual CSV", () => {
  const data = {
    groupBy: "press",
    rows: [{ key: "p1", label: "P1", plannedG: 10_000_000, actualG: 7_500_000, gapG: -2_500_000, achievedBp: 7500, planDies: 2, loggedRuns: 2, downtimeMin: 55, reasons: [{ code: "DC", label: "Die change", min: 40 }, { code: "PW", label: "Power cut", min: 15 }] }],
    totals: { plannedG: 10_000_000, actualG: 7_500_000, gapG: -2_500_000, achievedBp: 7500, planDies: 2, downtimeMin: 55 },
  } as unknown as PlanActualData;
  test("negative gap keeps its minus, percent from basis points", () => {
    const out = lines(planActualCsv(data, t));
    expect(out[0]).toBe("Press,Planned kg,Actual kg,Gap kg,Achieved %,Downtime min,Top reasons");
    expect(out[1]).toBe("P1,10000.000,7500.000,-2500.000,75.0,55,Die change 40 min; Power cut 15 min");
    expect(out[2]).toBe("Total,10000.000,7500.000,-2500.000,75.0,55,");
    expect(achievedText(null)).toBe("");
    expect(achievedText(7545)).toBe("75.5");
  });
});

describe("unpacked CSV", () => {
  const data = {
    rows: [{ sectionId: "s1", sectionCode: "12170", sectionName: null, copyId: "c1", copyCode: "12170-1", lines: 3, pcs: 120, kgG: 55_000, oldestReleasedAt: 1_700_000_000_000 }],
    totals: { pcs: 120, kgG: 55_000, lines: 3 },
  } as UnpackedData;
  test("header, row with the oldest release day, totals", () => {
    const out = lines(unpackedCsv(data, () => "2026-11-14", t));
    expect(out[0]).toBe("Section,Copy,Trolley lines,Pieces,Weight kg,Oldest released");
    expect(out[1]).toBe("12170,12170-1,3,120,55.000,2026-11-14");
    expect(out[2]).toBe("Total,,3,120,55.000,");
  });
});

describe("materials CSV", () => {
  const data = {
    from: "2026-11-01", to: "2026-11-20",
    classes: [{ class: "billet", openingG: 100_000, inG: 50_000, outG: 30_000, gapG: -2_000, closingG: 118_000, inBy: [{ group: "press", g: 50_000 }], outBy: [{ group: "dispatch", g: 30_000 }], gapBy: [{ group: "cast_tail", g: -2_000 }], balanced: true }],
  } as unknown as MaterialsData;
  test("every part of the sum on its own line, in words", () => {
    const out = lines(materialsCsv(data, t));
    expect(out[0]).toBe("Material,Part,Document,Weight kg");
    expect(out).toContain("Billets,In,Press close,50.000");
    expect(out).toContain("Billets,Out,Dispatched,30.000");
    expect(out).toContain("Billets,Gap,Billet count at cast close,-2.000");
    expect(out.at(-1)).toBe("Billets,Closing,,118.000");
  });
  test("a document kind has a plain word; an unknown one shows as written", () => {
    for (const g of ["opening", "pack", "void", "dispatch", "purchase", "melt", "pack_reject", "press", "cast_tail", "move"]) expect(materialGroupText(g, t)).not.toBe(g);
    expect(materialGroupText("odd", t)).toBe("odd");
  });
});

describe("collectPages", () => {
  test("walks every page by nextOffset", async () => {
    const seen: number[] = [];
    const all = await collectPages(async (offset) => {
      seen.push(offset);
      return { rows: [offset, offset + 1], nextOffset: offset < 4 ? offset + 2 : null };
    });
    expect(seen).toEqual([0, 2, 4]);
    expect(all).toEqual([0, 1, 2, 3, 4, 5]);
  });
});

describe("search parsers", () => {
  test("days must be YYYY-MM-DD", () => {
    expect(parseRegRange({ from: "2026-11-01", to: "junk" })).toEqual({ from: "2026-11-01" });
  });
  test("rejections", () => {
    expect(parseRejectionsSearch({ source: "pack", section: "s1", reason: "abc", line: "", shift: 5 })).toEqual({ source: "pack", section: "s1", reason: "abc" });
    expect(parseRejectionsSearch({ source: "x" })).toEqual({});
  });
  test("recuts, wip, plan-actual", () => {
    expect(parseRecutsSearch({ from: "2026-11-01", section: "s1" })).toEqual({ from: "2026-11-01", section: "s1" });
    expect(parseWipSearch({ party: "c1" })).toEqual({ party: "c1" });
    expect(parseWipSearch({})).toEqual({});
    expect(parsePlanActualSearch({ group: "alloy" })).toEqual({ group: "alloy" });
    expect(parsePlanActualSearch({ group: "press" })).toEqual({});
  });
});
