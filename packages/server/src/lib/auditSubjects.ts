import { and, eq, inArray } from "drizzle-orm";

import { die } from "@orrn/db/schema/catalog";
import { dieInstance } from "@orrn/db/schema/dies";
import { countSession } from "@orrn/db/schema/count";
import { customer } from "@orrn/db/schema/customers";
import { dispatch } from "@orrn/db/schema/dispatch";
import { cast } from "@orrn/db/schema/foundry";
import { bundle } from "@orrn/db/schema/inventory";
import { packingList } from "@orrn/db/schema/packing";
import { pressPlan, pressRun } from "@orrn/db/schema/press";
import { vendor, purchaseLot } from "@orrn/db/schema/purchase";
import { salesOrder } from "@orrn/db/schema/sales";

import { mapInChunks, type OrrnDb } from "./atomic";

type Named = { id: string; label: string | null };
type Lookup = (db: OrrnDb, companyId: string, ids: string[]) => Promise<Named[]>;

/**
 * The words an audit row's subject goes by (BACKLOG 100): the number or code a person knows it by, for the types that have
 * one. Every lookup is scoped to the plant, so a row that names another plant's id (or an id since deleted) gets no label.
 */
const LOOKUPS: Record<string, Lookup> = {
  sales_order: (db, companyId, ids) => db.select({ id: salesOrder.id, label: salesOrder.number }).from(salesOrder).where(and(eq(salesOrder.companyId, companyId), inArray(salesOrder.id, ids))),
  dispatch: (db, companyId, ids) => db.select({ id: dispatch.id, label: dispatch.code }).from(dispatch).where(and(eq(dispatch.companyId, companyId), inArray(dispatch.id, ids))),
  packing_list: (db, companyId, ids) => db.select({ id: packingList.id, label: packingList.code }).from(packingList).where(and(eq(packingList.companyId, companyId), inArray(packingList.id, ids))),
  press_run: (db, companyId, ids) => db.select({ id: pressRun.id, label: pressRun.number }).from(pressRun).where(and(eq(pressRun.companyId, companyId), inArray(pressRun.id, ids))),
  press_plan: (db, companyId, ids) => db.select({ id: pressPlan.id, label: pressPlan.number }).from(pressPlan).where(and(eq(pressPlan.companyId, companyId), inArray(pressPlan.id, ids))),
  die_instance: (db, companyId, ids) => db.select({ id: dieInstance.id, label: dieInstance.code }).from(dieInstance).where(and(eq(dieInstance.companyId, companyId), inArray(dieInstance.id, ids))),
  die: (db, companyId, ids) => db.select({ id: die.id, label: die.sectionCode }).from(die).where(and(eq(die.companyId, companyId), inArray(die.id, ids))),
  customer: (db, companyId, ids) => db.select({ id: customer.id, label: customer.name }).from(customer).where(and(eq(customer.companyId, companyId), inArray(customer.id, ids))),
  vendor: (db, companyId, ids) => db.select({ id: vendor.id, label: vendor.name }).from(vendor).where(and(eq(vendor.companyId, companyId), inArray(vendor.id, ids))),
  bundle: (db, companyId, ids) => db.select({ id: bundle.id, label: bundle.serial }).from(bundle).where(and(eq(bundle.companyId, companyId), inArray(bundle.id, ids))),
  cast: (db, companyId, ids) => db.select({ id: cast.id, label: cast.number }).from(cast).where(and(eq(cast.companyId, companyId), inArray(cast.id, ids))),
  purchase_lot: (db, companyId, ids) => db.select({ id: purchaseLot.id, label: purchaseLot.number }).from(purchaseLot).where(and(eq(purchaseLot.companyId, companyId), inArray(purchaseLot.id, ids))),
  count_session: (db, companyId, ids) => db.select({ id: countSession.id, label: countSession.number }).from(countSession).where(and(eq(countSession.companyId, companyId), inArray(countSession.id, ids))),
};

/** `subjectLabel` for each row (null when the subject has no words), one query per subject type present on the page. */
export async function withSubjectLabels<R extends { subjectType: string; subjectId: string | null }>(
  db: OrrnDb,
  companyId: string,
  rows: readonly R[],
): Promise<(R & { subjectLabel: string | null })[]> {
  const wanted = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!r.subjectId || !LOOKUPS[r.subjectType]) continue;
    const ids = wanted.get(r.subjectType) ?? new Set<string>();
    ids.add(r.subjectId);
    wanted.set(r.subjectType, ids);
  }
  const found = new Map<string, string>();
  await Promise.all(
    [...wanted].map(async ([type, ids]) => {
      const named = await mapInChunks([...ids], (part) => LOOKUPS[type]!(db, companyId, part));
      for (const n of named) if (n.label) found.set(`${type}:${n.id}`, n.label);
    }),
  );
  return rows.map((r) => ({ ...r, subjectLabel: r.subjectId ? (found.get(`${r.subjectType}:${r.subjectId}`) ?? null) : null }));
}
