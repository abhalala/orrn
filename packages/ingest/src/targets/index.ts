import type { IngestTarget } from "../states";
import { INGEST_TARGETS } from "../states";
import { bundlesTarget } from "./bundles";
import { customerAliasesTarget } from "./customer-aliases";
import { customersTarget } from "./customers";
import { dieCopiesTarget } from "./die-copies";
import { diesTarget } from "./dies";
import { ordersTarget } from "./orders";
import type { TargetDef } from "./types";
import { vendorAliasesTarget } from "./vendor-aliases";
import { vendorsTarget } from "./vendors";

export * from "./types";
export { field, MAX_TEXT } from "./field";
export { BUNDLE_LENGTH_MM, BUNDLE_MAX_WEIGHT_G } from "./bundles";
export { DIE_MAX_BAND_G, DIE_STATUSES } from "./dies";
export { DIE_COPY_STATUSES } from "./die-copies";
export { BAKI_TOLERANCE_G, orderLineGrams } from "./orders";

/** The Wave 1 catalogue (plan B4), by target id. */
export const TARGETS: Record<IngestTarget, TargetDef> = {
  customers: customersTarget,
  customer_aliases: customerAliasesTarget,
  vendors: vendorsTarget,
  vendor_aliases: vendorAliasesTarget,
  dies: diesTarget,
  die_copies: dieCopiesTarget,
  bundles: bundlesTarget,
  orders: ordersTarget,
};

/** Targets in merge order. */
export const TARGET_ORDER: IngestTarget[] = [...INGEST_TARGETS].sort((a, b) => TARGETS[a].order - TARGETS[b].order);

export function targetField(target: IngestTarget, name: string) {
  return TARGETS[target].fields.find((f) => f.name === name);
}
