import { describe, expect, test } from "bun:test";

import { chooseHeader } from "../header";
import { readSheet } from "../readers/blocks";
import { parseCsv, readCsv } from "../readers/csv";
import { analyzeBuiltin, BUILTIN_HOLES } from "./index";
import { WEB_TEMPLATE_CSV } from "./web-templates.fixture";

// Round 7, rule 6.4 (M-R6-1): the web's old import templates, exactly as the web hands them out (no column added),
// fit their built-in layouts exactly. For bundles the old bundle id column is optional.

const KINDS = ["bundles", "dies", "customers"] as const;
const UNITS = ["mm", "inch"] as const;

describe("6.4: the web's old templates fit", () => {
  test("each template fits its built-in layout exactly, read as CSV and as a sheet", () => {
    for (const kind of KINDS) {
      for (const unit of UNITS) {
        const csv = WEB_TEMPLATE_CSV[kind][unit];
        for (const [how, block] of [["csv", readCsv(csv).blocks[0]!], ["sheet", readSheet(parseCsv(csv)).blocks[0]!]] as const) {
          const c = chooseHeader(block, {});
          const got = c.kind === "fits" ? { fit: c.fit.fit, target: c.fit.target, row: c.headerRow } : { ask: c.resembles?.name ?? null };
          expect({ kind, unit, how, ...got }).toEqual({ kind, unit, how, fit: "exact", target: kind, row: 0 });
        }
      }
    }
  });

  test("the web's parity test, here: every column used, nothing missing, a unit on every number", () => {
    for (const kind of KINDS) {
      for (const unit of UNITS) {
        const headers = parseCsv(WEB_TEMPLATE_CSV[kind][unit])[0]!;
        const hole = BUILTIN_HOLES.find((h) => h.id === kind)!;
        const a = analyzeBuiltin(hole, headers);
        expect({ kind, unit, missing: a.missingRequired, unitless: a.unitless, extra: a.extra.map((e) => e.header) }).toEqual({ kind, unit, missing: [], unitless: [], extra: [] });
        expect({ kind, unit, mapped: a.mapped.length }).toEqual({ kind, unit, mapped: headers.length });
      }
    }
  });

  test("a bundle sheet that has the old bundle id column still maps it", () => {
    const hole = BUILTIN_HOLES.find((h) => h.id === "bundles")!;
    const a = analyzeBuiltin(hole, ["Legacy id", "Die series", "Section code", "Pieces", "Weight (kg)", "Length (ft)", "PO number"]);
    expect(a.mapped.find((m) => m.field === "legacyId")?.col).toBe(0);
    expect(a.missingRequired).toEqual([]);
  });
});
