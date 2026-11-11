import { field, gstinCheck, MAX_TEXT } from "./field";
import type { TargetDef } from "./types";

const aliasesCheck = (v: string | number) => {
  if (typeof v !== "string") return "too_long" as const;
  const parts = v.split(";").map((p) => p.trim()).filter(Boolean);
  if (parts.length > 20) return "too_many_aliases" as const;
  return parts.some((p) => p.length > MAX_TEXT) ? ("too_long" as const) : null;
};

/** Commit through `vendor.create`. */
export const vendorsTarget: TargetDef = {
  id: "vendors",
  order: 20,
  fields: [
    field("name", { required: true }),
    field("gstin", { check: gstinCheck, note: "GSTIN, 15 characters" }),
    field("phone"),
    field("city"),
    field("notes"),
    field("aliases", { multi: { sep: ";", max: 20 }, check: aliasesCheck, note: "Other names, separated by semicolons" }),
  ],
  keys: ["name"],
  keyResolvers: { name: "vendor_by_name" },
  checkRow: null,
};
