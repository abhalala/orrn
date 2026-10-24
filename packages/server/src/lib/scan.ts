/**
 * Dispatch scan classification (FP-PK-11/15, spec §E6 "Scan result order"). Every scanned code gets
 * exactly one outcome, checked in this order:
 *
 *   1 not_found            no bundle has this code
 *   2 ambiguous            the code matches several bundles (month-only number, shared party no)
 *   3 void                 the bundle is void
 *   4 dispatched           the bundle already left
 *   5 held                 another dispatch holds it ("Bundle is held by {code}")
 *   5a reallocation_pending in an `order_reallocate` request still waiting on approval (W1-OP-S r1 m-4)
 *   6 unassigned           no sales order line and not moved to plant stock (C8)
 *   7 wrong_customer       packed for another customer's order (moving it is `orders.reallocate`)
 *   8 owned_die            made on a die owned by another customer, no live override (FP-PK-10)
 *   9 already_on_dispatch  listed on this dispatch already (a rescan is calm)
 *  10 added
 *
 * Every add path classifies the same way (D12): `dispatch.scan`, `addBundlesBySerial` and
 * `addBundle`. Only the office (`order.manage`) may lift outcome 6 with `allowUnassigned` on the
 * two add procedures, because legacy stock has no order line; outcome 7 always blocks (moving a
 * bundle to another customer is `orders.reallocate`).
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { bundleAllocation, normalizeSerial } from "@orrn/domain";
import { die } from "@orrn/db/schema/catalog";
import { customer } from "@orrn/db/schema/customers";
import { dieInstance } from "@orrn/db/schema/dies";
import { dispatch, dispatchItem } from "@orrn/db/schema/dispatch";
import { bundle } from "@orrn/db/schema/inventory";
import { bundleTransfer, salesOrder, salesOrderLine } from "@orrn/db/schema/sales";

import { mapInChunks, type OrrnDb } from "./atomic";
import { checkDieAllowed } from "./dieOwner";
import { resolveCode } from "./codeResolver";
import { bundlesPendingReallocation } from "./reallocate";
import { isScanRefusal, type ScanRefusal } from "./scanRefusal";

export { isScanRefusal, SCAN_REFUSALS, ScanRefusalError, type ScanRefusal, type ScanRefusalCode } from "./scanRefusal";

export const SCAN_OUTCOMES = [
  "not_found",
  "ambiguous",
  "void",
  "dispatched",
  "held",
  "reallocation_pending",
  "unassigned",
  "wrong_customer",
  "owned_die",
  "already_on_dispatch",
  "added",
] as const;
export type ScanOutcome = (typeof SCAN_OUTCOMES)[number];

export function refusalOf(r: ScanResult): ScanRefusal | null {
  if (!isScanRefusal(r.outcome)) return null;
  return {
    serial: r.serial ?? r.code,
    code: r.outcome,
    reason: r.message,
    heldBy: r.heldBy,
    customerName: r.customerName,
    candidates: r.candidates,
  };
}

export type ScanResult = {
  /** The code as scanned (normalised). */
  code: string;
  outcome: ScanOutcome;
  /** English sentence for clients without the outcome key in their dictionary. */
  message: string;
  bundleId: string | null;
  serial: string | null;
  /** `held`: the dispatch holding it. */
  heldBy: string | null;
  /** `owned_die`: the owner; `wrong_customer`: the customer it was packed for. */
  customerName: string | null;
  /** `ambiguous`: the bundle numbers it could be. */
  candidates: string[];
  /** Outcome 6 let through by the office (`allowUnassigned`), so the screen can still flag it. */
  note: "unassigned" | null;
};

export type ScanBundle = typeof bundle.$inferSelect;

type Ctx = { db: OrrnDb; companyId: string };

const MESSAGES: Record<ScanOutcome, (r: ScanResult) => string> = {
  not_found: () => "Not found",
  ambiguous: (r) => `Several bundles have this number: ${r.candidates.join(", ")}`,
  void: () => "Bundle is void",
  dispatched: () => "Bundle is already dispatched",
  held: (r) => (r.heldBy ? `Bundle is held by ${r.heldBy}` : "Bundle is held by another dispatch"),
  reallocation_pending: () => "Bundle is waiting on a reallocation approval",
  unassigned: () => "Not assigned to a sales order",
  wrong_customer: (r) => (r.customerName ? `Packed for ${r.customerName}` : "Packed for another customer"),
  owned_die: (r) => (r.customerName ? `This die belongs to ${r.customerName}` : "This die belongs to another customer"),
  already_on_dispatch: () => "Already on this dispatch",
  added: () => "Added",
};

function result(code: string, outcome: ScanOutcome, extra: Partial<ScanResult> = {}): ScanResult {
  const r: ScanResult = {
    code,
    outcome,
    message: "",
    bundleId: null,
    serial: null,
    heldBy: null,
    customerName: null,
    candidates: [],
    note: null,
    ...extra,
  };
  r.message = MESSAGES[outcome](r);
  return r;
}

/**
 * Bundles by code (D15): exact serial AND party number in bulk for every code, so a monthly party
 * number that reads like a plant serial (`26J12`) is never silently taken for the other bundle.
 * Both naming different bundles = ambiguous. A code neither names goes to the resolver
 * (old month-only number, legacy uid).
 */
async function lookupCodes(ctx: Ctx, codes: readonly string[]) {
  const direct = await mapInChunks([...codes], async (part) => [
    ...(await ctx.db
      .select()
      .from(bundle)
      .where(and(eq(bundle.companyId, ctx.companyId), inArray(bundle.serial, part)))),
    ...(await ctx.db
      .select()
      .from(bundle)
      .where(and(eq(bundle.companyId, ctx.companyId), inArray(bundle.partyNo, part)))),
  ]);
  const hits = new Map<string, Map<string, ScanBundle>>();
  const want = new Set(codes);
  for (const b of direct) {
    for (const key of new Set([b.serial, b.partyNo])) {
      if (!key || !want.has(key)) continue;
      const m = hits.get(key) ?? new Map<string, ScanBundle>();
      m.set(b.id, b);
      hits.set(key, m);
    }
  }
  const found = new Map<string, ScanBundle>();
  const ambiguous = new Map<string, string[]>();
  for (const [code, m] of hits) {
    if (m.size === 1) found.set(code, [...m.values()][0]!);
    else ambiguous.set(code, [...m.values()].map((b) => b.serial).sort());
  }
  const misses = codes.filter((c) => !hits.has(c));
  const resolvedIds = new Map<string, string>();
  for (const code of misses) {
    const r = await resolveCode(ctx.db, ctx.companyId, code);
    if (r.kind === "bundle") resolvedIds.set(code, r.bundleId);
    else if (r.kind === "ambiguous") ambiguous.set(code, r.candidates.map((c) => c.number));
  }
  if (resolvedIds.size > 0) {
    const rows = await mapInChunks([...new Set(resolvedIds.values())], (ids) =>
      ctx.db
        .select()
        .from(bundle)
        .where(and(eq(bundle.companyId, ctx.companyId), inArray(bundle.id, ids))),
    );
    const byId = new Map(rows.map((b) => [b.id, b]));
    for (const [code, id] of resolvedIds) {
      const b = byId.get(id);
      if (b) found.set(code, b);
    }
  }
  return { found, ambiguous };
}

/** Customer of each bundle's current line, and whether a line-less bundle was moved to plant stock. */
async function allocations(ctx: Ctx, bundles: readonly ScanBundle[]) {
  const lineIds = [...new Set(bundles.flatMap((b) => (b.salesOrderLineId ? [b.salesOrderLineId] : [])))];
  const lineCustomer = new Map<string, { customerId: string; name: string }>();
  if (lineIds.length > 0) {
    const rows = await mapInChunks(lineIds, (ids) =>
      ctx.db
        .select({ lineId: salesOrderLine.id, customerId: salesOrder.customerId, name: customer.name })
        .from(salesOrderLine)
        .innerJoin(salesOrder, and(eq(salesOrder.id, salesOrderLine.salesOrderId), eq(salesOrder.companyId, ctx.companyId)))
        .innerJoin(customer, and(eq(customer.id, salesOrder.customerId), eq(customer.companyId, ctx.companyId)))
        .where(and(eq(salesOrderLine.companyId, ctx.companyId), inArray(salesOrderLine.id, ids))),
    );
    for (const r of rows) lineCustomer.set(r.lineId, { customerId: r.customerId, name: r.name });
  }
  const lineless = bundles.filter((b) => !b.salesOrderLineId).map((b) => b.id);
  const latestTransfer = new Map<string, { toSalesOrderLineId: string | null }>();
  if (lineless.length > 0) {
    const rows = await mapInChunks(lineless, (ids) =>
      ctx.db
        .select({ bundleId: bundleTransfer.bundleId, to: bundleTransfer.toSalesOrderLineId, at: bundleTransfer.createdAt })
        .from(bundleTransfer)
        .where(and(eq(bundleTransfer.companyId, ctx.companyId), inArray(bundleTransfer.bundleId, ids)))
        .orderBy(desc(bundleTransfer.createdAt), desc(bundleTransfer.serverSeq)),
    );
    for (const r of rows) if (!latestTransfer.has(r.bundleId)) latestTransfer.set(r.bundleId, { toSalesOrderLineId: r.to });
  }
  return { lineCustomer, latestTransfer };
}

/**
 * Owned-die refusals for `customerId` (purpose dispatch): bundle id → owner name. A bundle whose
 * section or copy belongs to someone else passes only with a live `die_owner_override` for its copy
 * and this customer (`checkDieAllowed`); a legacy bundle without a copy on an owned section never does.
 */
export async function ownedDieBlocks(
  db: OrrnDb,
  companyId: string,
  customerId: string,
  bundles: readonly Pick<ScanBundle, "id" | "dieId" | "dieInstanceId">[],
  approvalId?: string | null,
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  if (bundles.length === 0) return out;
  const dieIds = [...new Set(bundles.map((b) => b.dieId))];
  const copyIds = [...new Set(bundles.flatMap((b) => (b.dieInstanceId ? [b.dieInstanceId] : [])))];
  const sections = new Map(
    (
      await mapInChunks(dieIds, (ids) =>
        db
          .select({ id: die.id, owner: die.ownerCustomerId })
          .from(die)
          .where(and(eq(die.companyId, companyId), inArray(die.id, ids))),
      )
    ).map((r) => [r.id, r.owner]),
  );
  const copies = new Map(
    copyIds.length
      ? (
          await mapInChunks(copyIds, (ids) =>
            db
              .select({ id: dieInstance.id, owner: dieInstance.ownerCustomerId })
              .from(dieInstance)
              .where(and(eq(dieInstance.companyId, companyId), inArray(dieInstance.id, ids))),
          )
        ).map((r) => [r.id, r.owner])
      : [],
  );
  const owners = new Set<string>();
  const decided = new Map<string, string>();
  for (const b of bundles) {
    const owner = (b.dieInstanceId ? copies.get(b.dieInstanceId) : null) ?? sections.get(b.dieId) ?? null;
    if (owner === null || owner === customerId) continue;
    if (b.dieInstanceId && copies.has(b.dieInstanceId)) {
      const check = await checkDieAllowed(db, companyId, {
        dieId: b.dieId,
        dieInstanceId: b.dieInstanceId,
        customerId,
        purpose: "dispatch",
        approvalId: approvalId ?? null,
      });
      if (check.ok) continue;
    }
    decided.set(b.id, owner);
    owners.add(owner);
  }
  const names = new Map(
    owners.size
      ? (
          await mapInChunks([...owners], (ids) =>
            db
              .select({ id: customer.id, name: customer.name })
              .from(customer)
              .where(and(eq(customer.companyId, companyId), inArray(customer.id, ids))),
          )
        ).map((r) => [r.id, r.name])
      : [],
  );
  for (const [bundleId, owner] of decided) out.set(bundleId, names.get(owner) ?? null);
  return out;
}

/**
 * Classify `rawCodes` for dispatch `d` (one result per distinct normalised code, in scan order).
 * Returns the results and the bundles to add (outcome `added`).
 */
export async function classifyScan(
  ctx: Ctx,
  d: { id: string; customerId: string },
  rawCodes: readonly string[],
  opts: ClassifyOpts,
): Promise<{ results: ScanResult[]; toAdd: ScanBundle[] }> {
  const codes = Array.from(new Set(rawCodes.map(normalizeSerial).filter(Boolean)));
  const { found, ambiguous } = await lookupCodes(ctx, codes);
  return classifyBundles(ctx, d, codes, found, ambiguous, opts);
}

export type ClassifyOpts = {
  approvalId?: string | null;
  /**
   * D12: the office may add bundles with no sales order line (legacy stock is unassigned). Lifts
   * ONLY `unassigned`; the caller checks `order.manage`. Never set on the scan path.
   */
  allowUnassigned?: boolean;
};

/** The §E6 order for bundles already looked up (`dispatch.addBundle` passes its one bundle). */
export async function classifyBundles(
  ctx: Ctx,
  d: { id: string; customerId: string },
  codes: readonly string[],
  found: ReadonlyMap<string, ScanBundle>,
  ambiguous: ReadonlyMap<string, string[]>,
  opts: ClassifyOpts,
): Promise<{ results: ScanResult[]; toAdd: ScanBundle[] }> {
  // One outcome per bundle: a bundle scanned twice (serial and party no) repeats its first outcome.
  const firstOutcome = new Map<string, ScanResult>();
  const bundles = [...new Map([...found.values()].map((b) => [b.id, b])).values()];

  const onThisDispatch = new Set(
    (
      await mapInChunks(
        bundles.map((b) => b.id),
        (ids) =>
          ctx.db
            .select({ bundleId: dispatchItem.bundleId })
            .from(dispatchItem)
            .where(and(eq(dispatchItem.companyId, ctx.companyId), eq(dispatchItem.dispatchId, d.id), inArray(dispatchItem.bundleId, ids))),
      )
    ).map((r) => r.bundleId),
  );
  const holderIds = [
    ...new Set(bundles.filter((b) => b.status === "reserved" && b.currentDispatchId && b.currentDispatchId !== d.id).map((b) => b.currentDispatchId!)),
  ];
  const holders = new Map(
    holderIds.length
      ? (
          await mapInChunks(holderIds, (ids) =>
            ctx.db
              .select({ id: dispatch.id, code: dispatch.code })
              .from(dispatch)
              .where(and(eq(dispatch.companyId, ctx.companyId), inArray(dispatch.id, ids))),
          )
        ).map((r) => [r.id, r.code])
      : [],
  );
  const live = bundles.filter((b) => b.status !== "void" && b.status !== "dispatched");
  const { lineCustomer, latestTransfer } = await allocations(ctx, live);
  const owned = await ownedDieBlocks(ctx.db, ctx.companyId, d.customerId, live, opts.approvalId);
  const pendingReallocation = await bundlesPendingReallocation(
    ctx.db,
    ctx.companyId,
    live.filter((b) => !onThisDispatch.has(b.id)).map((b) => b.id),
  );

  const results: ScanResult[] = [];
  const toAdd: ScanBundle[] = [];
  const decide = (code: string, b: ScanBundle): ScanResult => {
    const base = { bundleId: b.id, serial: b.serial };
    if (b.status === "void") return result(code, "void", base);
    if (b.status === "dispatched") return result(code, "dispatched", base);
    if (b.status === "reserved" && b.currentDispatchId !== d.id) {
      return result(code, "held", { ...base, heldBy: (b.currentDispatchId && holders.get(b.currentDispatchId)) || null });
    }
    if (pendingReallocation.has(b.id)) return result(code, "reallocation_pending", base);
    let note: ScanResult["note"] = null;
    const allocation = bundleAllocation({
      salesOrderLineId: b.salesOrderLineId,
      latestTransfer: latestTransfer.get(b.id) ?? null,
    });
    if (allocation === "unassigned") {
      if (!opts.allowUnassigned) return result(code, "unassigned", base);
      note = "unassigned";
    }
    const lineOwner = b.salesOrderLineId ? lineCustomer.get(b.salesOrderLineId) : undefined;
    if (lineOwner && lineOwner.customerId !== d.customerId) {
      return result(code, "wrong_customer", { ...base, customerName: lineOwner.name });
    }
    if (owned.has(b.id)) return result(code, "owned_die", { ...base, customerName: owned.get(b.id) ?? null });
    if (onThisDispatch.has(b.id)) return result(code, "already_on_dispatch", base);
    return result(code, "added", { ...base, note });
  };
  for (const code of codes) {
    const amb = ambiguous.get(code);
    const b = found.get(code);
    if (!b && !amb) {
      results.push(result(code, "not_found"));
      continue;
    }
    if (!b) {
      results.push(result(code, "ambiguous", { candidates: amb! }));
      continue;
    }
    const first = firstOutcome.get(b.id);
    if (first) {
      // The same bundle by its other number: a refusal repeats, an add is now "already on".
      const { outcome: firstOutcomeName, message: _message, ...rest } = first;
      const outcome = firstOutcomeName === "added" ? "already_on_dispatch" : firstOutcomeName;
      results.push(result(code, outcome, { ...rest, code, note: outcome === "already_on_dispatch" ? null : rest.note }));
      continue;
    }
    const r = decide(code, b);
    firstOutcome.set(b.id, r);
    results.push(r);
    if (r.outcome === "added") toAdd.push(b);
  }
  return { results, toAdd };
}

/** Grams on a dispatch right now (Σ bundle weight of its items). */
export async function dispatchLoadG(db: OrrnDb, companyId: string, dispatchId: string): Promise<number> {
  const [row] = await db
    .select({ g: sql<number>`coalesce(sum(${bundle.weightG}), 0)` })
    .from(dispatchItem)
    .innerJoin(bundle, and(eq(bundle.id, dispatchItem.bundleId), eq(bundle.companyId, dispatchItem.companyId)))
    .where(and(eq(dispatchItem.companyId, companyId), eq(dispatchItem.dispatchId, dispatchId)));
  return Number(row?.g ?? 0);
}
