/**
 * Stock filters shared by `stock.byDieLength`, `stock.byYard` and `bundle.listBundles` (FP-PK-08,
 * BACKLOG 36): yard, customer, sales order, plant stock, hollow / solid / semi, packed date. One
 * definition, so the Lengths, Yards and Bundles tabs of `/stock` answer the same question the same way.
 *
 * - customer / sales order: the order line the bundle sits on NOW (`bundle.sales_order_line_id`).
 * - plant stock: no line and the latest transfer went to no line (C8), not legacy "unassigned".
 * - packed date: company calendar days (`settings.timezone`, else IST), both ends inclusive.
 */
import { eq, sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { dieProfileKinds } from "@orrn/db/schema/catalog";
import { bundle } from "@orrn/db/schema/inventory";
import { company } from "@orrn/db/schema/tenant";

import type { OrrnDb } from "./atomic";
import { companyTimezone } from "./dayWindow";
import { isPlantStockSql } from "./reallocate";
import { addDays, localMidnight } from "./zonedBuckets";

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Optional filters, spread into a procedure's input object. */
export const stockFilterShape = {
  locationId: z.string().min(1).max(64).optional(),
  customerId: z.string().min(1).max(64).optional(),
  salesOrderId: z.string().min(1).max(64).optional(),
  /** true = plant stock only. */
  plantStock: z.boolean().optional(),
  profileKind: z.enum(dieProfileKinds).optional(),
  packedFrom: ymd.optional(),
  packedTo: ymd.optional(),
};
export type StockFilters = {
  [K in keyof typeof stockFilterShape]?: z.infer<(typeof stockFilterShape)[K]>;
};

/** Σ per profile kind (die.profile_kind; `none` = a section whose kind is not set). */
export type KindTotals = Record<"hollow" | "solid" | "semi" | "none", { bundles: number; pcs: number; weightG: number }>;

export function emptyKindTotals(): KindTotals {
  const z = () => ({ bundles: 0, pcs: 0, weightG: 0 });
  return { hollow: z(), solid: z(), semi: z(), none: z() };
}

/** WHERE conditions over `bundle` (the caller already filters company and status). */
export async function stockFilterConditions(db: OrrnDb, companyId: string, f: StockFilters): Promise<SQL[]> {
  const out: SQL[] = [];
  if (f.locationId) out.push(eq(bundle.locationId, f.locationId));
  if (f.customerId) {
    out.push(
      sql`exists (select 1 from sales_order_line sl join sales_order so on so.id = sl.sales_order_id and so.company_id = sl.company_id where sl.id = ${bundle.salesOrderLineId} and sl.company_id = ${companyId} and so.customer_id = ${f.customerId})`,
    );
  }
  if (f.salesOrderId) {
    out.push(
      sql`exists (select 1 from sales_order_line sl where sl.id = ${bundle.salesOrderLineId} and sl.company_id = ${companyId} and sl.sales_order_id = ${f.salesOrderId})`,
    );
  }
  if (f.plantStock) out.push(isPlantStockSql(companyId, { id: sql`${bundle.id}`, line: sql`${bundle.salesOrderLineId}` }));
  if (f.profileKind) {
    out.push(sql`exists (select 1 from die dk where dk.id = ${bundle.dieId} and dk.company_id = ${companyId} and dk.profile_kind = ${f.profileKind})`);
  }
  if (f.packedFrom || f.packedTo) {
    const [co] = await db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1);
    const tz = companyTimezone((co?.settings ?? null) as Record<string, unknown> | null);
    if (f.packedFrom) out.push(sql`${bundle.createdAt} >= ${localMidnight(tz, f.packedFrom)}`);
    if (f.packedTo) out.push(sql`${bundle.createdAt} < ${localMidnight(tz, addDays(f.packedTo, 1))}`);
  }
  return out;
}

/** Fold `(kind, bundles, pcs, weightG)` rows into the four kind totals. */
export function foldKindTotals(
  rows: readonly { kind: string | null; bundles: number | string; pcs: number | string; weightG: number | string }[],
): KindTotals {
  const out = emptyKindTotals();
  for (const r of rows) {
    const key = r.kind === "hollow" || r.kind === "solid" || r.kind === "semi" ? r.kind : "none";
    out[key].bundles += Number(r.bundles);
    out[key].pcs += Number(r.pcs);
    out[key].weightG += Number(r.weightG);
  }
  return out;
}
