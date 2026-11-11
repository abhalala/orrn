import { field } from "./field";
import type { TargetDef } from "./types";

/** `dieInstanceStatuses` in packages/db/src/schema/dies.ts. */
export const DIE_COPY_STATUSES = ["in_use", "available", "at_nitriding", "at_maker", "retired", "on_trial"] as const;

/** Commit through `dieInstance.create`. */
export const dieCopiesTarget: TargetDef = {
  id: "die_copies",
  order: 31,
  fields: [
    field("series", { required: true }),
    field("sectionCode", { required: true, resolver: "section_by_code" }),
    field("tierRank", { kind: "count" }),
    field("makerDieNo", { resolver: "die_copy_by_code" }),
    field("makerProjectNo"),
    field("supplier"),
    field("trialKgPer12ft", { kind: "linear_mass" }),
    field("hardness", { kind: "count", note: "Surface hardness, HV" }),
    field("lifeKg", { kind: "mass", note: "Life in kg, stored in grams" }),
    field("status", { enum: DIE_COPY_STATUSES }),
    field("notes"),
  ],
  keys: ["makerDieNo"],
  keyResolvers: { makerDieNo: "die_copy_by_code" },
  checkRow: null,
};
