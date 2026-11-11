import { field } from "./field";
import type { TargetDef } from "./types";

/** Commit through `vendor.addAlias`. */
export const vendorAliasesTarget: TargetDef = {
  id: "vendor_aliases",
  order: 21,
  fields: [
    field("vendor", { required: true, resolver: "vendor_by_name", note: "The vendor this name belongs to" }),
    field("alias", { required: true, note: "The other name" }),
  ],
  keys: ["alias"],
  keyResolvers: {},
  checkRow: null,
};
