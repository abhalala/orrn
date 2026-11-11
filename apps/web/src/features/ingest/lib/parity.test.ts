import { describe, expect, test } from "bun:test";

import {
  analyzeBuiltin,
  BUILTIN_HOLES,
  BUNDLE_LENGTH_MM as ENGINE_BUNDLE_LENGTH_MM,
  BUNDLE_MAX_WEIGHT_G as ENGINE_BUNDLE_MAX_WEIGHT_G,
  DIE_MAX_BAND_G as ENGINE_DIE_MAX_BAND_G,
  IMPORT_FIELDS as ENGINE_IMPORT_FIELDS,
  isPerTwelveFoot as engineIsPerTwelveFoot,
  readHeader as engineReadHeader,
} from "@orrn/ingest";

import {
  BUNDLE_LENGTH_MM,
  BUNDLE_MAX_WEIGHT_G,
  DIE_MAX_BAND_G,
  IMPORT_FIELDS,
  isPerTwelveFoot,
  readHeader,
  type ImportKind,
} from "../../imports/parse";
import { columnGuide } from "../../imports/templates";

/**
 * Plan A7. The portal's built-in holes were ported from `features/imports`, which stays untouched for the
 * masters dialogs. Two copies of the same words and bounds must not drift: this test fails when one changes
 * and the other does not.
 */

const KINDS: ImportKind[] = ["bundles", "dies", "customers"];

describe("header aliases", () => {
  test("every field of every import kind has the same id, type, required flag and aliases", () => {
    for (const kind of KINDS) {
      const web = IMPORT_FIELDS[kind].map((f) => ({ id: f.id, type: f.type, required: f.required ?? false, aliases: [...f.aliases] }));
      const engine = ENGINE_IMPORT_FIELDS[kind].map((f) => ({ id: f.id, type: f.type, required: f.required ?? false, aliases: [...f.aliases] }));
      expect({ kind, fields: engine }).toEqual({ kind, fields: web });
    }
  });
});

describe("unit from header", () => {
  const headers = [
    "Length (mm)", "Length (in)", "Length (ft)", "Length ft", "Length in", "Weight (kg)", "Weight (g)", "Weight Kg", "Wt (gm)",
    "Min weight (kg/12ft)", "Max weight (g/12ft)", "Weight Kg/12ft", "kg per 12 ft", "Wt (kg/12')", "Width (mm)", "Thickness (mm)",
    "Rate (Rs per kg)", "Length (furlong)", "Section code", "Die series", "Pieces", "PO number", "GSTIN", "Name", "Length (m)",
    "Mtrs", "Weight (kgs)", "", "  Weight  (KG)  ", "dieSeries", "SectionCode", "Weight in kg", "Length per ft",
  ];
  test("readHeader gives the same name, unit and unknown unit", () => {
    for (const h of headers) expect({ h, read: engineReadHeader(h) }).toEqual({ h, read: readHeader(h) });
  });
  test("isPerTwelveFoot agrees", () => {
    for (const h of headers) expect({ h, per: engineIsPerTwelveFoot(h) }).toEqual({ h, per: isPerTwelveFoot(h) });
  });
});

describe("bounds", () => {
  test("bundle length, bundle weight and die band limits are the same numbers", () => {
    expect(ENGINE_BUNDLE_LENGTH_MM).toEqual(BUNDLE_LENGTH_MM);
    expect(ENGINE_BUNDLE_MAX_WEIGHT_G).toBe(BUNDLE_MAX_WEIGHT_G);
    expect(ENGINE_DIE_MAX_BAND_G).toBe(DIE_MAX_BAND_G);
  });
});

describe("template sheets", () => {
  test("the sheet orrn hands out for each kind fits its built-in hole with every column used and a unit on every number", () => {
    for (const kind of KINDS) {
      for (const unit of ["mm", "inch"] as const) {
        const headers = columnGuide(kind, unit).map((c) => c.header);
        const hole = BUILTIN_HOLES.find((h) => h.id === kind);
        expect({ kind, hole: hole?.id }).toEqual({ kind, hole: kind });
        const a = analyzeBuiltin(hole!, headers);
        expect({ kind, unit, missing: a.missingRequired, unitless: a.unitless, extra: a.extra.map((e) => e.header) }).toEqual({
          kind, unit, missing: [], unitless: [], extra: [],
        });
        expect({ kind, unit, mapped: a.mapped.length }).toEqual({ kind, unit, mapped: headers.length });
      }
    }
  });
});
