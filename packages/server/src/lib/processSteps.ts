/**
 * Reads and batch statements for process steps (XE parity lane JOBWORK). The router
 * (`routers/process.ts`) stays thin: it reads, checks with `@orrn/domain` `jobwork.ts`, and sends one
 * `atomicBatch` built here. Every ledger row for an existing bundle is an INSERT … SELECT that reads
 * the bundle and its ledger balance at write time and lands only when this request's bundle write
 * landed (the bundle carries the request's `server_seq`), as `lib/ledger.ts` does.
 */
import { and, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";

import { bundle } from "@orrn/db/schema/inventory";
import { processHold, processInput } from "@orrn/db/schema/process";
import { location, stockLedger, type LedgerVoucherType } from "@orrn/db/schema/stock";

import { chunk, mapInChunks, type OrrnDb, type SqliteBatchItem } from "./atomic";
import { sqlUuid } from "./ledger";
import { jobworkRefusal } from "./processRefusals";
import { openProcessHolds, processAbortUnless } from "./process";
import { openBundleRows } from "./ageing";
import { ageingRefusal } from "./ageingRefusals";

/** Inputs per step: enough for a truck to an anodiser, small enough that every statement stays well under D1's limits. */
export const MAX_STEP_BUNDLES = 200;
/** Ids per statement in this module (each statement binds a handful of other values). */
export const STEP_IN_CHUNK = 60;

export type StepBundle = {
  id: string;
  serial: string;
  status: string;
  locationId: string | null;
  locationKind: string | null;
  weightG: number;
  quantity: number;
  lengthMm: number;
  dieId: string;
  castId: string | null;
  salesOrderLineId: string | null;
  currentDispatchId: string | null;
  onLedger: boolean;
  onOpenDispatch: boolean;
};

/** The bundles a step would take, with what the send checks need, company scoped. */
export async function readStepBundles(db: OrrnDb, companyId: string, ids: readonly string[]): Promise<StepBundle[]> {
  const rows = await mapInChunks([...ids], (part) =>
    db
      .select({
        id: bundle.id,
        serial: bundle.serial,
        status: bundle.status,
        locationId: bundle.locationId,
        locationKind: location.kind,
        weightG: bundle.weightG,
        quantity: bundle.quantity,
        lengthMm: bundle.lengthMm,
        dieId: bundle.dieId,
        castId: bundle.castId,
        salesOrderLineId: bundle.salesOrderLineId,
        currentDispatchId: bundle.currentDispatchId,
        onLedger: sql<number>`exists (select 1 from stock_ledger l where l.company_id = ${companyId} and l.item_kind = 'bundle' and l.item_ref = ${bundle.id})`,
        onOpenDispatch: sql<number>`exists (select 1 from dispatch_item di join dispatch d on d.id = di.dispatch_id and d.company_id = di.company_id
          where di.company_id = ${companyId} and di.bundle_id = ${bundle.id} and d.status in ('draft', 'reserved') and d.deleted_at is null)`,
      })
      .from(bundle)
      .leftJoin(location, and(eq(location.id, bundle.locationId), eq(location.companyId, bundle.companyId)))
      .where(and(eq(bundle.companyId, companyId), inArray(bundle.id, part))),
  );
  return rows.map((r) => ({ ...r, onLedger: Boolean(r.onLedger), onOpenDispatch: Boolean(r.onOpenDispatch) }));
}

/**
 * Refuse the first bundle that cannot go on a step: not yard stock, on a dispatch, off the ledger,
 * already on a step, or on a trolley in ageing. Order: the plainest reason first.
 */
export async function assertSendable(db: OrrnDb, companyId: string, rows: readonly StepBundle[]): Promise<void> {
  // Already on a step first: a bundle at a vendor is also "not in the yard", and this says where it is.
  const held = await openProcessHolds(db, companyId, rows.map((b) => b.id));
  for (const b of rows) {
    const h = held.get(b.id);
    if (h) throw jobworkRefusal(h.reason === "jobwork" ? "bundle_at_vendor" : "bundle_in_process", { serial: b.serial, step: h.stepNumber });
  }
  for (const b of rows) {
    if (b.status === "reserved" || b.currentDispatchId || b.onOpenDispatch) throw jobworkRefusal("bundle_on_dispatch", { serial: b.serial });
    if (b.status !== "available" || b.locationKind !== "yard") throw jobworkRefusal("bundle_not_in_stock", { serial: b.serial });
    if (!b.onLedger) throw jobworkRefusal("bundle_off_ledger", { serial: b.serial });
  }
  const trolley = await openBundleRows(db, companyId, rows.map((b) => b.id));
  for (const b of rows) {
    const r = trolley.get(b.id);
    if (r && (r.status === "pending" || r.status === "held")) throw ageingRefusal(r.status === "held" ? "bundle_ageing_held" : "bundle_in_ageing", { serial: b.serial, batch: r.batchNumber });
  }
}

/** SQL over the outer `bundle` row: free to go on a step right now (write-time half of `assertSendable`). */
export function sendableSql(companyId: string): SQL {
  return sql`${bundle.status} = 'available' and ${bundle.currentDispatchId} is null
    and not exists (select 1 from process_hold ph where ph.company_id = ${companyId} and ph.bundle_id = ${bundle.id} and ph.released_at is null)
    and not exists (select 1 from dispatch_item di join dispatch d on d.id = di.dispatch_id and d.company_id = di.company_id
      where di.company_id = ${companyId} and di.bundle_id = ${bundle.id} and d.status in ('draft', 'reserved') and d.deleted_at is null)`;
}

/** SQL over the outer `bundle` row: it sits on an open hold of this step. */
export function onStepSql(companyId: string, stepId: string): SQL {
  return sql`exists (select 1 from process_hold ph where ph.company_id = ${companyId} and ph.bundle_id = ${bundle.id} and ph.step_id = ${stepId} and ph.released_at is null)`;
}

/** Fails the batch unless exactly `ids.length` of these bundles carry this request's seq (every bundle write landed). */
export function allLandedAborts(db: OrrnDb, companyId: string, ids: readonly string[], seq: number, extra?: SQL): SqliteBatchItem[] {
  return chunk([...ids], STEP_IN_CHUNK).map((part) =>
    processAbortUnless(
      db,
      sql`(select count(*) from bundle b where b.company_id = ${companyId} and b.server_seq = ${seq}
        and b.id in (${sql.join(part.map((i) => sql`${i}`), sql`, `)})${extra ? sql` and ${extra}` : sql``}) = ${part.length}`,
    ),
  );
}

/** Open holds on these bundles for this step (insert rows). */
export function holdRows(companyId: string, stepId: string, reason: "jobwork" | "process", ids: readonly string[], at: Date) {
  return ids.map((bundleId) => ({ id: crypto.randomUUID(), companyId, bundleId, stepId, reason, heldAt: at, releasedAt: null, releasedBy: null }));
}

/** Release this step's open holds on these bundles. */
export function releaseHoldStatements(db: OrrnDb, companyId: string, stepId: string, ids: readonly string[], userId: string | null, at: Date): SqliteBatchItem[] {
  return chunk([...ids], STEP_IN_CHUNK).map((part) =>
    db
      .update(processHold)
      .set({ releasedAt: at, releasedBy: userId })
      .where(and(eq(processHold.companyId, companyId), eq(processHold.stepId, stepId), inArray(processHold.bundleId, part), isNull(processHold.releasedAt))),
  );
}

/** Stamp the inputs as back on `returnId`; the batch fails unless every one of them was still out. */
export function closeInputStatements(db: OrrnDb, companyId: string, stepId: string, returnId: string, ids: readonly string[]): SqliteBatchItem[] {
  const out: SqliteBatchItem[] = chunk([...ids], STEP_IN_CHUNK).map((part) =>
    db
      .update(processInput)
      .set({ returnId })
      .where(and(eq(processInput.companyId, companyId), eq(processInput.stepId, stepId), inArray(processInput.bundleId, part), isNull(processInput.returnId))),
  );
  out.push(processAbortUnless(db, sql`(select count(*) from process_input pi where pi.company_id = ${companyId} and pi.step_id = ${stepId} and pi.return_id = ${returnId}) = ${ids.length}`));
  return out;
}

type BalanceRowOpts = {
  companyId: string;
  seq: number;
  userId: string | null;
  postedAt: Date;
  voucherType: LedgerVoucherType;
  voucherId: string;
  /** Lines start after this number. */
  lineOffset: number;
  reason: string;
  /** qty_g as SQL over `b` (the bundle) and `bal` (its ledger balance now). */
  qty: SQL;
  /** Extra condition over `b`. */
  where: SQL;
};

/**
 * One ledger row per selected bundle (alias `b`), its quantity computed from the bundle row and its
 * ledger balance at write time, skipped when that quantity is 0. Only bundles already on the ledger.
 */
export function balanceRows(db: OrrnDb, ids: readonly string[], o: BalanceRowOpts): SqliteBatchItem[] {
  return chunk([...ids], STEP_IN_CHUNK).map(
    (part, partIdx) =>
      db.insert(stockLedger).select(sql`select id, company_id, server_seq, voucher_type, voucher_id, line, item_kind, item_ref, location_id, qty_g, posted_at, reversal_of, reason, created_by, created_at from (
        select ${sqlUuid} as id, ${o.companyId} as company_id, ${o.seq} as server_seq, ${o.voucherType} as voucher_type, ${o.voucherId} as voucher_id,
          ${o.lineOffset + partIdx * STEP_IN_CHUNK} + row_number() over (order by b.serial) as line,
          'bundle' as item_kind, b.id as item_ref, b.location_id as location_id,
          (${o.qty}) as qty_g,
          max(${o.postedAt.getTime()}, coalesce((select max(l.posted_at) + 1 from stock_ledger l where l.company_id = b.company_id and l.item_kind = 'bundle' and l.item_ref = b.id), 0)) as posted_at,
          null as reversal_of, ${o.reason} as reason, ${o.userId} as created_by, ${Date.now()} as created_at
        from bundle b
        where b.company_id = ${o.companyId} and b.server_seq = ${o.seq}
          and b.id in (${sql.join(part.map((i) => sql`${i}`), sql`, `)})
          and exists (select 1 from stock_ledger l where l.company_id = b.company_id and l.item_kind = 'bundle' and l.item_ref = b.id)
          and (${o.where})
      ) r where r.qty_g <> 0`),
  );
}

/** SQL: the outer `b`'s ledger balance right now. Use inside `balanceRows` qty / where. */
export const BAL = sql.raw(`coalesce((select sum(l.qty_g) from stock_ledger l where l.company_id = b.company_id and l.item_kind = 'bundle' and l.item_ref = b.id), 0)`);

/** A + row of reject or process scrap kg at PLANT-SCRAP (return stream `streamId`), voucher = the return. */
export function scrapLedgerRow(
  db: OrrnDb,
  o: { companyId: string; seq: number; userId: string | null; postedAt: Date; returnId: string; line: number; weightG: number; plantScrapId: string; streamId: string; reason: string },
): SqliteBatchItem {
  return db.insert(stockLedger).values({
    id: crypto.randomUUID(),
    companyId: o.companyId,
    serverSeq: o.seq,
    voucherType: "process_scrap",
    voucherId: o.returnId,
    line: o.line,
    itemKind: "return_stream",
    itemRef: o.streamId,
    locationId: o.plantScrapId,
    qtyG: o.weightG,
    postedAt: o.postedAt,
    reversalOf: null,
    reason: o.reason,
    createdBy: o.userId,
  });
}
