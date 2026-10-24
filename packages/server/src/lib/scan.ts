/**
 * Dispatch scan classification (FP-PK-11/15, spec §E6 "Scan result order"). Every scanned code gets
 * exactly one outcome, checked in this order:
 *
 *   1 not_found            no bundle has this code
 *   2 ambiguous            the code matches several bundles (month-only number, shared party no)
 *   3 void                 the bundle is void
 *   4 dispatched           the bundle already left
 *   5 held                 another dispatch holds it ("Bundle is held by {code}")
 *   6 unassigned           no sales order line and not moved to plant stock (C8)
 *   7 wrong_customer       packed for another customer's order (moving it is `orders.reallocate`)
 *   8 owned_die            made on a die owned by another customer, no live override (FP-PK-10)
 *   9 already_on_dispatch  listed on this dispatch already (a rescan is calm)
 *  10 added
 *
 * Outcomes 6 and 7 block only in `strict` mode (`dispatch.scan`, the floor gate). The office build
 * path (`addBundlesBySerial`) keeps the PL-8 rule: such bundles go on and the line is suggested
 * (`suggestLines`), so every existing plant keeps dispatching its unassigned legacy stock.
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

export const SCAN_OUTCOMES = [
  "not_found",
  "ambiguous",
  "void",
  "dispatched",
  "held",
  "unassigned",
  "wrong_customer",
  "owned_die",
  "already_on_dispatch",
  "added",
] as const;
export type ScanOutcome = (typeof SCAN_OUTCOMES)[number];

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
  /** Outcome 6/7 let through in lenient mode (so the screen can still flag it). */
  note: "unassigned" | "wrong_customer" | null;
};

export type ScanBundle = typeof bundle.$inferSelect;

type Ctx = { db: OrrnDb; companyId: string };

const MESSAGES: Record<ScanOutcome, (r: ScanResult) => string> = {
  not_found: () => "Not found",
  ambiguous: (r) => `Several bundles have this number: ${r.candidates.join(", ")}`,
  void: () => "Bundle is void",
  dispatched: () => "Bundle is already dispatched",
  held: (r) => (r.heldBy ? `Bundle is held by ${r.heldBy}` : "Bundle is held by another dispatch"),
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

/** Bundles by code: exact serial in bulk, then the resolver (month-only, legacy uid), then party no. */
async function lookupCodes(ctx: Ctx, codes: readonly string[]) {
  const exact = await mapInChunks([...codes], (part) =>
    ctx.db
      .select()
      .from(bundle)
      .where(and(eq(bundle.companyId, ctx.companyId), inArray(bundle.serial, part))),
  );
  const found = new Map<string, ScanBundle>(exact.map((b) => [b.serial, b]));
  const ambiguous = new Map<string, string[]>();
  const misses = codes.filter((c) => !found.has(c));
  const resolvedIds = new Map<string, string>();
  for (const code of misses) {
    const r = await resolveCode(ctx.db, ctx.companyId, code);
    if (r.kind === "bundle") resolvedIds.set(code, r.bundleId);
    else if (r.kind === "ambiguous") ambiguous.set(code, r.candidates.map((c) => c.number));
  }
  // Party numbers (a customer's own series) as a last resort: unique in the company or ambiguous.
  const stillMissing = misses.filter((c) => !resolvedIds.has(c) && !ambiguous.has(c));
  if (stillMissing.length > 0) {
    const byParty = await mapInChunks(stillMissing, (part) =>
      ctx.db
        .select({ id: bundle.id, serial: bundle.serial, partyNo: bundle.partyNo })
        .from(bundle)
        .where(and(eq(bundle.companyId, ctx.companyId), inArray(bundle.partyNo, part))),
    );
    const groups = new Map<string, { id: string; serial: string }[]>();
    for (const b of byParty) {
      const list = groups.get(b.partyNo!) ?? [];
      list.push(b);
      groups.set(b.partyNo!, list);
    }
    for (const [code, list] of groups) {
      if (list.length === 1) resolvedIds.set(code, list[0]!.id);
      else ambiguous.set(code, list.map((b) => b.serial).sort());
    }
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
  opts: { strict: boolean; approvalId?: string | null },
): Promise<{ results: ScanResult[]; toAdd: ScanBundle[] }> {
  const codes = Array.from(new Set(rawCodes.map(normalizeSerial).filter(Boolean)));
  const { found, ambiguous } = await lookupCodes(ctx, codes);
  // One code per bundle: a bundle scanned twice (serial and party no) counts once.
  const seen = new Set<string>();
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

  const results: ScanResult[] = [];
  const toAdd: ScanBundle[] = [];
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
    const base = { bundleId: b.id, serial: b.serial };
    if (seen.has(b.id)) {
      results.push(result(code, "already_on_dispatch", base));
      continue;
    }
    seen.add(b.id);
    if (b.status === "void") {
      results.push(result(code, "void", base));
      continue;
    }
    if (b.status === "dispatched") {
      results.push(result(code, "dispatched", base));
      continue;
    }
    if (b.status === "reserved" && b.currentDispatchId !== d.id) {
      results.push(result(code, "held", { ...base, heldBy: (b.currentDispatchId && holders.get(b.currentDispatchId)) || null }));
      continue;
    }
    let note: ScanResult["note"] = null;
    const allocation = bundleAllocation({
      salesOrderLineId: b.salesOrderLineId,
      latestTransfer: latestTransfer.get(b.id) ?? null,
    });
    if (allocation === "unassigned") {
      if (opts.strict) {
        results.push(result(code, "unassigned", base));
        continue;
      }
      note = "unassigned";
    }
    const lineOwner = b.salesOrderLineId ? lineCustomer.get(b.salesOrderLineId) : undefined;
    if (lineOwner && lineOwner.customerId !== d.customerId) {
      if (opts.strict) {
        results.push(result(code, "wrong_customer", { ...base, customerName: lineOwner.name }));
        continue;
      }
      note = "wrong_customer";
    }
    if (owned.has(b.id)) {
      results.push(result(code, "owned_die", { ...base, customerName: owned.get(b.id) ?? null }));
      continue;
    }
    if (onThisDispatch.has(b.id)) {
      results.push(result(code, "already_on_dispatch", base));
      continue;
    }
    results.push(result(code, "added", { ...base, note }));
    toAdd.push(b);
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
