import type { BuiltinHole } from "./types";

/** From `columnGuide("customers")` and `IMPORT_FIELDS.customers`. */
export const builtinCustomers: BuiltinHole = {
  id: "customers",
  version: 1,
  target: "customers",
  keys: ["name"],
  onExisting: "ask",
  fields: [
    { field: "name", aliases: ["name", "customer", "customer name", "party", "party name"], required: true },
    { field: "taxId", aliases: ["gstin", "gst", "gst no", "gst number", "gstin no", "tax id"], caseTo: "upper" },
    { field: "phone", aliases: ["phone", "mobile", "phone number", "mobile number", "contact"] },
    { field: "email", aliases: ["email", "e mail", "email address"], caseTo: "lower" },
    { field: "city", aliases: ["city", "town"] },
    { field: "notes", aliases: ["notes", "note", "remarks"] },
  ],
};
