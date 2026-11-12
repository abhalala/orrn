import { field, emailCheck, gstinCheck } from "./field";
import type { TargetDef } from "./types";

/** Commit through `customer.importCsv`. City goes to `billingAddress.city`. */
export const customersTarget: TargetDef = {
  id: "customers",
  order: 10,
  fields: [
    field("name", { required: true, note: "Customer or party name" }),
    field("taxId", { check: gstinCheck, note: "GSTIN, 15 characters" }),
    field("phone"),
    field("email", { check: emailCheck }),
    field("city"),
    field("notes"),
  ],
  keys: ["name"],
  keyResolvers: { name: "customer_by_name" },
  checkRow: null,
};
