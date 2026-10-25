import { describe, expect, test } from "bun:test";

import {
  DEFAULT_REASON_CODES,
  REASON_CODE_KINDS,
  defaultReasonCodeRows,
  isReasonCodeKind,
  reasonNoteMissing,
} from "./reasonCodes";
import {
  COMPANY_MODULES,
  FLOOR_SETTINGS_DEFAULTS,
  castRequiredOnBundle,
  isModuleOn,
  normalizeModules,
  readFloorSettings,
  resolveStandard,
} from "./settings";

describe("reason codes (C39: one master with a kind)", () => {
  test("kinds", () => {
    expect([...REASON_CODE_KINDS]).toEqual([
      "downtime",
      "qc_reject",
      "void",
      "reprint",
      "ageing_hold",
      "ageing_rework",
      "ageing_scrap",
      "reallocate",
    ]);
    expect(isReasonCodeKind("downtime")).toBe(true);
    expect(isReasonCodeKind("threshold")).toBe(false);
  });

  test("spec seeds: downtime and qc reject lists", () => {
    expect(DEFAULT_REASON_CODES.downtime.map((r) => r.code)).toEqual([
      "die_change",
      "billet_wait",
      "breakdown",
      "power",
      "no_order",
      "die_correction",
      "quality_hold",
      "other",
    ]);
    expect(DEFAULT_REASON_CODES.qc_reject.map((r) => r.code)).toEqual(["dimension", "surface", "bend", "crack", "short_length", "other"]);
    expect(DEFAULT_REASON_CODES.reallocate.map((r) => r.code)).toContain("length_mismatch");
  });

  test("every kind ends with other, which needs a note; codes unique per kind", () => {
    for (const kind of REASON_CODE_KINDS) {
      const list = DEFAULT_REASON_CODES[kind];
      expect(list[list.length - 1]).toEqual({ code: "other", label: "Other", requiresNote: true });
      expect(new Set(list.map((r) => r.code)).size).toBe(list.length);
    }
    expect(reasonNoteMissing({ code: "other", note: " " })).toBe(true);
    expect(reasonNoteMissing({ code: "other", note: "belt slipped" })).toBe(false);
    expect(reasonNoteMissing({ code: "power" })).toBe(false);
    expect(reasonNoteMissing({ code: "plant_x", requiresNote: true })).toBe(true);
  });

  test("flat seed rows carry kind and order", () => {
    const rows = defaultReasonCodeRows();
    expect(rows.length).toBe(REASON_CODE_KINDS.reduce((n, k) => n + DEFAULT_REASON_CODES[k].length, 0));
    expect(rows[0]).toEqual({ kind: "downtime", code: "die_change", label: "Die change", requiresNote: false, sortOrder: 1 });
  });
});

describe("modules (FP-PF-07, C42)", () => {
  test("allowed set includes purchase (D6)", () => {
    expect([...COMPANY_MODULES]).toEqual(["customers", "dies", "bundles", "dispatches", "orders", "foundry", "press", "ageing", "store", "purchase"]);
  });
  test("empty = all on; listed = only those", () => {
    expect(isModuleOn([], "press")).toBe(true);
    expect(isModuleOn(null, "press")).toBe(true);
    expect(isModuleOn(["bundles", "dispatches"], "press")).toBe(false);
    expect(isModuleOn(["press"], "press")).toBe(true);
  });
  test("normalise: lower case, de-duplicate, unknown returned", () => {
    expect(normalizeModules(["Press", "press", " Orders ", "crm"])).toEqual({ modules: ["press", "orders"], unknown: ["crm"] });
  });
});

describe("standards (FP-PF-09)", () => {
  const standards = { solid: { standard: "IS 733", cml: "" }, hollow: { standard: "IS 1285", cml: "CM/L-1" }, semi: { standard: "", cml: "" } };
  test("hollow and solid read their own pair; semi falls back to solid when blank; null kind uses solid", () => {
    expect(resolveStandard(standards, "hollow")).toEqual({ standard: "IS 1285", cml: "CM/L-1" });
    expect(resolveStandard(standards, "semi")).toEqual({ standard: "IS 733", cml: "" });
    expect(resolveStandard(standards, null)).toEqual({ standard: "IS 733", cml: "" });
    expect(resolveStandard({}, "hollow")).toBeNull();
  });
});

describe("readFloorSettings", () => {
  test("empty settings are the defaults", () => {
    expect(readFloorSettings({})).toEqual(FLOOR_SETTINGS_DEFAULTS);
    expect(FLOOR_SETTINGS_DEFAULTS.drift).toEqual({ greenMaxBp: 800, amberMaxBp: 1000 });
    expect(FLOOR_SETTINGS_DEFAULTS.press.balanceWarnBp).toBe(200);
    expect(FLOOR_SETTINGS_DEFAULTS.dieRequiredOnSalesOrder).toBe(true);
    expect(FLOOR_SETTINGS_DEFAULTS.priceOnSalesOrder).toBe(false);
  });

  test("valid values are read; malformed ones fall back", () => {
    const s = readFloorSettings({
      shifts: [
        { id: "d", name: "Day", seq: 1, startMin: 480, endMin: 1200 },
        { id: "n", name: "Night", seq: 2, startMin: 1200, endMin: 480 },
      ],
      dieBands: false,
      locale: "gu",
      driftGreenMaxBp: 500,
      driftAmberMaxBp: 400, // below green: both defaults
      recoveryBands: { greenMinBp: 7500, amberMinBp: 7000 },
      standards: { hollow: { standard: "IS 1285", cml: "x" } },
      press: { balanceWarnBp: 300 },
      ageing: { split: true },
      letterhead: { legalName: "Fourcubes Extrusions", gstin: "24AAAAA0000A1Z5" },
      requireCastOnBundle: false,
    });
    expect(s.shifts.map((x) => x.id)).toEqual(["d", "n"]);
    expect(s.dieBands).toBe(false);
    expect(s.locale).toBe("gu");
    expect(s.drift).toEqual({ greenMaxBp: 800, amberMaxBp: 1000 });
    expect(s.recoveryBands).toEqual({ greenMinBp: 7500, amberMinBp: 7000 });
    expect(s.standards).toEqual({ hollow: { standard: "IS 1285", cml: "x" } });
    expect(s.press.balanceWarnBp).toBe(300);
    expect(s.ageing).toEqual({ manualLoad: true, split: true, requireForPack: false });
    expect(s.letterhead).toEqual({ legalName: "Fourcubes Extrusions", gstin: "24AAAAA0000A1Z5", address: null, phone: null });
    expect(s.requireCastOnBundle).toBe(false);
  });

  test("shifts that break the rules are ignored, not half-applied", () => {
    const s = readFloorSettings({ shifts: [{ id: "d", name: "Day", seq: 1, startMin: 480, endMin: 1000 }, { id: "n", name: "Night", seq: 2, startMin: 1200, endMin: 480 }] });
    expect(s.shifts).toEqual([]);
  });

  test("cast on bundle: the plant's choice, else on after the first locked melt", () => {
    expect(castRequiredOnBundle({ requireCastOnBundle: null }, false)).toBe(false);
    expect(castRequiredOnBundle({ requireCastOnBundle: null }, true)).toBe(true);
    expect(castRequiredOnBundle({ requireCastOnBundle: false }, true)).toBe(false);
  });
});

describe("order lead days and the packing list column (W2-OPPK-W)", () => {
  test("defaults: a new order is due 15 days out (Q8) and the packing list has no kg-per-piece column", () => {
    const s = readFloorSettings({});
    expect(s.orderLeadDays).toBe(15);
    expect(s.packingList).toEqual({ kgPerPiece: false, scope: "one_customer" });
    expect(FLOOR_SETTINGS_DEFAULTS.orderLeadDays).toBe(15);
  });

  test("a stored value is read; a malformed one falls back to the default", () => {
    expect(readFloorSettings({ orderLeadDays: 7, packingList: { kgPerPiece: true } })).toMatchObject({ orderLeadDays: 7, packingList: { kgPerPiece: true } });
    expect(readFloorSettings({ orderLeadDays: 0 }).orderLeadDays).toBe(0);
    for (const bad of [-1, 121, 3.5, "7", null]) expect(readFloorSettings({ orderLeadDays: bad }).orderLeadDays).toBe(15);
    expect(readFloorSettings({ packingList: { kgPerPiece: "yes" } }).packingList.kgPerPiece).toBe(false);
    expect(readFloorSettings({ packingList: "on" }).packingList.kgPerPiece).toBe(false);
  });

  test("the packing list scope (Q37): one customer by default; a stored mode is read, an unknown one is not", () => {
    expect(readFloorSettings({}).packingList.scope).toBe("one_customer");
    for (const scope of ["one_so", "one_customer", "per_truck"] as const) expect(readFloorSettings({ packingList: { scope } }).packingList.scope).toBe(scope);
    expect(readFloorSettings({ packingList: { scope: "all" } }).packingList.scope).toBe("one_customer");
    expect(readFloorSettings({ packingList: { kgPerPiece: true } }).packingList).toEqual({ kgPerPiece: true, scope: "one_customer" });
  });
});
