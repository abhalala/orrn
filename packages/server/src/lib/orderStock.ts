/**
 * "Stock held on this SO" (FP-OP-19): the bundles whose `sales_order_line_id` is a line of the
 * order and that are still in the yard (available, or reserved on a draft dispatch), grouped by
 * line, with a total. It reads the bundle's line, never the PO text typed at pack time. Rates are
 * not part of it. The screens render it (print / PDF / Excel) from this snapshot.
 */
import { and, asc, eq, inArray } from "drizzle-orm";

import { die } from "@orrn/db/schema/catalog";
import { dieInstance } from "@orrn/db/schema/dies";
import { bundle } from "@orrn/db/schema/inventory";
import { salesOrderLine } from "@orrn/db/schema/sales";
import { location } from "@orrn/db/schema/stock";

import { chunk, type OrrnDb } from "./atomic";

/** Most bundles one print carries; past it `truncated` says the list was cut. */
export const STOCK_ON_ORDER_MAX_BUNDLES = 2_000;

export type StockOnOrderBundle = {
  id: string;
  serial: string;
  partyNo: string | null;
  status: "available" | "reserved";
  pcs: number;
  weightG: number;
  lengthMm: number;
  /** The copy it was pressed on (`12170-1`), if known. */
  copyCode: string | null;
  /** Where it lies (location name), if known. */
  yard: string | null;
  packedAt: number;
};

export type StockOnOrderLine = {
  lineId: string;
  lineNo: number;
  sectionCode: string;
  series: string;
  sectionName: string | null;
  cutLengthMm: number;
  orderedG: number;
  orderedPcs: number | null;
  bundles: StockOnOrderBundle[];
  pcs: number;
  weightG: number;
};

export async function stockOnOrder(db: OrrnDb, companyId: string, orderId: string) {
  const lines = await db
    .select({
      lineId: salesOrderLine.id,
      lineNo: salesOrderLine.lineNo,
      sectionCode: die.sectionCode,
      series: die.series,
      sectionName: die.name,
      cutLengthMm: salesOrderLine.cutLengthMm,
      orderedG: salesOrderLine.kgG,
      orderedPcs: salesOrderLine.pcs,
    })
    .from(salesOrderLine)
    .innerJoin(die, and(eq(die.id, salesOrderLine.dieId), eq(die.companyId, salesOrderLine.companyId)))
    .where(and(eq(salesOrderLine.companyId, companyId), eq(salesOrderLine.salesOrderId, orderId)))
    .orderBy(asc(salesOrderLine.lineNo));

  const byLine = new Map<string, StockOnOrderBundle[]>();
  let remaining = STOCK_ON_ORDER_MAX_BUNDLES + 1;
  for (const part of chunk(
    lines.map((l) => l.lineId),
    80,
  )) {
    if (remaining <= 0) break;
    const rows = await db
      .select({
        id: bundle.id,
        lineId: bundle.salesOrderLineId,
        serial: bundle.serial,
        partyNo: bundle.partyNo,
        status: bundle.status,
        pcs: bundle.quantity,
        weightG: bundle.weightG,
        lengthMm: bundle.lengthMm,
        copyCode: dieInstance.code,
        yard: location.name,
        packedAt: bundle.createdAt,
      })
      .from(bundle)
      .leftJoin(dieInstance, and(eq(dieInstance.id, bundle.dieInstanceId), eq(dieInstance.companyId, companyId)))
      .leftJoin(location, and(eq(location.id, bundle.locationId), eq(location.companyId, companyId)))
      .where(and(eq(bundle.companyId, companyId), inArray(bundle.salesOrderLineId, part), inArray(bundle.status, ["available", "reserved"])))
      .orderBy(asc(bundle.createdAt), asc(bundle.serial))
      .limit(remaining);
    remaining -= rows.length;
    for (const r of rows) {
      const list = byLine.get(r.lineId!) ?? [];
      list.push({
        id: r.id,
        serial: r.serial,
        partyNo: r.partyNo,
        status: r.status as "available" | "reserved",
        pcs: r.pcs,
        weightG: r.weightG,
        lengthMm: r.lengthMm,
        copyCode: r.copyCode,
        yard: r.yard,
        packedAt: r.packedAt.getTime(),
      });
      byLine.set(r.lineId!, list);
    }
  }
  const total = { bundles: 0, pcs: 0, weightG: 0 };
  let kept = STOCK_ON_ORDER_MAX_BUNDLES;
  let truncated = false;
  const out: StockOnOrderLine[] = lines.map((l) => {
    let bundles = byLine.get(l.lineId) ?? [];
    if (bundles.length > kept) {
      bundles = bundles.slice(0, kept);
      truncated = true;
    }
    kept -= bundles.length;
    const pcs = bundles.reduce((s, b) => s + b.pcs, 0);
    const weightG = bundles.reduce((s, b) => s + b.weightG, 0);
    total.bundles += bundles.length;
    total.pcs += pcs;
    total.weightG += weightG;
    return { ...l, orderedPcs: l.orderedPcs == null ? null : Number(l.orderedPcs), bundles, pcs, weightG };
  });
  if (remaining <= 0) truncated = true;
  return { lines: out, total, truncated };
}
