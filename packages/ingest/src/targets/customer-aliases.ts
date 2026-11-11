import { field } from "./field";
import type { TargetDef } from "./types";

/** Other names a customer is known by. Commit through `customer.addAliases`. */
export const customerAliasesTarget: TargetDef = {
  id: "customer_aliases",
  order: 11,
  fields: [
    field("customer", { required: true, resolver: "customer_by_name", note: "The customer this name belongs to" }),
    field("alias", { required: true, note: "The other name" }),
  ],
  keys: ["alias"],
  keyResolvers: {},
  checkRow: null,
};
