import { field, rangeCheck } from "./field";
import type { TargetDef } from "./types";

/** `dieStatuses` in packages/db/src/schema/catalog.ts. */
export const DIE_STATUSES = ["active", "archived"] as const;

/** A die band above 50 kg per 12 ft is a unit slip (a 2.4 typed as 2400 g). Same value as web `DIE_MAX_BAND_G`. */
export const DIE_MAX_BAND_G = 50_000;

const band = rangeCheck(1, DIE_MAX_BAND_G, "weight_range");

/** Commit through `die.processImport`. Weights are grams per 12 ft. */
export const diesTarget: TargetDef = {
  id: "dies",
  order: 30,
  fields: [
    field("series", { required: true }),
    field("sectionCode", { required: true }),
    field("weightMinG", { kind: "linear_mass", required: true, check: band, note: "Lowest weight of the band, per 12 ft", magnitude: "die.band" }),
    field("weightMaxG", { kind: "linear_mass", required: true, check: band, note: "Highest weight of the band, per 12 ft", magnitude: "die.band" }),
    field("name"),
    field("widthMm", { kind: "dimension", magnitude: "die.width" }),
    field("thicknessMm", { kind: "dimension", magnitude: "die.thickness" }),
    field("legMm", { kind: "dimension" }),
    field("status", { enum: DIE_STATUSES }),
    field("notes"),
  ],
  keys: ["series", "sectionCode"],
  keyResolvers: {},
  checkRow: (v) => {
    const min = v.weightMinG;
    const max = v.weightMaxG;
    if (typeof min === "number" && typeof max === "number" && max < min) return { field: "weightMaxG", code: "range_order" };
    return null;
  },
};
