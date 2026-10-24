import { TRPCError } from "@trpc/server";
import { and, desc, eq, exists, inArray, isNull, like, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { approval } from "@orrn/db/schema/approval";
import { auditLog } from "@orrn/db/schema/audit";
import { die } from "@orrn/db/schema/catalog";
import { customer } from "@orrn/db/schema/customers";
import {
  dispatch,
  dispatchItem,
  dispatchStatuses,
  transporter,
  type DispatchStatus,
} from "@orrn/db/schema/dispatch";
import { bundle, bundleStatusEvent } from "@orrn/db/schema/inventory";
import { packingList } from "@orrn/db/schema/packing";
import { openSalesOrderStatuses, salesOrder, salesOrderLine } from "@orrn/db/schema/sales";
import { company } from "@orrn/db/schema/tenant";
import { capacityCheck, DISPATCH_TRANSITIONS, normalizeSerial } from "@orrn/domain";

import type { Context } from "../context";
import { actionProcedure, companyProcedure, router } from "../index";
import { requestApprovalInsert } from "../lib/approval";
import { auditInsert, auditInsertGuarded } from "../lib/audit";
import {
  atomicBatch,
  chunk,
  mapInChunks,
  pushChunkedInserts,
  type OrrnDb,
  type SqliteBatchItem,
} from "../lib/atomic";
import { heldElsewhere, type BundleBlock } from "../lib/bundleHold";
import { now as clockNow } from "../lib/clock";
import { formatDispatchCode } from "../lib/dispatchCode";
import { nextDocNumber } from "../lib/docNumber";
import { dispatchRows } from "../lib/ledger";
import {
  batchAbortUnless,
  dispatchOverdraw,
  effectiveToleranceBp,
  isBatchAbort,
  kgText,
  overdrawGuard,
  suggestLines,
  type LineBalance,
  type OverdrawLine,
} from "../lib/orders";
import { can } from "../lib/permissions";
import { bundlesPendingReallocation, pendingReallocationOf } from "../lib/reallocate";
import {
  classifyBundles,
  classifyScan,
  dispatchLoadG,
  refusalOf,
  ScanRefusalError,
  type ScanRefusal,
  type ScanResult,
} from "../lib/scan";
import { nextCompanySeq } from "../lib/sequence";
import { packingListWriteBatch } from "./packingList";

/*
 * State predicates (audit S6). Each procedure reads and checks state first, so
 * sequential misuse (complete after cancel, …) errors. The writes then re-state
 * what they expect, because D1 runs each batch serially but can't abort it when
 * a guarded UPDATE matches 0 rows:
 *   - dispatch UPDATEs carry `status IN (<allowed from>)` and `deleted_at IS NULL`;
 *   - bundle UPDATEs carry `status = <expected>`, plus `current_dispatch_id =
 *     <this dispatch>` when releasing or dispatching;
 *   - every UPDATE that reserves a bundle also requires the dispatch row to be
 *     live and reserved right now (EXISTS); `reserve` runs its dispatch UPDATE
 *     first and requires that its own write landed (`server_seq = <seq>`);
 *   - cancel and unreserve release every bundle still reserved to the dispatch
 *     (not just the items they read); complete releases and unlists any bundle
 *     reserved to it after its read;
 *   - complete runs its dispatch UPDATE first; its bundle → dispatched UPDATEs,
 *     releases and stock-ledger rows (− kg per bundle at its location, ADR-004)
 *     all require that exact write to have landed (completedBySeq).
 *
 * Guaranteed, whatever the interleaving of these procedures: no bundle is left
 * reserved against a dispatch that is not live and reserved, and neither status
 * moves along a transition the domain table forbids.
 *
 * Not guaranteed (audit S6, FLAG; needs real transactions, Postgres rebuild):
 * the losing request's INSERTs still land beside its no-op UPDATEs. That means
 * stray dispatch_item rows (e.g. an add that lost to a cancel lists the bundle
 * on the cancelled dispatch), stray bundle_status_event and audit rows, and,
 * for complete racing cancel, a packing list (with lines) for a dispatch that
 * ended up cancelled.
 */

/** Statuses a dispatch may move to `to` from, per the shared domain table. */
function dispatchStatusesInto(to: DispatchStatus): DispatchStatus[] {
  return (Object.keys(DISPATCH_TRANSITIONS) as DispatchStatus[]).filter((from) =>
    DISPATCH_TRANSITIONS[from].includes(to),
  );
}

function assertDispatchTransition(from: DispatchStatus, to: DispatchStatus) {
  const allowed = DISPATCH_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Dispatch transition ${from} -> ${to} is not allowed.`,
    });
  }
}

/** WHERE for a dispatch UPDATE: this tenant's live row, still in one of `statuses`. */
function dispatchInStatus(companyId: string, id: string, statuses: DispatchStatus[]) {
  return and(
    eq(dispatch.companyId, companyId),
    eq(dispatch.id, id),
    isNull(dispatch.deletedAt),
    inArray(dispatch.status, statuses),
  );
}

const EDITABLE_DISPATCH: DispatchStatus[] = ["draft", "reserved"];

/**
 * IN-list size for bundle UPDATEs that also carry an EXISTS guard: SET (3) +
 * company/status (2) + guard (3-4) bound params on top of the ids stays < 100.
 */
const GUARDED_IN_CHUNK = 80;

/**
 * EXISTS guard for bundle-reserving UPDATEs: the dispatch is live and reserved
 * at write time. With `serverSeq`, it must also be this request's own write.
 */
function dispatchIsHeld(db: OrrnDb, companyId: string, id: string, serverSeq?: number) {
  return exists(
    db
      .select({ one: sql`1` })
      .from(dispatch)
      .where(
        and(
          eq(dispatch.companyId, companyId),
          eq(dispatch.id, id),
          isNull(dispatch.deletedAt),
          eq(dispatch.status, "reserved"),
          serverSeq === undefined ? undefined : eq(dispatch.serverSeq, serverSeq),
        ),
      ),
  );
}

/** EXISTS guard: this request's complete() write landed on the dispatch. */
function completedBySeq(db: OrrnDb, companyId: string, id: string, serverSeq: number) {
  return exists(
    db
      .select({ one: sql`1` })
      .from(dispatch)
      .where(
        and(
          eq(dispatch.companyId, companyId),
          eq(dispatch.id, id),
          eq(dispatch.status, "completed"),
          eq(dispatch.serverSeq, serverSeq),
        ),
      ),
  );
}

/** Catch-all release: every bundle still reserved to this dispatch, read or not. */
function releaseAllHolds(db: OrrnDb, companyId: string, dispatchId: string, seq: number) {
  return db
    .update(bundle)
    .set({ status: "available", currentDispatchId: null, serverSeq: seq })
    .where(
      and(
        eq(bundle.companyId, companyId),
        eq(bundle.currentDispatchId, dispatchId),
        eq(bundle.status, "reserved"),
      ),
    );
}

/** The UNIQUE(dispatch_id, bundle_id) index fired: a concurrent add of the same bundle won. */
function isDuplicateItemError(e: unknown): boolean {
  for (let cur: unknown = e, depth = 0; cur && depth < 5; depth += 1) {
    const message = cur instanceof Error ? cur.message : String(cur);
    if (message.includes("UNIQUE constraint failed: dispatch_item.dispatch_id, dispatch_item.bundle_id")) {
      return true;
    }
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

type ReleaseCtx = {
  db: OrrnDb;
  companyId: string;
  session: { user: { id: string } };
};

/**
 * Writes that free every bundle reserved to `dispatchId`: one status event per
 * bundle read as held, then the catch-all UPDATE (which also catches bundles
 * reserved after the read). A partly lost hold no longer blocks release.
 */
async function releaseStatements(ctx: ReleaseCtx, dispatchId: string, seq: number, reason: string) {
  const held = await ctx.db
    .select({ id: bundle.id })
    .from(bundle)
    .where(
      and(
        eq(bundle.companyId, ctx.companyId),
        eq(bundle.currentDispatchId, dispatchId),
        eq(bundle.status, "reserved"),
      ),
    );
  const statements: SqliteBatchItem[] = [];
  pushChunkedInserts(
    statements,
    (rows) => ctx.db.insert(bundleStatusEvent).values(rows),
    held.map((b) => ({
      id: crypto.randomUUID(),
      companyId: ctx.companyId,
      bundleId: b.id,
      fromStatus: "reserved" as const,
      toStatus: "available" as const,
      reason,
      actorId: ctx.session.user.id,
      dispatchId,
    })),
  );
  statements.push(releaseAllHolds(ctx.db, ctx.companyId, dispatchId, seq));
  return { statements, releasedCount: held.length };
}

/** A bundle linked to an order line when it was scanned on (spec P13 "order line suggested per bundle"). */
export type LinkedBundle = { serial: string; salesOrderLineId: string; orderNumber: string; lineNo: number };

export type AddBundlesReport = {
  added: string[];
  alreadyInDispatch: string[];
  /** Codes no bundle has, plus ambiguous codes (PL-8 shape; `refused` names them `ambiguous`). */
  notFound: string[];
  /**
   * Refused bundles, every one with a `code` (D12: the same order and sentences as `dispatch.scan`):
   * void / dispatched / held, and unassigned, wrong_customer, owned_die (status `available`).
   */
  unavailable: { serial: string; reason: string; code: BundleBlock["code"] | "unassigned" | "wrong_customer" | "owned_die"; status: BundleBlock["status"]; heldBy: string | null }[];
  /** Added bundles that were linked to an open order line of this customer (the rest are unlinked). */
  linked: LinkedBundle[];
};

/** `dispatch.scan`: the add report plus one result per code and the vehicle capacity after it. */
export type ScanReport = AddBundlesReport & {
  /** Every refused code, `{serial, code, reason, …}`, in scan order (ambiguous included). */
  refused: ScanRefusal[];
  /** One result per scanned code, in scan order, outcome per the §E6 order (FP-PK-11/15). */
  results: ScanResult[];
  /** Vehicle capacity after the add (FP-PK-12, warn only). */
  capacity: ReturnType<typeof dispatchCapacity>;
};

/** Vehicle capacity in grams (FP-PK-12): up to 100 t; null = no warning. */
const capacityG = z.number().int().positive().max(100_000_000).nullable().optional();

const createInput = z.object({
  customerId: z.string().min(1, "Customer is required"),
  shipDate: z.number().int().nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
  /** Transporter master (FP-PK-11); its name is snapshotted on the dispatch. */
  transporterId: z.string().min(1).max(64).nullable().optional(),
  vehicleCapacityG: capacityG,
});

/** Text field that clears with null or "" and is trimmed otherwise. */
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v === undefined ? undefined : v === null || v === "" ? null : v));

const ymdDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .refine((v) => {
    const [y, m, d] = v.split("-").map(Number);
    const dt = new Date(Date.UTC(y!, m! - 1, d!));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m! - 1 && dt.getUTCDate() === d;
  }, "Not a real date");

const updateInput = z.object({
  id: z.string(),
  customerId: z.string().optional(),
  shipDate: z.number().int().nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
  // Header (spec P12). Editable until the dispatch is cancelled; after completion only by
  // dispatch.complete holders, and the stored PL header follows.
  /** Vehicle number; spaces and dashes are dropped and letters upper-cased (" gj 05 ab 1234" → "GJ05AB1234"). */
  vehicleNo: z
    .string()
    .max(30)
    .nullable()
    .optional()
    .transform((v) => (v == null ? v : v.replace(/[\s-]+/g, "").toUpperCase() || null))
    .refine((v) => v == null || /^[A-Z0-9]{2,15}$/.test(v), "Vehicle number: letters and digits only"),
  driverName: optText(100),
  driverPhone: optText(20).refine((v) => v == null || /^[+0-9 ()-]{6,20}$/.test(v), "Phone: digits, spaces, + ( ) -"),
  transporter: optText(120),
  /** The Tally invoice number (needs invoice.link). */
  invoiceNumber: optText(50),
  /** The Tally invoice date, company calendar date (needs invoice.link). */
  invoiceDate: ymdDate.nullable().optional(),
  /** Transporter master (FP-PK-11); null clears it. Its name is snapshotted on the dispatch. */
  transporterId: z.string().min(1).max(64).nullable().optional(),
  /** Vehicle capacity in grams (FP-PK-12); null = no warning. */
  vehicleCapacityG: capacityG,
});

/** The transporter row for a dispatch (active, this company), or null to clear. */
async function transporterFor(db: OrrnDb, companyId: string, id: string | null | undefined) {
  if (id === undefined) return undefined;
  if (id === null) return null;
  const [row] = await db
    .select({ id: transporter.id, name: transporter.name, active: transporter.active })
    .from(transporter)
    .where(and(eq(transporter.id, id), eq(transporter.companyId, companyId)))
    .limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Transporter not found" });
  if (!row.active) throw new TRPCError({ code: "BAD_REQUEST", message: `Transporter ${row.name} is retired` });
  return row;
}

const HEADER_FIELDS = ["vehicleNo", "driverName", "driverPhone", "transporter"] as const;
const INVOICE_FIELDS = ["invoiceNumber", "invoiceDate"] as const;
type HeaderField = (typeof HEADER_FIELDS)[number] | (typeof INVOICE_FIELDS)[number];

/** The kg tolerance that applies to a dispatch's customer (customer value, else company default, else 5 %). */
async function dispatchTolerance(db: OrrnDb, companyId: string, customerId: string): Promise<number> {
  const [[cust], [co]] = await Promise.all([
    db
      .select({ bp: customer.kgToleranceBp })
      .from(customer)
      .where(and(eq(customer.id, customerId), eq(customer.companyId, companyId)))
      .limit(1),
    db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1),
  ]);
  return effectiveToleranceBp(cust?.bp ?? null, co?.settings ?? null);
}

function overdrawMessage(lines: OverdrawLine[]): string {
  const parts = lines
    .filter((l) => !l.covered)
    .map((l) => `${l.orderNumber} line ${l.lineNo} by ${kgText(l.overG)} kg (limit ${kgText(l.limitG)} kg)`);
  return `Over the order balance: ${parts.join("; ")}. A manager has to approve before this dispatch can complete.`;
}

type OverdrawCtx = {
  db: OrrnDb;
  companyId: string;
  session: NonNullable<Context["session"]>;
  impersonation?: Context["impersonation"];
};

/** The figures an overdraw request asks for, in a fixed key order (to tell "same ask" from "new ask"). */
function overdrawFigures(meta: unknown): string {
  const m = (meta ?? {}) as { toleranceBp?: unknown; lines?: unknown };
  const lines = Array.isArray(m.lines) ? (m.lines as Record<string, unknown>[]) : [];
  return JSON.stringify([
    m.toleranceBp ?? null,
    lines.map((l) => [l.lineId, l.orderedG, l.limitG, l.totalG, l.overG]),
  ]);
}

/**
 * Review Focus 5: make sure a dispatch_overdraw request names exactly the lines that are over now,
 * then refuse with PRECONDITION_FAILED. Nothing else is written: no stock moves and no PL number is
 * taken. The approval's meta carries kg only (no money), so approval.list may show it.
 *
 * A pending request is NEVER rewritten (an approver may be reading it, and approval.decide approves
 * what the row says): when it already names these figures it is left as it is; when the figures
 * changed, it is withdrawn (rejected, "Withdrawn: …", ruling PL8-R6) and a new request is opened in
 * the same batch, requested by whoever pressed Complete this time (so that person cannot approve it).
 */
async function refuseOverdraw(
  ctx: OverdrawCtx,
  d: { id: string; code: string },
  lines: OverdrawLine[],
  toleranceBp: number,
  note: string | undefined,
): Promise<never> {
  const over = lines.filter((l) => !l.covered);
  const meta = {
    dispatchId: d.id,
    dispatchCode: d.code,
    toleranceBp,
    lines: over.map((l) => ({
      lineId: l.lineId,
      orderNumber: l.orderNumber,
      orderPeriod: l.orderPeriod,
      lineNo: l.lineNo,
      sectionCode: l.sectionCode,
      orderedG: l.orderedG,
      limitG: l.limitG,
      totalG: l.totalG,
      overG: l.overG,
    })),
  };
  const [pending] = await ctx.db
    .select({ id: approval.id, meta: approval.meta })
    .from(approval)
    .where(
      and(
        eq(approval.companyId, ctx.companyId),
        eq(approval.kind, "dispatch_overdraw"),
        eq(approval.subjectId, d.id),
        eq(approval.status, "pending"),
      ),
    )
    .limit(1);
  if (!pending || overdrawFigures(pending.meta) !== overdrawFigures(meta)) {
    const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
    const statements: SqliteBatchItem[] = [];
    if (pending) {
      // Withdraw exactly the request we read, and only while it is still undecided. If it was
      // decided meanwhile this lands nothing and the new request below still opens.
      statements.push(
        ctx.db
          .update(approval)
          .set({ status: "rejected", decidedAt: clockNow(), note: "Withdrawn: asked again with new figures.", serverSeq: seq })
          .where(and(eq(approval.id, pending.id), eq(approval.companyId, ctx.companyId), eq(approval.status, "pending"))),
      );
    }
    const { statement } = requestApprovalInsert(ctx, {
      kind: "dispatch_overdraw",
      subjectId: d.id,
      serverSeq: seq,
      requestNote: note ?? null,
      meta,
    });
    statements.push(
      statement,
      auditInsert(ctx, {
        action: "dispatch.overdraw.request",
        subjectType: "dispatch",
        subjectId: d.id,
        meta: { ...meta, note: note ?? null, ...(pending ? { replaces: pending.id } : {}) },
      }),
    );
    try {
      await atomicBatch(ctx.db, statements);
    } catch (e) {
      // A concurrent refusal opened its request first (one pending request per subject): that one
      // stands, and the next Complete compares against it.
      if (!/UNIQUE constraint failed: approval\./.test(errorChain(e))) throw e;
    }
  } else {
    // Same figures: the pending request stays exactly as the approver sees it, but the history still
    // shows who asked again and why (correctness m-2); the note is not added to the request.
    await atomicBatch(ctx.db, [
      auditInsert(ctx, {
        action: "dispatch.overdraw.request",
        subjectType: "dispatch",
        subjectId: d.id,
        meta: { repeat: true, requestId: pending.id, note: note ?? null },
      }),
    ]);
  }
  throw new TRPCError({ code: "PRECONDITION_FAILED", message: overdrawMessage(lines) });
}

/**
 * Close the dispatch's open dispatch_overdraw request once it is moot (the dispatch completed within
 * what was allowed, was cancelled or deleted). Approval statuses have no "withdrawn", so it becomes
 * `rejected` with no decider and a note saying why (ruling PL8-R6). Lands only if `guard` holds.
 */
function withdrawOverdrawRequests(db: OrrnDb, companyId: string, dispatchId: string, seq: number, at: Date, why: string, guard: SQL) {
  return db
    .update(approval)
    .set({ status: "rejected", decidedAt: at, note: `Withdrawn: ${why}`, serverSeq: seq })
    .where(
      and(
        eq(approval.companyId, companyId),
        eq(approval.kind, "dispatch_overdraw"),
        eq(approval.subjectId, dispatchId),
        eq(approval.status, "pending"),
        guard,
      ),
    );
}

/** EXISTS: this request's write left the dispatch in `status` (it carries this request's seq). */
function dispatchLandedAs(db: OrrnDb, companyId: string, id: string, seq: number, status: DispatchStatus) {
  return exists(
    db
      .select({ one: sql`1` })
      .from(dispatch)
      .where(and(eq(dispatch.companyId, companyId), eq(dispatch.id, id), eq(dispatch.status, status), eq(dispatch.serverSeq, seq))),
  );
}

function errorChain(e: unknown): string {
  let text = "";
  for (let cur: unknown = e, depth = 0; cur && depth < 6; depth += 1) {
    text += ` ${cur instanceof Error ? cur.message : String(cur)}`;
    cur = (cur as { cause?: unknown }).cause;
  }
  return text;
}

function linkedReport(serialOf: Map<string, string>, picks: Map<string, LineBalance>): LinkedBundle[] {
  return [...picks.entries()].map(([bundleId, l]) => ({
    serial: serialOf.get(bundleId) ?? "",
    salesOrderLineId: l.lineId,
    orderNumber: l.orderNumber,
    lineNo: l.lineNo,
  }));
}

/**
 * Write-time half of the scan suggestion: right after the just-added items are inserted, drop a
 * suggested link whose line stopped being an open line of this dispatch's customer and the bundle's
 * section after `suggestLines` read it (order closed or cancelled, line removed, customer changed).
 * The item stays on the dispatch, unlinked; the scan never fails over a suggestion.
 */
function dropStaleSuggestions(db: OrrnDb, companyId: string, dispatchId: string, bundleIds: readonly string[]) {
  return chunk([...bundleIds], GUARDED_IN_CHUNK).map((ids) =>
    db
      .update(dispatchItem)
      .set({ salesOrderLineId: null })
      .where(
        and(
          eq(dispatchItem.companyId, companyId),
          eq(dispatchItem.dispatchId, dispatchId),
          inArray(dispatchItem.bundleId, ids),
          sql`${dispatchItem.salesOrderLineId} is not null`,
          sql`not exists (select 1 from sales_order_line l join sales_order o on o.id = l.sales_order_id and o.company_id = ${companyId} join dispatch dd on dd.id = ${dispatchId} and dd.company_id = ${companyId} join bundle bb on bb.id = ${dispatchItem.bundleId} and bb.company_id = ${companyId} where l.id = ${dispatchItem.salesOrderLineId} and l.company_id = ${companyId} and l.die_id = bb.die_id and o.customer_id = dd.customer_id and o.status in ('booking', 'confirmed', 'dispatching'))`,
        ),
      ),
  );
}

/** The links that actually landed for just-added bundles (a stale suggestion was dropped at write time). */
async function landedLinks(
  db: OrrnDb,
  companyId: string,
  dispatchId: string,
  serialOf: Map<string, string>,
  picks: Map<string, LineBalance>,
): Promise<LinkedBundle[]> {
  if (picks.size === 0) return [];
  const rows = await mapInChunks([...picks.keys()], (ids) =>
    db
      .select({ bundleId: dispatchItem.bundleId, lineId: dispatchItem.salesOrderLineId })
      .from(dispatchItem)
      .where(and(eq(dispatchItem.companyId, companyId), eq(dispatchItem.dispatchId, dispatchId), inArray(dispatchItem.bundleId, ids))),
  );
  const landed = new Map(rows.map((r) => [r.bundleId, r.lineId]));
  const kept = new Map([...picks].filter(([bundleId, l]) => landed.get(bundleId) === l.lineId));
  return linkedReport(serialOf, kept);
}

/**
 * EXISTS-free guard for the completing UPDATE (spec S-2): no item on the dispatch is unlinked by
 * nobody while the dispatch's customer (as it is now) has an open order line for that bundle's
 * section. `relinkOpen` links those items right before completion; this keeps an order created (or
 * reopened) after that read from letting kg leave past the order unseen.
 */
function noUnlinkedWithOpenLine(companyId: string, dispatchId: string): SQL {
  return sql`not exists (select 1 from dispatch_item y join bundle bb on bb.id = y.bundle_id and bb.company_id = ${companyId} join dispatch dd on dd.id = y.dispatch_id and dd.company_id = ${companyId} where y.company_id = ${companyId} and y.dispatch_id = ${dispatchId} and y.sales_order_line_id is null and y.unlinked_by is null and exists (select 1 from sales_order_line l join sales_order o on o.id = l.sales_order_id and o.company_id = ${companyId} where l.company_id = ${companyId} and l.die_id = bb.die_id and o.customer_id = dd.customer_id and o.status in ('booking', 'confirmed', 'dispatching')))`;
}

/**
 * m-2: write-time capacity guard on the completing UPDATE. Without a stored override reason the
 * dispatch completes only while Σ bundle kg is within the vehicle (a capacity lowered between the
 * read and the batch is caught here, not let through with no reason).
 */
function withinCapacityOrReason(companyId: string, dispatchId: string, reason: string | null): SQL {
  if (reason) return sql`1 = 1`;
  return sql`((select dc.vehicle_capacity_g from dispatch dc where dc.id = ${dispatchId} and dc.company_id = ${companyId}) is null
    or (select coalesce(sum(bc.weight_g), 0) from dispatch_item ic join bundle bc on bc.id = ic.bundle_id and bc.company_id = ${companyId}
        where ic.company_id = ${companyId} and ic.dispatch_id = ${dispatchId})
      <= (select dc.vehicle_capacity_g from dispatch dc where dc.id = ${dispatchId} and dc.company_id = ${companyId}))`;
}

type RelinkPlan = {
  statements: SqliteBatchItem[];
  /** The read-time picks (bundle id → line) and serials, for `relinkLanded` after the batch. */
  picks: Map<string, LineBalance>;
  serialOf: Map<string, string>;
};

/**
 * The relink links that actually landed, read after the batch (review round 3 m-3): a pick dropped
 * by `dropStaleSuggestions`, or a relink UPDATE that lost to a completion or cancel, is not listed.
 */
async function relinkLanded(db: OrrnDb, companyId: string, dispatchId: string, plan: RelinkPlan) {
  const landed = await landedLinks(db, companyId, dispatchId, plan.serialOf, plan.picks);
  return landed.map((l) => ({ serial: l.serial, salesOrderLineId: l.salesOrderLineId }));
}

/**
 * Decide the order link again where its premise can change after the scan (spec S-2, correctness
 * I-1): the dispatch's customer was corrected, or an order was entered or reopened while the truck
 * was loading. Every item that is unlinked, and was not unlinked on purpose (`unlinked_by`), gets the
 * scan's suggestion (`suggestLines`, ruling PL8-R10) for `customerId`. The statements only link items
 * still unlinked by nobody, only while the dispatch is draft or reserved, and the write-time half of
 * the suggestion (`dropStaleSuggestions`) drops a link whose line stopped being open meanwhile.
 * `ignoreMarkers` (customer change): an unlink was a decision about the old customer's orders.
 */
async function relinkOpen(
  db: OrrnDb,
  companyId: string,
  d: { id: string; customerId: string },
  opts: { ignoreMarkers?: boolean } = {},
): Promise<RelinkPlan> {
  const rows = await db
    .select({
      bundleId: dispatchItem.bundleId,
      serial: bundle.serial,
      dieId: bundle.dieId,
      weightG: bundle.weightG,
      packedFor: bundle.salesOrderLineId,
    })
    .from(dispatchItem)
    .innerJoin(bundle, and(eq(bundle.id, dispatchItem.bundleId), eq(bundle.companyId, companyId)))
    .where(
      and(
        eq(dispatchItem.companyId, companyId),
        eq(dispatchItem.dispatchId, d.id),
        isNull(dispatchItem.salesOrderLineId),
        opts.ignoreMarkers ? undefined : isNull(dispatchItem.unlinkedBy),
      ),
    )
    .orderBy(bundle.serial);
  if (rows.length === 0) return { statements: [], picks: new Map(), serialOf: new Map() };
  const picks = await suggestLines(db, companyId, {
    customerId: d.customerId,
    dispatchId: d.id,
    bundles: rows.map((r) => ({ id: r.bundleId, dieId: r.dieId, weightG: r.weightG, salesOrderLineId: r.packedFor })),
  });
  const serialOf = new Map(rows.map((r) => [r.bundleId, r.serial]));
  if (picks.size === 0) return { statements: [], picks, serialOf };
  const byLine = new Map<string, string[]>();
  for (const [bundleId, l] of picks) byLine.set(l.lineId, [...(byLine.get(l.lineId) ?? []), bundleId]);
  const statements: SqliteBatchItem[] = [];
  for (const [lineId, ids] of byLine) {
    for (const part of chunk(ids, GUARDED_IN_CHUNK)) {
      statements.push(
        db
          .update(dispatchItem)
          .set({ salesOrderLineId: lineId, unlinkedBy: null })
          .where(
            and(
              eq(dispatchItem.companyId, companyId),
              eq(dispatchItem.dispatchId, d.id),
              inArray(dispatchItem.bundleId, part),
              isNull(dispatchItem.salesOrderLineId),
              opts.ignoreMarkers ? undefined : isNull(dispatchItem.unlinkedBy),
              exists(db.select({ one: sql`1` }).from(dispatch).where(dispatchInStatus(companyId, d.id, EDITABLE_DISPATCH))),
            ),
          ),
      );
    }
  }
  statements.push(...dropStaleSuggestions(db, companyId, d.id, [...picks.keys()]));
  return { statements, picks, serialOf };
}

/** One `dispatch.relink` audit row for the links that landed (none landed: no row). */
async function auditRelink(
  ctx: Pick<Context, "db" | "companyId" | "session" | "impersonation"> & { companyId: string },
  dispatchId: string,
  reason: "complete" | "customer",
  links: { serial: string; salesOrderLineId: string }[],
) {
  if (links.length === 0) return;
  await atomicBatch(ctx.db, [
    auditInsert(
      { db: ctx.db, companyId: ctx.companyId, session: ctx.session, impersonation: ctx.impersonation },
      { action: "dispatch.relink", subjectType: "dispatch", subjectId: dispatchId, meta: { reason, links } },
    ),
  ]);
}

const scanInput = z.object({
  id: z.string(),
  serials: z.array(z.string().min(1)).min(1).max(100),
  /** An approved `die_owner_override` the screen just got (purpose dispatch). */
  approvalId: z.string().min(1).max(64).optional(),
});

/** The office add paths (D12): `allowUnassigned` lifts only the unassigned block, for `order.manage`. */
const addInput = scanInput.extend({ allowUnassigned: z.boolean().optional() });

type ScanCtx = Pick<Context, "db" | "session" | "impersonation"> & {
  companyId: string;
  role: NonNullable<Context["role"]>;
  session: NonNullable<Context["session"]>;
};

/** D12: only `order.manage` holders (the office) may add bundles with no sales order line. */
function assertMayAddUnassigned(ctx: Pick<ScanCtx, "role">, allowUnassigned: boolean | undefined) {
  if (!allowUnassigned) return;
  if (!can({ company: { role: ctx.role }, isPlatformAdmin: false, platformRole: null }, "order.manage")) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Only the office can add bundles that are not on a sales order" });
  }
}

/** One `dispatch.add_unassigned` audit row per bundle the office let on without an order line. */
function addUnassignedAudits(ctx: ScanCtx, dispatchId: string, bundles: readonly { id: string; serial: string }[]) {
  return bundles.map((b) =>
    auditInsert(
      { db: ctx.db, companyId: ctx.companyId, session: ctx.session, impersonation: ctx.impersonation },
      { action: "dispatch.add_unassigned", subjectType: "dispatch", subjectId: dispatchId, meta: { bundleId: b.id, serial: b.serial } },
    ),
  );
}

/** Fill the PL-8 lists of a report from the per-code results. */
function reportLists(results: readonly ScanResult[]) {
  const out = { notFound: [] as string[], alreadyInDispatch: [] as string[], unavailable: [] as AddBundlesReport["unavailable"], refused: [] as ScanRefusal[] };
  for (const r of results) {
    if (r.outcome === "not_found") out.notFound.push(r.code);
    else if (r.outcome === "already_on_dispatch") out.alreadyInDispatch.push(r.serial ?? r.code);
    const refusal = refusalOf(r);
    if (!refusal) continue;
    out.refused.push(refusal);
    if (refusal.code === "ambiguous") {
      out.notFound.push(r.code);
      continue;
    }
    out.unavailable.push({
      serial: refusal.serial,
      reason: refusal.reason,
      code: refusal.code,
      status: refusal.code === "held" ? "reserved" : refusal.code === "void" || refusal.code === "dispatched" ? refusal.code : "available",
      heldBy: refusal.heldBy,
    });
  }
  return out;
}

/** Capacity state of a dispatch (FP-PK-12): loaded kg against the vehicle, warn only. */
export function dispatchCapacity(loadedG: number, capacityG: number | null) {
  return { loadedG, capacityG, ...capacityCheck({ loadedG, capacityG }) };
}

/**
 * Shared by `addBundlesBySerial` (office build) and `dispatch.scan` (floor): one outcome per code in
 * the §E6 order with every block on (D12); the office alone may lift `unassigned` with
 * `allowUnassigned` (`order.manage`, audited `dispatch.add_unassigned`). The `added` ones go on in
 * one batch (reserved at once when the dispatch is held), each linked to its suggested order line.
 * Reports capacity after the add.
 */
async function addByCodes(
  ctx: ScanCtx,
  input: z.infer<typeof addInput>,
  opts: { path: "scan" | "office" },
): Promise<ScanReport> {
  const allowUnassigned = opts.path === "office" && input.allowUnassigned === true;
  assertMayAddUnassigned(ctx, allowUnassigned);
  const serials = Array.from(new Set(input.serials.map(normalizeSerial).filter(Boolean)));
  if (serials.length === 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "No serials provided" });
  }

  const run = async (): Promise<ScanReport> => {
    const d = await ctx.db.query.dispatch.findFirst({
      where: and(eq(dispatch.id, input.id), eq(dispatch.companyId, ctx.companyId), isNull(dispatch.deletedAt)),
    });
    if (!d) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Dispatch not found" });
    }
    if (d.status !== "draft" && d.status !== "reserved") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Bundles can only be added in draft or reserved status",
      });
    }

    const { results, toAdd } = await classifyScan({ db: ctx.db, companyId: ctx.companyId }, d, serials, {
      approvalId: input.approvalId ?? null,
      allowUnassigned,
    });
    const report: ScanReport = {
      added: [],
      linked: [],
      ...reportLists(results),
      results,
      capacity: dispatchCapacity(0, d.vehicleCapacityG),
    };
    if (toAdd.length === 0) {
      report.capacity = dispatchCapacity(await dispatchLoadG(ctx.db, ctx.companyId, d.id), d.vehicleCapacityG);
      return report;
    }
    const unassignedIds = new Set(results.filter((r) => r.outcome === "added" && r.note === "unassigned").map((r) => r.bundleId));

    // Order line suggested per bundle (spec P13): packed-for line, else oldest open line with baki.
    const picks = await suggestLines(ctx.db, ctx.companyId, {
      customerId: d.customerId,
      dispatchId: d.id,
      bundles: toAdd.map((b) => ({ id: b.id, dieId: b.dieId, weightG: b.weightG, salesOrderLineId: b.salesOrderLineId })),
    });
    const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
    const statements: SqliteBatchItem[] = [];
    pushChunkedInserts(
      statements,
      (rows) => ctx.db.insert(dispatchItem).values(rows),
      toAdd.map((b) => ({
        id: crypto.randomUUID(),
        companyId: ctx.companyId,
        dispatchId: d.id,
        bundleId: b.id,
        salesOrderLineId: picks.get(b.id)?.lineId ?? null,
      })),
    );
    if (picks.size > 0) statements.push(...dropStaleSuggestions(ctx.db, ctx.companyId, d.id, [...picks.keys()]));

    if (d.status === "reserved") {
      const addIds = toAdd.map((b) => b.id);
      for (const ids of chunk(addIds, GUARDED_IN_CHUNK)) {
        statements.push(
          ctx.db
            .update(bundle)
            .set({ status: "reserved", currentDispatchId: d.id, serverSeq: seq })
            .where(
              and(
                eq(bundle.companyId, ctx.companyId),
                inArray(bundle.id, ids),
                eq(bundle.status, "available"),
                dispatchIsHeld(ctx.db, ctx.companyId, d.id),
              ),
            ),
        );
      }
      pushChunkedInserts(
        statements,
        (rows) => ctx.db.insert(bundleStatusEvent).values(rows),
        addIds.map((bundleId) => ({
          id: crypto.randomUUID(),
          companyId: ctx.companyId,
          bundleId,
          fromStatus: "available" as const,
          toStatus: "reserved" as const,
          reason: "dispatch.addBundle",
          actorId: ctx.session.user.id,
          dispatchId: d.id,
        })),
      );
    }

    statements.push(
      auditInsert(
        { db: ctx.db, companyId: ctx.companyId, session: ctx.session, impersonation: ctx.impersonation },
        {
          action: "dispatch.addBundle",
          subjectType: "dispatch",
          subjectId: d.id,
          meta: {
            count: toAdd.length,
            serials: toAdd.map((b) => b.serial),
            dispatchStatus: d.status,
            ...(opts.path === "scan" ? { scan: true } : {}),
          },
        },
      ),
      ...addUnassignedAudits(ctx, d.id, toAdd.filter((b) => unassignedIds.has(b.id))),
    );

    await atomicBatch(ctx.db, statements);
    report.added = toAdd.map((b) => b.serial);
    report.linked = await landedLinks(ctx.db, ctx.companyId, d.id, new Map(toAdd.map((b) => [b.id, b.serial])), picks);
    report.capacity = dispatchCapacity(await dispatchLoadG(ctx.db, ctx.companyId, d.id), d.vehicleCapacityG);
    return report;
  };

  try {
    return await run();
  } catch (e) {
    // A concurrent scan inserted one of these first and the whole batch
    // rolled back; re-read once so it lands in alreadyInDispatch.
    if (isDuplicateItemError(e)) return run();
    throw e;
  }
}

export const dispatchRouter = router({
  create: actionProcedure("dispatch.create")
    .input(createInput)
    .mutation(async ({ ctx, input }) => {
      const customerRow = await ctx.db.query.customer.findFirst({
        where: and(
          eq(customer.id, input.customerId),
          eq(customer.companyId, ctx.companyId),
          isNull(customer.deletedAt),
        ),
      });
      if (!customerRow) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Customer not found" });
      }

      const transporterRow = await transporterFor(ctx.db, ctx.companyId, input.transporterId);
      const id = crypto.randomUUID();
      const userId = ctx.session.user.id;

      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      const code = formatDispatchCode(seq);

      await atomicBatch(ctx.db, [
        ctx.db.insert(dispatch).values({
          id,
          companyId: ctx.companyId,
          serverSeq: seq,
          code,
          customerId: input.customerId,
          status: "draft",
          shipDate: input.shipDate ? new Date(input.shipDate) : null,
          notes: input.notes ?? null,
          transporterId: transporterRow?.id ?? null,
          transporterName: transporterRow?.name ?? null,
          vehicleCapacityG: input.vehicleCapacityG ?? null,
          createdBy: userId,
        }),
        auditInsert(
          { db: ctx.db, companyId: ctx.companyId, session: ctx.session, impersonation: ctx.impersonation },
          {
            action: "dispatch.create",
            subjectType: "dispatch",
            subjectId: id,
            meta: { code, customerId: input.customerId },
          },
        ),
      ]);

      return { success: true, id, code };
    }),

  listDispatches: companyProcedure
    .input(
      z.object({
        search: z.string().optional(),
        status: z.enum(dispatchStatuses).optional(),
        customerId: z.string().optional(),
        limit: z.number().min(1).max(100).default(50),
        offset: z.number().default(0),
      }),
    )
    .query(async ({ ctx, input }) => {
      const conditions = [eq(dispatch.companyId, ctx.companyId), isNull(dispatch.deletedAt)];
      if (input.status) conditions.push(eq(dispatch.status, input.status));
      if (input.customerId) conditions.push(eq(dispatch.customerId, input.customerId));
      if (input.search) {
        const pattern = `%${input.search}%`;
        conditions.push(
          // The plant finds a load by its PL number, vehicle or Tally invoice too (spec P7, PL-8 m-1).
          or(
            like(dispatch.code, pattern),
            like(dispatch.notes, pattern),
            like(dispatch.plNumber, pattern),
            like(dispatch.vehicleNo, pattern),
            like(dispatch.invoiceNumber, pattern),
          )!,
        );
      }

      const items = await ctx.db
        .select({
          id: dispatch.id,
          code: dispatch.code,
          status: dispatch.status,
          shipDate: dispatch.shipDate,
          notes: dispatch.notes,
          createdAt: dispatch.createdAt,
          completedAt: dispatch.completedAt,
          plNumber: dispatch.plNumber,
          vehicleNo: dispatch.vehicleNo,
          invoiceNumber: dispatch.invoiceNumber,
          customerId: dispatch.customerId,
          customerName: customer.name,
          itemCount: sql<number>`count(${dispatchItem.id})`.as("item_count"),
          totalQuantity: sql<number>`coalesce(sum(${bundle.quantity}), 0)`.as("total_quantity"),
          totalWeightG: sql<number>`coalesce(sum(${bundle.weightG}), 0)`.as("total_weight_g"),
        })
        .from(dispatch)
        .innerJoin(
          customer,
          and(eq(customer.id, dispatch.customerId), eq(customer.companyId, dispatch.companyId)),
        )
        .leftJoin(
          dispatchItem,
          and(
            eq(dispatchItem.dispatchId, dispatch.id),
            eq(dispatchItem.companyId, dispatch.companyId),
          ),
        )
        .leftJoin(
          bundle,
          and(eq(bundle.id, dispatchItem.bundleId), eq(bundle.companyId, dispatchItem.companyId)),
        )
        .where(and(...conditions))
        .groupBy(dispatch.id, customer.name)
        .orderBy(desc(dispatch.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      const totalRow = await ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(dispatch)
        .where(and(...conditions));

      return { items, total: totalRow[0]?.count ?? 0 };
    }),

  getDispatch: companyProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const row = await ctx.db.query.dispatch.findFirst({
        where: and(
          eq(dispatch.id, input.id),
          eq(dispatch.companyId, ctx.companyId),
          isNull(dispatch.deletedAt),
        ),
      });
      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Dispatch not found" });
      }

      const customerRow = await ctx.db.query.customer.findFirst({
        where: and(eq(customer.id, row.customerId), eq(customer.companyId, ctx.companyId)),
      });

      const itemRows = await ctx.db
        .select({
          itemId: dispatchItem.id,
          bundleId: bundle.id,
          serial: bundle.serial,
          status: bundle.status,
          quantity: bundle.quantity,
          weightG: bundle.weightG,
          lengthMm: bundle.lengthMm,
          groupId: bundle.groupId,
          groupLabel: dispatchItem.groupLabel,
          dieId: bundle.dieId,
          dieSeries: die.series,
          dieSectionCode: die.sectionCode,
          dieName: die.name,
          addedAt: dispatchItem.addedAt,
          salesOrderLineId: dispatchItem.salesOrderLineId,
          orderId: salesOrder.id,
          orderNumber: salesOrder.number,
          lineNo: salesOrderLine.lineNo,
          // The PO the packing list prints: the linked order's, else the bundle's own.
          poNumber: sql<string | null>`coalesce(nullif(trim(${salesOrder.poNumber}), ''), ${bundle.poNumber})`,
        })
        .from(dispatchItem)
        .innerJoin(
          bundle,
          and(eq(bundle.id, dispatchItem.bundleId), eq(bundle.companyId, dispatchItem.companyId)),
        )
        .innerJoin(die, and(eq(die.id, bundle.dieId), eq(die.companyId, bundle.companyId)))
        .leftJoin(
          salesOrderLine,
          and(eq(salesOrderLine.id, dispatchItem.salesOrderLineId), eq(salesOrderLine.companyId, ctx.companyId)),
        )
        .leftJoin(salesOrder, and(eq(salesOrder.id, salesOrderLine.salesOrderId), eq(salesOrder.companyId, ctx.companyId)))
        .where(
          and(
            eq(dispatchItem.dispatchId, row.id),
            eq(dispatchItem.companyId, ctx.companyId),
          ),
        )
        .orderBy(desc(dispatchItem.addedAt))
        .limit(500);
      // While the dispatch can still change, name any other dispatch holding one of its bundles
      // (both drafts listed it; the other was held first), so Build can mark the row.
      const holders =
        row.status === "draft" || row.status === "reserved"
          ? await heldElsewhere(
              ctx.db,
              ctx.companyId,
              row.id,
              itemRows.filter((it) => it.status === "reserved").map((it) => it.bundleId),
            )
          : new Map<string, string>();
      const items = itemRows.map((it) => ({ ...it, heldBy: holders.get(it.bundleId) ?? null }));

      const events = await ctx.db
        .select()
        .from(auditLog)
        .where(
          and(
            eq(auditLog.companyId, ctx.companyId),
            eq(auditLog.subjectType, "dispatch"),
            eq(auditLog.subjectId, row.id),
          ),
        )
        .orderBy(desc(auditLog.at))
        .limit(20);

      // Order-line overdraw state while the dispatch can still change (Review Focus 5).
      let overdraw: {
        toleranceBp: number;
        lines: OverdrawLine[];
        approval: { id: string; status: "pending" | "approved" | "rejected"; note: string | null } | null;
      } | null = null;
      if (row.status === "draft" || row.status === "reserved") {
        const toleranceBp = await dispatchTolerance(ctx.db, ctx.companyId, row.customerId);
        const [lines, [latest]] = await Promise.all([
          dispatchOverdraw(ctx.db, ctx.companyId, row.id, toleranceBp),
          ctx.db
            .select({ id: approval.id, status: approval.status, note: approval.note })
            .from(approval)
            .where(
              and(
                eq(approval.companyId, ctx.companyId),
                eq(approval.kind, "dispatch_overdraw"),
                eq(approval.subjectId, row.id),
              ),
            )
            .orderBy(desc(approval.createdAt), desc(approval.serverSeq))
            .limit(1),
        ]);
        overdraw = { toleranceBp, lines, approval: latest ?? null };
      }

      // FP-PK-12: loaded kg against the vehicle (warn only; complete over it needs a reason).
      const capacity = dispatchCapacity(
        items.reduce((sum, it) => sum + Number(it.weightG), 0),
        row.vehicleCapacityG,
      );

      return { dispatch: row, customer: customerRow ?? null, items, events, overdraw, capacity };
    }),

  update: actionProcedure("dispatch.update")
    .input(updateInput)
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.query.dispatch.findFirst({
        where: and(
          eq(dispatch.id, input.id),
          eq(dispatch.companyId, ctx.companyId),
          isNull(dispatch.deletedAt),
        ),
      });
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Dispatch not found" });
      }
      const me = { company: { role: ctx.role }, isPlatformAdmin: false, platformRole: null };

      const baseChange = input.customerId !== undefined || input.shipDate !== undefined || input.notes !== undefined;
      const header: Partial<Record<HeaderField, string | null>> = {};
      for (const f of [...HEADER_FIELDS, ...INVOICE_FIELDS]) {
        if (input[f] !== undefined) header[f] = input[f] ?? null;
      }
      const headerKeys = Object.keys(header) as HeaderField[];
      // FP-PK-11/12: transporter master and vehicle capacity follow the header rules.
      const transporterRow = await transporterFor(ctx.db, ctx.companyId, input.transporterId);
      const transport: { transporterId?: string | null; transporterName?: string | null; vehicleCapacityG?: number | null } = {};
      if (transporterRow !== undefined) {
        transport.transporterId = transporterRow?.id ?? null;
        transport.transporterName = transporterRow?.name ?? null;
      }
      if (input.vehicleCapacityG !== undefined) transport.vehicleCapacityG = input.vehicleCapacityG;
      const transportChange = Object.keys(transport).length > 0;

      if (baseChange && existing.status !== "draft") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Only draft dispatches can be edited" });
      }
      if ((headerKeys.length > 0 || transportChange) && existing.status === "cancelled") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "A cancelled dispatch can't be changed" });
      }
      if (headerKeys.some((k) => (INVOICE_FIELDS as readonly string[]).includes(k)) && !can(me, "invoice.link")) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You don't have permission to do that" });
      }
      if (
        existing.status === "completed" &&
        (transportChange || headerKeys.some((k) => (HEADER_FIELDS as readonly string[]).includes(k))) &&
        !can(me, "dispatch.complete")
      ) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You don't have permission to do that" });
      }
      // m-2: the capacity the dispatch completed against (and its override reason) stays as it was.
      if (existing.status === "completed" && input.vehicleCapacityG !== undefined && input.vehicleCapacityG !== existing.vehicleCapacityG) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "The vehicle capacity can't change after the dispatch is completed" });
      }

      if (input.customerId && input.customerId !== existing.customerId) {
        const newCustomer = await ctx.db.query.customer.findFirst({
          where: and(
            eq(customer.id, input.customerId),
            eq(customer.companyId, ctx.companyId),
            isNull(customer.deletedAt),
          ),
        });
        if (!newCustomer) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Customer not found" });
        }
        const [linked] = await ctx.db
          .select({ id: dispatchItem.id })
          .from(dispatchItem)
          .where(
            and(
              eq(dispatchItem.companyId, ctx.companyId),
              eq(dispatchItem.dispatchId, existing.id),
              sql`${dispatchItem.salesOrderLineId} is not null`,
            ),
          )
          .limit(1);
        if (linked) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Bundles here are linked to this customer's orders. Unlink them before changing the customer.",
          });
        }
      }

      // A corrected customer gets the scan's suggestion for every bundle already on the dispatch
      // (spec S-2): kg that leave for a customer with an open line for the section meet the order.
      const customerChange = Boolean(input.customerId && input.customerId !== existing.customerId);
      const relink = customerChange
        ? await relinkOpen(ctx.db, ctx.companyId, { id: existing.id, customerId: input.customerId! }, { ignoreMarkers: true })
        : { statements: [], picks: new Map<string, LineBalance>(), serialOf: new Map<string, string>() };

      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      // Write-time: the edit lands only in the state it was checked for. A header edit read on a
      // draft/reserved dispatch must not land on one that completed meanwhile (R7: after completion
      // only dispatch.complete holders edit the header, and the stored PL header must follow).
      const allowed: DispatchStatus[] = baseChange
        ? ["draft"]
        : existing.status === "completed"
          ? ["completed"]
          : EDITABLE_DISPATCH;
      const statements: SqliteBatchItem[] = [
        ctx.db
          .update(dispatch)
          .set({
            ...(baseChange
              ? {
                  customerId: input.customerId ?? existing.customerId,
                  shipDate:
                    input.shipDate === undefined
                      ? existing.shipDate
                      : input.shipDate === null
                        ? null
                        : new Date(input.shipDate),
                  // undefined = leave as is; null clears (audit S18).
                  notes: input.notes === undefined ? existing.notes : input.notes,
                }
              : {}),
            ...header,
            ...transport,
            serverSeq: seq,
          })
          .where(
            and(
              dispatchInStatus(ctx.companyId, existing.id, allowed),
              // Write-time: a customer change never strands items linked to the old customer's orders.
              input.customerId && input.customerId !== existing.customerId
                ? sql`not exists (select 1 from dispatch_item di where di.company_id = ${ctx.companyId} and di.dispatch_id = ${existing.id} and di.sales_order_line_id is not null)`
                : undefined,
            ),
          ),
        // Nothing below lands (PL header, audit) unless that exact write did: an edit that lost a
        // race (reserved, completed or cancelled meanwhile, or a bundle linked) fails as CONFLICT
        // instead of answering success for a change that never happened.
        batchAbortUnless(
          ctx.db,
          "packing_list_line",
          exists(
            ctx.db
              .select({ one: sql`1` })
              .from(dispatch)
              .where(and(eq(dispatch.id, existing.id), eq(dispatch.companyId, ctx.companyId), eq(dispatch.serverSeq, seq))),
          ),
        ),
      ];
      if (customerChange) {
        // An unlink on purpose was a decision about the old customer's orders: it does not carry over.
        statements.push(
          ctx.db
            .update(dispatchItem)
            .set({ unlinkedBy: null })
            .where(and(eq(dispatchItem.companyId, ctx.companyId), eq(dispatchItem.dispatchId, existing.id))),
          ...relink.statements,
        );
      }
      if (existing.status === "completed" && (headerKeys.length > 0 || transport.transporterName !== undefined)) {
        // The stored PL follows a header correction (same PL number, same rows). The printed
        // transporter is the master's name, else the free text.
        const printed: Partial<Record<string, string | null>> = { ...header };
        if (transport.transporterName !== undefined || header.transporter !== undefined) {
          printed.transporter =
            (transport.transporterName !== undefined ? transport.transporterName : existing.transporterName) ??
            (header.transporter !== undefined ? header.transporter : existing.transporter) ??
            null;
        }
        const paths = Object.keys(printed).flatMap((k) => [sql.raw(`'$.header.${k}'`), sql`${printed[k] ?? null}`]);
        statements.push(
          ctx.db
            .update(packingList)
            .set({ snapshot: sql`json_set(${packingList.snapshot}, ${sql.join(paths, sql`, `)})` })
            .where(
              and(
                eq(packingList.companyId, ctx.companyId),
                eq(packingList.dispatchId, existing.id),
                sql`json_extract(${packingList.snapshot}, '$.version') = 2`,
                // Only the current revision: a sent (superseded) copy is never rewritten (C24).
                sql`not exists (select 1 from ${packingList} p2 where p2.company_id = ${ctx.companyId} and p2.supersedes_id = ${packingList.id})`,
                exists(
                  ctx.db
                    .select({ one: sql`1` })
                    .from(dispatch)
                    .where(and(eq(dispatch.id, existing.id), eq(dispatch.companyId, ctx.companyId), eq(dispatch.serverSeq, seq))),
                ),
              ),
            ),
        );
      }
      statements.push(
        auditInsert(
          { db: ctx.db, companyId: ctx.companyId, session: ctx.session, impersonation: ctx.impersonation },
          {
            action: "dispatch.update",
            subjectType: "dispatch",
            subjectId: existing.id,
            meta: {
              ...(baseChange
                ? { customerId: input.customerId ?? existing.customerId, shipDate: input.shipDate ?? null }
                : {}),
              ...(headerKeys.length
                ? {
                    header: Object.fromEntries(headerKeys.map((k) => [k, { from: existing[k] ?? null, to: header[k] ?? null }])),
                  }
                : {}),
              ...(transportChange
                ? {
                    transport: Object.fromEntries(
                      (Object.keys(transport) as (keyof typeof transport)[]).map((k) => [k, { from: existing[k] ?? null, to: transport[k] ?? null }]),
                    ),
                  }
                : {}),
            },
          },
        ),
      );
      try {
        await atomicBatch(ctx.db, statements);
      } catch (e) {
        if (!isBatchAbort(e, "packing_list_line")) throw e;
        throw new TRPCError({ code: "CONFLICT", message: "This dispatch changed meanwhile. Reload and try again." });
      }
      if (relink.picks.size > 0) {
        await auditRelink(ctx, existing.id, "customer", await relinkLanded(ctx.db, ctx.companyId, existing.id, relink));
      }
      return { success: true };
    }),

  /**
   * Link a dispatch item to a sales order line, or unlink it with null (spec P13). The line must be
   * an open order of this dispatch's customer, for the bundle's section; the dispatch must still
   * be draft or reserved. Overdraw is checked when the dispatch completes.
   *
   * Unlinking a bundle while the customer has an open line for its section takes it out of the
   * Review Focus 5 check, so it needs order.manage (office, manager, owner): the floor cannot send
   * kg beyond the order without the override by unlinking it (fix round 1, correctness I-2).
   */
  linkItem: actionProcedure("dispatch.scan")
    .input(z.object({ itemId: z.string().min(1).max(64), salesOrderLineId: z.string().min(1).max(64).nullable() }))
    .mutation(async ({ ctx, input }) => {
      const [item] = await ctx.db
        .select({
          id: dispatchItem.id,
          dispatchId: dispatchItem.dispatchId,
          bundleId: dispatchItem.bundleId,
          dieId: bundle.dieId,
          serial: bundle.serial,
          status: dispatch.status,
          customerId: dispatch.customerId,
          from: dispatchItem.salesOrderLineId,
        })
        .from(dispatchItem)
        .innerJoin(
          dispatch,
          and(eq(dispatch.id, dispatchItem.dispatchId), eq(dispatch.companyId, ctx.companyId), isNull(dispatch.deletedAt)),
        )
        .innerJoin(bundle, and(eq(bundle.id, dispatchItem.bundleId), eq(bundle.companyId, ctx.companyId)))
        .where(and(eq(dispatchItem.id, input.itemId), eq(dispatchItem.companyId, ctx.companyId)))
        .limit(1);
      if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });
      if (!EDITABLE_DISPATCH.includes(item.status)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Order lines can only be changed before the dispatch completes" });
      }
      const me = { company: { role: ctx.role }, isPlatformAdmin: false, platformRole: null };
      // An unlink by someone without order.manage (the floor) is checked here and in the UPDATE itself.
      const guardedUnlink = input.salesOrderLineId === null && !can(me, "order.manage");
      /** EXISTS: the dispatch's customer (as it is now) has an open order line for the bundle's section. */
      const openLineForBundle = sql`exists (select 1 from sales_order_line l join sales_order o on o.id = l.sales_order_id and o.company_id = ${ctx.companyId} join dispatch dd on dd.id = ${item.dispatchId} and dd.company_id = ${ctx.companyId} where l.company_id = ${ctx.companyId} and l.die_id = ${item.dieId} and o.customer_id = dd.customer_id and o.status in ('booking', 'confirmed', 'dispatching'))`;
      if (guardedUnlink && item.from !== null) {
        const [{ open } = { open: 0 }] = await ctx.db.select({ open: sql<number>`${openLineForBundle}` }).from(company).where(eq(company.id, ctx.companyId));
        if (Number(open)) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "This customer has an open order for this section. Only the office can take the bundle off the order.",
          });
        }
      }
      if (input.salesOrderLineId) {
        const [line] = await ctx.db
          .select({ dieId: salesOrderLine.dieId, customerId: salesOrder.customerId, status: salesOrder.status, number: salesOrder.number })
          .from(salesOrderLine)
          .innerJoin(salesOrder, and(eq(salesOrder.id, salesOrderLine.salesOrderId), eq(salesOrder.companyId, ctx.companyId)))
          .where(and(eq(salesOrderLine.id, input.salesOrderLineId), eq(salesOrderLine.companyId, ctx.companyId)))
          .limit(1);
        if (!line) throw new TRPCError({ code: "NOT_FOUND", message: "Order line not found" });
        if (line.customerId !== item.customerId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "That order is for another customer" });
        }
        if (!(openSalesOrderStatuses as readonly string[]).includes(line.status)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `Order ${line.number} is ${line.status}` });
        }
        if (line.dieId !== item.dieId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "That order line is for another section" });
        }
      }

      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      await atomicBatch(ctx.db, [
        ctx.db
          .update(dispatchItem)
          // A link clears the mark. An unlink marks the item "unlinked on purpose" (completion and a
          // customer change do not re-suggest it) only when it is a deliberate office decision: the
          // caller holds order.manage AND the item was linked at write time (SQLite evaluates SET on
          // the old row). A no-op unlink of a never-linked item, or any floor unlink, leaves the mark
          // as it was, so completion's relink and `noUnlinkedWithOpenLine` still cover the bundle
          // (review round 3 I-1, ruling PL8-R15).
          .set({
            salesOrderLineId: input.salesOrderLineId,
            unlinkedBy: input.salesOrderLineId
              ? null
              : guardedUnlink
                ? sql`${sql.identifier("unlinked_by")}`
                : sql`case when ${sql.identifier("sales_order_line_id")} is not null then ${ctx.session.user.id} else ${sql.identifier("unlinked_by")} end`,
          })
          .where(
            and(
              eq(dispatchItem.id, item.id),
              eq(dispatchItem.companyId, ctx.companyId),
              // Write-time: only while the dispatch can still change, and (when linking) only to an
              // open order of the dispatch's customer as it is now.
              exists(
                ctx.db
                  .select({ one: sql`1` })
                  .from(dispatch)
                  .where(dispatchInStatus(ctx.companyId, item.dispatchId, EDITABLE_DISPATCH)),
              ),
              input.salesOrderLineId
                ? sql`exists (select 1 from sales_order_line l join sales_order o on o.id = l.sales_order_id and o.company_id = ${ctx.companyId} join dispatch dd on dd.id = ${item.dispatchId} and dd.company_id = ${ctx.companyId} join bundle bb on bb.id = ${item.bundleId} and bb.company_id = ${ctx.companyId} where l.id = ${input.salesOrderLineId} and l.company_id = ${ctx.companyId} and l.die_id = bb.die_id and o.customer_id = dd.customer_id and o.status in ('booking', 'confirmed', 'dispatching'))`
                : undefined,
              // Write-time half of the unlink rule: an open line for the section appearing after the
              // read (order created or reopened, customer changed) refuses the floor's unlink.
              guardedUnlink ? sql`not ${openLineForBundle}` : undefined,
            ),
          ),
        ctx.db
          .update(dispatch)
          .set({ serverSeq: seq })
          .where(dispatchInStatus(ctx.companyId, item.dispatchId, EDITABLE_DISPATCH)),
        auditInsertGuarded(
          { db: ctx.db, companyId: ctx.companyId, session: ctx.session, impersonation: ctx.impersonation },
          {
            action: "dispatch.linkItem",
            subjectType: "dispatch",
            subjectId: item.dispatchId,
            meta: { itemId: item.id, serial: item.serial, from: item.from, to: input.salesOrderLineId },
          },
          {
            from: dispatchItem,
            where: and(
              eq(dispatchItem.id, item.id),
              eq(dispatchItem.companyId, ctx.companyId),
              sql`${dispatchItem.salesOrderLineId} is ${input.salesOrderLineId}`,
            ),
          },
        ),
      ]);
      const [after] = await ctx.db
        .select({ line: dispatchItem.salesOrderLineId })
        .from(dispatchItem)
        .where(and(eq(dispatchItem.id, item.id), eq(dispatchItem.companyId, ctx.companyId)))
        .limit(1);
      if (!after || after.line !== input.salesOrderLineId) {
        throw new TRPCError({ code: "CONFLICT", message: "This dispatch changed meanwhile. Reload and try again." });
      }
      return { success: true };
    }),

  /**
   * One bundle by id. Refuses exactly like `dispatch.scan` (D12, §E6 order and sentences): the
   * TRPCError's `cause` is a ScanRefusalError, sent to clients as `error.data.refusal` `{code, reason}`.
   * `allowUnassigned` (office, `order.manage`) lifts only the unassigned block, audited.
   */
  addBundle: actionProcedure("dispatch.addBundle")
    .input(
      z.object({
        id: z.string(),
        bundleId: z.string(),
        approvalId: z.string().min(1).max(64).optional(),
        allowUnassigned: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertMayAddUnassigned(ctx, input.allowUnassigned);
      const run = async () => {
        const d = await ctx.db.query.dispatch.findFirst({
          where: and(
            eq(dispatch.id, input.id),
            eq(dispatch.companyId, ctx.companyId),
            isNull(dispatch.deletedAt),
          ),
        });
        if (!d) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Dispatch not found" });
        }
        if (d.status !== "draft" && d.status !== "reserved") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Bundles can only be added in draft or reserved status",
          });
        }

        const b = await ctx.db.query.bundle.findFirst({
          where: and(eq(bundle.id, input.bundleId), eq(bundle.companyId, ctx.companyId)),
        });
        if (!b) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Bundle not found" });
        }

        // Already-added first (audit S13): a rescan on a held dispatch finds the
        // bundle reserved by this very dispatch, which is fine, not an error.
        const existingItem = await ctx.db.query.dispatchItem.findFirst({
          where: and(
            eq(dispatchItem.companyId, ctx.companyId),
            eq(dispatchItem.dispatchId, d.id),
            eq(dispatchItem.bundleId, b.id),
          ),
        });
        if (existingItem) {
          return { success: true, added: [] as string[], alreadyInDispatch: [b.serial], linked: [] as LinkedBundle[] };
        }

        // The §E6 order, same as a scan: void, dispatched, held, unassigned, wrong customer, owned die.
        const { results } = await classifyBundles(
          { db: ctx.db, companyId: ctx.companyId },
          d,
          [b.serial],
          new Map([[b.serial, b]]),
          new Map(),
          { approvalId: input.approvalId ?? null, allowUnassigned: input.allowUnassigned === true },
        );
        const verdict = results[0]!;
        const refusal = refusalOf(verdict);
        if (refusal) {
          throw new TRPCError({
            code: refusal.code === "owned_die" ? "FORBIDDEN" : "BAD_REQUEST",
            message: refusal.reason,
            cause: new ScanRefusalError(refusal),
          });
        }
        if (verdict.outcome === "already_on_dispatch") {
          return { success: true, added: [] as string[], alreadyInDispatch: [b.serial], linked: [] as LinkedBundle[] };
        }

        const picks = await suggestLines(ctx.db, ctx.companyId, {
          customerId: d.customerId,
          dispatchId: d.id,
          bundles: [{ id: b.id, dieId: b.dieId, weightG: b.weightG, salesOrderLineId: b.salesOrderLineId }],
        });
        const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
        const statements: SqliteBatchItem[] = [
          ctx.db.insert(dispatchItem).values({
            id: crypto.randomUUID(),
            companyId: ctx.companyId,
            dispatchId: d.id,
            bundleId: b.id,
            salesOrderLineId: picks.get(b.id)?.lineId ?? null,
          }),
          ...(picks.size > 0 ? dropStaleSuggestions(ctx.db, ctx.companyId, d.id, [b.id]) : []),
        ];

        if (d.status === "reserved") {
          statements.push(
            ctx.db
              .update(bundle)
              .set({ status: "reserved", currentDispatchId: d.id, serverSeq: seq })
              .where(
                and(
                  eq(bundle.companyId, ctx.companyId),
                  eq(bundle.id, b.id),
                  eq(bundle.status, "available"),
                  dispatchIsHeld(ctx.db, ctx.companyId, d.id),
                ),
              ),
            ctx.db.insert(bundleStatusEvent).values({
              id: crypto.randomUUID(),
              companyId: ctx.companyId,
              bundleId: b.id,
              fromStatus: "available",
              toStatus: "reserved",
              reason: "dispatch.addBundle",
              actorId: ctx.session.user.id,
              dispatchId: d.id,
            }),
          );
        }

        statements.push(
          auditInsert(
            { db: ctx.db, companyId: ctx.companyId, session: ctx.session, impersonation: ctx.impersonation },
            {
              action: "dispatch.addBundle",
              subjectType: "dispatch",
              subjectId: d.id,
              meta: { bundleId: b.id, serial: b.serial, dispatchStatus: d.status },
            },
          ),
          ...addUnassignedAudits(ctx, d.id, verdict.note === "unassigned" ? [b] : []),
        );

        await atomicBatch(ctx.db, statements);
        return {
          success: true,
          added: [b.serial],
          alreadyInDispatch: [] as string[],
          linked: await landedLinks(ctx.db, ctx.companyId, d.id, new Map([[b.id, b.serial]]), picks),
        };
      };

      try {
        return await run();
      } catch (e) {
        // A concurrent scan of the same bundle inserted first; the batch rolled
        // back, so re-read: this time it reports "already in this dispatch".
        if (isDuplicateItemError(e)) return run();
        throw e;
      }
    }),

  /**
   * Adds bundles by serial and reports per serial instead of all-or-nothing: the valid serials
   * still go in. Same §E6 order and blocks as `dispatch.scan` (D12); every refusal is in
   * `unavailable` with a `code` (an ambiguous code stays in `notFound`, PL-8 shape). The office (`order.manage`) may pass `allowUnassigned`
   * for legacy stock with no order line (audited `dispatch.add_unassigned`); other customers'
   * bundles stay refused (move them with `orders.reallocate`).
   */
  addBundlesBySerial: actionProcedure("dispatch.addBundle")
    .input(addInput)
    .mutation(async ({ ctx, input }): Promise<AddBundlesReport> => {
      // The PL-8 report shape, unchanged for its clients: an ambiguous code is in `notFound`.
      const r = await addByCodes(ctx, input, { path: "office" });
      return { added: r.added, alreadyInDispatch: r.alreadyInDispatch, notFound: r.notFound, unavailable: r.unavailable, linked: r.linked };
    }),

  /**
   * FP-PK-11/15: the floor scan. Same as `addBundlesBySerial`, and `allowUnassigned` is never
   * honoured here (D12): a bundle with no sales order line (not moved to plant stock) or packed
   * for another customer is refused; moving it is `orders.reallocate`.
   */
  scan: actionProcedure("dispatch.scan")
    .input(scanInput)
    .mutation(({ ctx, input }) => addByCodes(ctx, input, { path: "scan" })),

  setItemGroupLabel: actionProcedure("dispatch.addBundle")
    .input(z.object({ id: z.string(), bundleId: z.string(), groupLabel: z.string().max(32).nullable() }))
    .mutation(async ({ ctx, input }) => {
      const d = await ctx.db.query.dispatch.findFirst({
        where: and(
          eq(dispatch.id, input.id),
          eq(dispatch.companyId, ctx.companyId),
          isNull(dispatch.deletedAt),
        ),
      });
      if (!d) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Dispatch not found" });
      }
      if (d.status !== "draft" && d.status !== "reserved") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Packing groups can only be edited before completion" });
      }

      // Audit S18: an UPDATE on a missing item used to no-op silently.
      const existingItem = await ctx.db.query.dispatchItem.findFirst({
        where: and(
          eq(dispatchItem.companyId, ctx.companyId),
          eq(dispatchItem.dispatchId, d.id),
          eq(dispatchItem.bundleId, input.bundleId),
        ),
      });
      if (!existingItem) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Bundle not in this dispatch" });
      }

      const label = input.groupLabel?.trim().toUpperCase() || null;
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      await atomicBatch(ctx.db, [
        ctx.db
          .update(dispatchItem)
          .set({ groupLabel: label })
          .where(
            and(
              eq(dispatchItem.companyId, ctx.companyId),
              eq(dispatchItem.dispatchId, d.id),
              eq(dispatchItem.bundleId, input.bundleId),
            ),
          ),
        ctx.db
          .update(dispatch)
          .set({ serverSeq: seq })
          .where(dispatchInStatus(ctx.companyId, d.id, EDITABLE_DISPATCH)),
        auditInsert(
          { db: ctx.db, companyId: ctx.companyId, session: ctx.session, impersonation: ctx.impersonation },
          {
            action: "dispatch.setPackingGroup",
            subjectType: "dispatch",
            subjectId: d.id,
            meta: { bundleId: input.bundleId, groupLabel: label },
          },
        ),
      ]);
      return { success: true };
    }),

  removeBundle: actionProcedure("dispatch.addBundle")
    .input(z.object({ id: z.string(), bundleId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const d = await ctx.db.query.dispatch.findFirst({
        where: and(
          eq(dispatch.id, input.id),
          eq(dispatch.companyId, ctx.companyId),
          isNull(dispatch.deletedAt),
        ),
      });
      if (!d) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Dispatch not found" });
      }
      if (d.status !== "draft" && d.status !== "reserved") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Bundles can only be removed in draft or reserved status",
        });
      }

      const existingItem = await ctx.db.query.dispatchItem.findFirst({
        where: and(
          eq(dispatchItem.companyId, ctx.companyId),
          eq(dispatchItem.dispatchId, d.id),
          eq(dispatchItem.bundleId, input.bundleId),
        ),
      });
      if (!existingItem) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Bundle not in this dispatch" });
      }

      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      const statements: SqliteBatchItem[] = [
        ctx.db
          .delete(dispatchItem)
          .where(
            and(
              eq(dispatchItem.companyId, ctx.companyId),
              eq(dispatchItem.dispatchId, d.id),
              eq(dispatchItem.bundleId, input.bundleId),
            ),
          ),
      ];

      if (d.status === "reserved") {
        const b = await ctx.db.query.bundle.findFirst({
          where: and(eq(bundle.id, input.bundleId), eq(bundle.companyId, ctx.companyId)),
        });
        // Only release a hold that belongs to this dispatch (audit S6): the
        // bundle may be held by another dispatch that also lists it.
        if (b && b.status === "reserved" && b.currentDispatchId === d.id) {
          statements.push(
            ctx.db
              .update(bundle)
              .set({ status: "available", currentDispatchId: null, serverSeq: seq })
              .where(
                and(
                  eq(bundle.companyId, ctx.companyId),
                  eq(bundle.id, b.id),
                  eq(bundle.status, "reserved"),
                  eq(bundle.currentDispatchId, d.id),
                ),
              ),
            ctx.db.insert(bundleStatusEvent).values({
              id: crypto.randomUUID(),
              companyId: ctx.companyId,
              bundleId: b.id,
              fromStatus: "reserved",
              toStatus: "available",
              reason: "dispatch.removeBundle",
              actorId: ctx.session.user.id,
              dispatchId: d.id,
            }),
          );
        }
      }

      statements.push(
        auditInsert(
          { db: ctx.db, companyId: ctx.companyId, session: ctx.session, impersonation: ctx.impersonation },
          {
            action: "dispatch.removeBundle",
            subjectType: "dispatch",
            subjectId: d.id,
            meta: { bundleId: input.bundleId, dispatchStatus: d.status },
          },
        ),
      );

      await atomicBatch(ctx.db, statements);
      return { success: true };
    }),

  reserve: actionProcedure("dispatch.reserve")
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const d = await ctx.db.query.dispatch.findFirst({
        where: and(
          eq(dispatch.id, input.id),
          eq(dispatch.companyId, ctx.companyId),
          isNull(dispatch.deletedAt),
        ),
      });
      if (!d) throw new TRPCError({ code: "NOT_FOUND", message: "Dispatch not found" });
      assertDispatchTransition(d.status, "reserved");

      const items = await ctx.db
        .select({ bundleId: dispatchItem.bundleId })
        .from(dispatchItem)
        .where(
          and(eq(dispatchItem.companyId, ctx.companyId), eq(dispatchItem.dispatchId, d.id)),
        );

      if (items.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot reserve an empty dispatch",
        });
      }

      const bundleIds = items.map((i) => i.bundleId);
      const bundles = await mapInChunks(bundleIds, (ids) =>
        ctx.db
          .select()
          .from(bundle)
          .where(and(eq(bundle.companyId, ctx.companyId), inArray(bundle.id, ids))),
      );

      const notAvailable = bundles.filter((b) => b.status !== "available");
      if (notAvailable.length > 0) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Cannot reserve: ${notAvailable.length} bundle(s) no longer available (${notAvailable
            .slice(0, 3)
            .map((b) => `${b.serial}=${b.status}`)
            .join(", ")}${notAvailable.length > 3 ? "…" : ""})`,
        });
      }

      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);

      // Dispatch first; the bundle holds only apply if that exact write landed
      // (a softDelete or cancel that won the race leaves server_seq != seq).
      const statements: SqliteBatchItem[] = [
        ctx.db
          .update(dispatch)
          .set({ status: "reserved", serverSeq: seq })
          .where(dispatchInStatus(ctx.companyId, d.id, dispatchStatusesInto("reserved"))),
      ];
      for (const ids of chunk(bundleIds, GUARDED_IN_CHUNK)) {
        statements.push(
          ctx.db
            .update(bundle)
            .set({ status: "reserved", currentDispatchId: d.id, serverSeq: seq })
            .where(
              and(
                eq(bundle.companyId, ctx.companyId),
                inArray(bundle.id, ids),
                eq(bundle.status, "available"),
                dispatchIsHeld(ctx.db, ctx.companyId, d.id, seq),
              ),
            ),
        );
      }
      pushChunkedInserts(
        statements,
        (rows) => ctx.db.insert(bundleStatusEvent).values(rows),
        bundleIds.map((bid) => ({
          id: crypto.randomUUID(),
          companyId: ctx.companyId,
          bundleId: bid,
          fromStatus: "available" as const,
          toStatus: "reserved" as const,
          reason: "dispatch.reserve",
          actorId: ctx.session.user.id,
          dispatchId: d.id,
        })),
      );
      statements.push(
        auditInsert(
          { db: ctx.db, companyId: ctx.companyId, session: ctx.session, impersonation: ctx.impersonation },
          {
            action: "dispatch.reserve",
            subjectType: "dispatch",
            subjectId: d.id,
            meta: { itemCount: items.length },
          },
        ),
      );
      await atomicBatch(ctx.db, statements);
      return { success: true };
    }),

  unreserve: actionProcedure("dispatch.reserve")
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const d = await ctx.db.query.dispatch.findFirst({
        where: and(
          eq(dispatch.id, input.id),
          eq(dispatch.companyId, ctx.companyId),
          isNull(dispatch.deletedAt),
        ),
      });
      if (!d) throw new TRPCError({ code: "NOT_FOUND", message: "Dispatch not found" });
      assertDispatchTransition(d.status, "draft");

      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      const { statements, releasedCount } = await releaseStatements(ctx, d.id, seq, "dispatch.unreserve");
      statements.push(
        ctx.db
          .update(dispatch)
          .set({ status: "draft", serverSeq: seq })
          .where(dispatchInStatus(ctx.companyId, d.id, dispatchStatusesInto("draft"))),
        auditInsert(
          { db: ctx.db, companyId: ctx.companyId, session: ctx.session, impersonation: ctx.impersonation },
          {
            action: "dispatch.unreserve",
            subjectType: "dispatch",
            subjectId: d.id,
            meta: { itemCount: releasedCount },
          },
        ),
      );

      await atomicBatch(ctx.db, statements);
      return { success: true };
    }),

  /**
   * Complete = the delivery note (ADR-004): stock out, timestamp, PL number from the plant's book
   * (once), the v2 packing list snapshot, and order lines' dispatched kg. If a linked order line
   * would go past ordered + the customer's tolerance without an approved `dispatch_overdraw`
   * request, nothing is written except that request, and the call fails PRECONDITION_FAILED
   * (Review Focus 5). The same rule sits in the completing UPDATE's WHERE (`overdrawGuard`), and a
   * trailing abort statement makes the batch all-or-nothing, so a race cannot slip past it.
   */
  complete: actionProcedure("dispatch.complete")
    .input(
      z.object({
        id: z.string(),
        overdrawNote: z.string().trim().max(500).optional(),
        /** FP-PK-12: required to complete a dispatch loaded over its vehicle capacity. */
        capacityOverrideReason: z.string().trim().min(1).max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const d = await ctx.db.query.dispatch.findFirst({
        where: and(
          eq(dispatch.id, input.id),
          eq(dispatch.companyId, ctx.companyId),
          isNull(dispatch.deletedAt),
        ),
      });
      if (!d) throw new TRPCError({ code: "NOT_FOUND", message: "Dispatch not found" });
      assertDispatchTransition(d.status, "completed");

      const items = await ctx.db
        .select({ bundleId: dispatchItem.bundleId })
        .from(dispatchItem)
        .where(
          and(eq(dispatchItem.companyId, ctx.companyId), eq(dispatchItem.dispatchId, d.id)),
        );

      if (items.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot complete an empty dispatch",
        });
      }

      const bundleIds = items.map((i) => i.bundleId);
      const bundles = await mapInChunks(bundleIds, (ids) =>
        ctx.db
          .select()
          .from(bundle)
          .where(
            and(
              eq(bundle.companyId, ctx.companyId),
              inArray(bundle.id, ids),
              eq(bundle.currentDispatchId, d.id),
            ),
          ),
      );
      const notReservedHere = bundles.filter((b) => b.status !== "reserved");
      if (bundles.length !== bundleIds.length || notReservedHere.length > 0) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Cannot complete: one or more bundles are no longer reserved for this dispatch",
        });
      }
      // A bundle that went into a reallocation request after it was scanned can't leave until the
      // request is decided (read here, and in the completing UPDATE below).
      const pendingHere = await bundlesPendingReallocation(ctx.db, ctx.companyId, bundleIds);
      if (pendingHere.size > 0) {
        const serials = bundles.filter((b) => pendingHere.has(b.id)).map((b) => b.serial);
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `${serials.join(", ")} ${serials.length === 1 ? "is" : "are"} waiting on a reallocation approval. Decide it or take ${serials.length === 1 ? "it" : "them"} off the dispatch.`,
        });
      }

      // FP-PK-12: over the vehicle's capacity completes only with a reason (audited).
      const loadedG = bundles.reduce((sum, b) => sum + b.weightG, 0);
      const capacity = dispatchCapacity(loadedG, d.vehicleCapacityG);
      if (capacity.state === "over" && !input.capacityOverrideReason) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Loaded ${kgText(loadedG)} kg is ${kgText(capacity.overG)} kg over the vehicle's ${kgText(capacity.capacityG ?? 0)} kg. Give a reason to complete.`,
        });
      }
      const capacityOverrideReason = capacity.state === "over" ? input.capacityOverrideReason! : null;

      // Spec S-2: the link is decided again now, so kg that leave for a customer with an open line
      // for the section meet the order (an order entered after the scan, a reopened order).
      const relink = await relinkOpen(ctx.db, ctx.companyId, d);
      if (relink.statements.length > 0) {
        const relinkSeq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
        await atomicBatch(ctx.db, [
          ...relink.statements,
          ctx.db
            .update(dispatch)
            .set({ serverSeq: relinkSeq })
            .where(dispatchInStatus(ctx.companyId, d.id, EDITABLE_DISPATCH)),
        ]);
        await auditRelink(ctx, d.id, "complete", await relinkLanded(ctx.db, ctx.companyId, d.id, relink));
      }

      // Review Focus 5: order lines past ordered + tolerance need an approved override.
      const toleranceBp = await dispatchTolerance(ctx.db, ctx.companyId, d.customerId);
      const overdraw = await dispatchOverdraw(ctx.db, ctx.companyId, d.id, toleranceBp);
      if (overdraw.some((l) => !l.covered)) {
        await refuseOverdraw(ctx, d, overdraw, toleranceBp, input.overdrawNote);
      }

      const userId = ctx.session.user.id;
      const completedAt = clockNow();
      // The PL number is assigned here, once (spec P7 PL book); never client-side.
      const plNumber = d.plNumber ?? (await nextDocNumber(ctx.db, ctx.companyId, "pl", completedAt, userId)).number;
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);

      const { plId, statements: packingListStatements } = await packingListWriteBatch(ctx.db, {
        companyId: ctx.companyId,
        dispatchRow: { ...d, status: "completed", completedAt },
        plNumber,
        session: ctx.session,
        impersonation: ctx.impersonation,
      });

      // The dispatch UPDATE runs first; the abort right after it fails the whole batch unless that
      // exact write landed (completedBySeq), so a completion that lost a race or met an unapproved
      // overdraw at write time changes nothing at all.
      const landed = completedBySeq(ctx.db, ctx.companyId, d.id, seq);
      const statements: SqliteBatchItem[] = [
        ctx.db
          .update(dispatch)
          .set({
            status: "completed",
            completedBy: userId,
            completedAt,
            plNumber,
            capacityOverrideReason,
            serverSeq: seq,
          })
          .where(
            and(
              dispatchInStatus(ctx.companyId, d.id, dispatchStatusesInto("completed")),
              overdrawGuard(ctx.companyId, d.id, toleranceBp),
              noUnlinkedWithOpenLine(ctx.companyId, d.id),
              sql`not exists (select 1 from dispatch_item pdi where pdi.company_id = ${ctx.companyId} and pdi.dispatch_id = ${d.id} and ${pendingReallocationOf(ctx.companyId, sql`pdi.bundle_id`)})`,
              withinCapacityOrReason(ctx.companyId, d.id, capacityOverrideReason),
            ),
          ),
        batchAbortUnless(ctx.db, "packing_list_line", landed),
      ];
      for (const ids of chunk(bundleIds, GUARDED_IN_CHUNK)) {
        statements.push(
          ctx.db
            .update(bundle)
            .set({
              status: "dispatched",
              serverSeq: seq,
              // The bundle now counts as produced for the line it was dispatched against, and for no
              // line when it left unlinked (it went to someone else, not to the line it was packed for).
              salesOrderLineId: sql`(select di.sales_order_line_id from dispatch_item di where di.company_id = ${ctx.companyId} and di.dispatch_id = ${d.id} and di.bundle_id = ${bundle.id})`,
            })
            .where(
              and(
                eq(bundle.companyId, ctx.companyId),
                inArray(bundle.id, ids),
                eq(bundle.status, "reserved"),
                eq(bundle.currentDispatchId, d.id),
                landed,
              ),
            ),
        );
      }
      pushChunkedInserts(
        statements,
        (rows) => ctx.db.insert(bundleStatusEvent).values(rows),
        bundleIds.map((bid) => ({
          id: crypto.randomUUID(),
          companyId: ctx.companyId,
          bundleId: bid,
          fromStatus: "reserved" as const,
          toStatus: "dispatched" as const,
          reason: "dispatch.complete",
          actorId: userId,
          dispatchId: d.id,
        })),
      );
      statements.push(
        // Bundles added (and reserved) after our read are not on the packing
        // list: unlist and release them, but only if our completion landed.
        ctx.db
          .delete(dispatchItem)
          .where(
            and(
              eq(dispatchItem.companyId, ctx.companyId),
              eq(dispatchItem.dispatchId, d.id),
              inArray(
                dispatchItem.bundleId,
                ctx.db
                  .select({ id: bundle.id })
                  .from(bundle)
                  .where(
                    and(
                      eq(bundle.companyId, ctx.companyId),
                      eq(bundle.currentDispatchId, d.id),
                      eq(bundle.status, "reserved"),
                    ),
                  ),
              ),
              landed,
            ),
          ),
        ctx.db
          .update(bundle)
          .set({ status: "available", currentDispatchId: null, serverSeq: seq })
          .where(
            and(
              eq(bundle.companyId, ctx.companyId),
              eq(bundle.currentDispatchId, d.id),
              eq(bundle.status, "reserved"),
              landed,
            ),
          ),
        // DN = the stock-out (ADR-004): − bundle kg at each dispatched bundle's location.
        dispatchRows(
          { db: ctx.db, companyId: ctx.companyId, userId, seq, postedAt: completedAt },
          { dispatchId: d.id, guard: landed },
        ),
        // Orders with a line on this dispatch are now dispatching.
        ctx.db
          .update(salesOrder)
          .set({ status: "dispatching", statusChangedAt: completedAt, statusChangedBy: userId, serverSeq: seq })
          .where(
            and(
              eq(salesOrder.companyId, ctx.companyId),
              inArray(salesOrder.status, ["booking", "confirmed"]),
              sql`${salesOrder.id} in (select l.sales_order_id from sales_order_line l join dispatch_item di on di.sales_order_line_id = l.id and di.company_id = ${ctx.companyId} where l.company_id = ${ctx.companyId} and di.dispatch_id = ${d.id})`,
              landed,
            ),
          ),
        // An override request left open is moot once the dispatch completed within what was allowed.
        withdrawOverdrawRequests(ctx.db, ctx.companyId, d.id, seq, completedAt, "the dispatch completed without needing this override.", landed),
        ...packingListStatements,
        ...(capacityOverrideReason
          ? [
              auditInsert(
                { db: ctx.db, companyId: ctx.companyId, session: ctx.session, impersonation: ctx.impersonation },
                {
                  action: "dispatch.capacity_override",
                  subjectType: "dispatch",
                  subjectId: d.id,
                  meta: { loadedG, capacityG: capacity.capacityG, overG: capacity.overG, reason: capacityOverrideReason },
                },
              ),
            ]
          : []),
        auditInsert(
          { db: ctx.db, companyId: ctx.companyId, session: ctx.session, impersonation: ctx.impersonation },
          {
            action: "dispatch.complete",
            subjectType: "dispatch",
            subjectId: d.id,
            meta: { itemCount: items.length, plNumber },
          },
        ),
      );

      try {
        await atomicBatch(ctx.db, statements);
      } catch (e) {
        if (!isBatchAbort(e, "packing_list_line")) throw e;
        // Our completion did not land. Say why: the dispatch moved on, an overdraw appeared
        // (another dispatch completed against the same line, or a link was added), or bundles changed.
        const now = await ctx.db.query.dispatch.findFirst({
          where: and(eq(dispatch.id, d.id), eq(dispatch.companyId, ctx.companyId), isNull(dispatch.deletedAt)),
        });
        if (!now || now.status !== "reserved") {
          throw new TRPCError({
            code: "CONFLICT",
            message: `This dispatch changed while completing${now ? ` (now ${now.status})` : ""}. Reload and check it.`,
          });
        }
        const again = await dispatchOverdraw(ctx.db, ctx.companyId, d.id, toleranceBp);
        if (again.some((l) => !l.covered)) {
          await refuseOverdraw(ctx, d, again, toleranceBp, input.overdrawNote);
        }
        // Review round 3 m-4: an order saved for this customer while completing (the write-time
        // `noUnlinkedWithOpenLine` guard) is said as such; Complete again links the bundles to it.
        const [{ clear } = { clear: 1 }] = await ctx.db
          .select({ clear: sql<number>`${noUnlinkedWithOpenLine(ctx.companyId, d.id)}` })
          .from(company)
          .where(eq(company.id, ctx.companyId));
        if (!Number(clear)) {
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "An order for this customer was saved while completing. Open the dispatch again and press Complete to link the bundles to it.",
          });
        }
        // m-2: the vehicle capacity was lowered while completing; now it is over and needs a reason.
        const nowCapacity = dispatchCapacity(await dispatchLoadG(ctx.db, ctx.companyId, d.id), now.vehicleCapacityG);
        if (!capacityOverrideReason && nowCapacity.state === "over") {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `Loaded ${kgText(nowCapacity.loadedG)} kg is ${kgText(nowCapacity.overG)} kg over the vehicle's ${kgText(nowCapacity.capacityG ?? 0)} kg. Give a reason to complete.`,
          });
        }
        throw new TRPCError({ code: "CONFLICT", message: "Bundles on this dispatch changed. Reload and try again." });
      }
      return { success: true as const, plNumber, packingListId: plId };
    }),

  cancel: actionProcedure("dispatch.cancel")
    .input(z.object({ id: z.string(), reason: z.string().nullable().optional() }))
    .mutation(async ({ ctx, input }) => {
      const d = await ctx.db.query.dispatch.findFirst({
        where: and(
          eq(dispatch.id, input.id),
          eq(dispatch.companyId, ctx.companyId),
          isNull(dispatch.deletedAt),
        ),
      });
      if (!d) throw new TRPCError({ code: "NOT_FOUND", message: "Dispatch not found" });
      assertDispatchTransition(d.status, "cancelled");

      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      // Always release, even from draft: a reserve may land between our read
      // and this batch.
      const { statements, releasedCount } = await releaseStatements(
        ctx,
        d.id,
        seq,
        input.reason ?? "dispatch.cancel",
      );
      statements.push(
        ctx.db
          .update(dispatch)
          .set({ status: "cancelled", serverSeq: seq })
          .where(dispatchInStatus(ctx.companyId, d.id, dispatchStatusesInto("cancelled"))),
        withdrawOverdrawRequests(
          ctx.db,
          ctx.companyId,
          d.id,
          seq,
          clockNow(),
          "the dispatch was cancelled.",
          dispatchLandedAs(ctx.db, ctx.companyId, d.id, seq, "cancelled"),
        ),
        auditInsert(
          { db: ctx.db, companyId: ctx.companyId, session: ctx.session, impersonation: ctx.impersonation },
          {
            action: "dispatch.cancel",
            subjectType: "dispatch",
            subjectId: d.id,
            meta: { fromStatus: d.status, releasedCount, reason: input.reason ?? null },
          },
        ),
      );

      await atomicBatch(ctx.db, statements);
      return { success: true };
    }),

  softDelete: actionProcedure("dispatch.delete")
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const d = await ctx.db.query.dispatch.findFirst({
        where: and(
          eq(dispatch.id, input.id),
          eq(dispatch.companyId, ctx.companyId),
          isNull(dispatch.deletedAt),
        ),
      });
      if (!d) throw new TRPCError({ code: "NOT_FOUND", message: "Dispatch not found" });
      if (d.status === "reserved") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Release the held stock first" });
      }
      if (d.status !== "draft" && d.status !== "cancelled") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Only draft or cancelled dispatches can be deleted",
        });
      }

      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      await atomicBatch(ctx.db, [
        ctx.db
          .update(dispatch)
          .set({ deletedAt: new Date(), serverSeq: seq })
          // A concurrent reserve must not leave held stock on a deleted dispatch.
          .where(dispatchInStatus(ctx.companyId, d.id, ["draft", "cancelled"])),
        // An override request left open (completion refused, then released) is moot once deleted.
        withdrawOverdrawRequests(
          ctx.db,
          ctx.companyId,
          d.id,
          seq,
          clockNow(),
          "the dispatch was deleted.",
          exists(
            ctx.db
              .select({ one: sql`1` })
              .from(dispatch)
              .where(
                and(
                  eq(dispatch.companyId, ctx.companyId),
                  eq(dispatch.id, d.id),
                  eq(dispatch.serverSeq, seq),
                  sql`${dispatch.deletedAt} is not null`,
                ),
              ),
          ),
        ),
        auditInsert(
          { db: ctx.db, companyId: ctx.companyId, session: ctx.session, impersonation: ctx.impersonation },
          {
            action: "dispatch.delete",
            subjectType: "dispatch",
            subjectId: d.id,
            meta: { fromStatus: d.status },
          },
        ),
      ]);
      return { success: true };
    }),
});
