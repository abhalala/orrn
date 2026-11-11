import { MM_PER_FOOT } from "@orrn/domain";

import { field, positiveIntCheck, rangeCheck } from "./field";
import type { TargetDef } from "./types";

/** A bundle shorter than 1 ft or longer than 30 ft carries the wrong unit. Same values as web `BUNDLE_LENGTH_MM`. */
export const BUNDLE_LENGTH_MM = { min: Math.round(MM_PER_FOOT), max: Math.round(30 * MM_PER_FOOT) } as const;
export const BUNDLE_MAX_WEIGHT_G = 5_000_000;

/** In-stock bundles from before the cutover. Commit through `bundle.bulkImport`. */
export const bundlesTarget: TargetDef = {
  id: "bundles",
  order: 40,
  fields: [
    // Plan B4 marks legacyId required. It is optional here so the web template sheet (no legacy id column) fits a
    // built-in hole exactly. Without it a row has no "already in orrn" check. See the lane C report.
    field("legacyId", { resolver: "bundle_by_legacy_id", note: "The bundle id in the old system" }),
    field("series", { required: true }),
    field("sectionCode", { required: true, resolver: "section_by_code" }),
    field("quantity", { kind: "count", required: true, check: positiveIntCheck, note: "Pieces in the bundle" }),
    field("weightG", {
      kind: "mass",
      required: true,
      check: rangeCheck(1, BUNDLE_MAX_WEIGHT_G, "weight_range"),
      note: "Bundle weight, stored in grams",
    }),
    field("lengthMm", {
      kind: "length",
      required: true,
      check: rangeCheck(BUNDLE_LENGTH_MM.min, BUNDLE_LENGTH_MM.max, "length_range"),
      note: "Cut length, stored in mm",
    }),
    field("poNumber"),
  ],
  keys: ["legacyId"],
  keyResolvers: { legacyId: "bundle_by_legacy_id" },
  checkRow: null,
};
