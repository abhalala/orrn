/**
 * What a deciding person must see for a request (owner tour, BACKLOG 89): the LIVE facts of the thing
 * the request touches, read when the sheet opens, beside the request's own copy (meta). Two kinds carry
 * facts the meta cannot keep true: a bundle move (the bundles may have moved on) and a die tier change
 * (the copy's tier, band and readings move). Ids, names, kg and numbers only: never money (C46).
 */
import { and, desc, eq, inArray } from "drizzle-orm";

import { customer } from "@orrn/db/schema/customers";
import { die } from "@orrn/db/schema/catalog";
import { dieBand, dieInstance, dieTierChange, dieWeightReading } from "@orrn/db/schema/dies";
import { bundle } from "@orrn/db/schema/inventory";
import { salesOrder, salesOrderLine } from "@orrn/db/schema/sales";

import type { OrrnDb } from "./atomic";
import { bandText } from "./dieRoom";
import { bundlePartyInfo } from "./reallocate";

export type MoveFacts = {
  kind: "order_reallocate";
  /** The target line as it is now; null when it is gone. */
  target: { customerName: string; orderNumber: string; lineNo: number; orderOpen: boolean; partyRule: "series" | "serial" } | null;
  bundles: {
    id: string;
    serial: string;
    weightG: number;
    status: string;
    /** The party number it carries now (the serial when it has none of its own). */
    partyNo: string;
    /** Still available and still on the line it was asked from: the decision would move it. */
    willMove: boolean;
    /** Moving it gives it a number of the target customer. */
    renumbers: boolean;
  }[];
  willMove: { count: number; kgG: number };
};

export type TierFacts = {
  kind: "die_rerank";
  copy: { code: string; status: string; tierRank: number | null; band: { text: string; minG: number; maxG: number; main: boolean } };
  request: { fromRank: number | null; toRank: number; isLift: boolean; fromBandText: string | null; toBandText: string | null; status: string };
  /** The copy's tier or band is no longer what the request started from. */
  changedSince: boolean;
  reading: { kgPer12ftMilli: number; readAt: number } | null;
};

export type ApprovalFacts = MoveFacts | TierFacts | null;

const OPEN_ORDER = ["booking", "confirmed", "dispatching"];

export async function loadApprovalFacts(
  db: OrrnDb,
  companyId: string,
  row: { kind: string; subjectId: string; meta: Record<string, unknown> | null },
): Promise<ApprovalFacts> {
  if (row.kind === "order_reallocate") return moveFacts(db, companyId, row.meta ?? {});
  if (row.kind === "die_rerank") return tierFacts(db, companyId, row.subjectId);
  return null;
}

async function moveFacts(db: OrrnDb, companyId: string, meta: Record<string, unknown>): Promise<MoveFacts | null> {
  const ids = Array.isArray(meta.bundleIds) ? (meta.bundleIds as unknown[]).filter((x): x is string => typeof x === "string") : [];
  const toLineId = typeof meta.toLineId === "string" ? meta.toLineId : null;
  if (ids.length === 0 || !toLineId) return null;
  const [t] = await db
    .select({
      customerId: salesOrder.customerId,
      customerName: customer.name,
      policy: customer.bundleNumberPolicy,
      orderNumber: salesOrder.number,
      status: salesOrder.status,
      lineNo: salesOrderLine.lineNo,
      dieId: salesOrderLine.dieId,
    })
    .from(salesOrderLine)
    .innerJoin(salesOrder, and(eq(salesOrder.id, salesOrderLine.salesOrderId), eq(salesOrder.companyId, companyId)))
    .innerJoin(customer, and(eq(customer.id, salesOrder.customerId), eq(customer.companyId, companyId)))
    .where(and(eq(salesOrderLine.id, toLineId), eq(salesOrderLine.companyId, companyId)))
    .limit(1);
  const askedFrom = new Map<string, string | null>();
  if (Array.isArray(meta.items)) {
    for (const it of meta.items as { bundleId?: unknown; fromLineId?: unknown }[]) {
      if (it && typeof it.bundleId === "string") askedFrom.set(it.bundleId, typeof it.fromLineId === "string" ? it.fromLineId : null);
    }
  }
  const info = await bundlePartyInfo(db, companyId, ids);
  const weights = new Map<string, number>();
  for (let i = 0; i < ids.length; i += 60) {
    const part = ids.slice(i, i + 60);
    for (const w of await db.select({ id: bundle.id, weightG: bundle.weightG }).from(bundle).where(and(eq(bundle.companyId, companyId), inArray(bundle.id, part)))) {
      weights.set(w.id, w.weightG);
    }
  }
  const open = t ? OPEN_ORDER.includes(t.status) : false;
  const bundles = info
    .map((b) => {
      const onAsked = askedFrom.has(b.id) ? (askedFrom.get(b.id) ?? null) === b.lineId : true;
      const willMove = Boolean(t) && open && b.status === "available" && b.dieId === t!.dieId && onAsked;
      return {
        id: b.id,
        serial: b.serial,
        weightG: weights.get(b.id) ?? 0,
        status: b.status,
        partyNo: b.partyNo ?? b.serial,
        willMove,
        renumbers: Boolean(t) && b.customerId !== t!.customerId,
      };
    })
    .sort((a, b) => a.serial.localeCompare(b.serial, "en", { numeric: true }));
  const moving = bundles.filter((b) => b.willMove);
  return {
    kind: "order_reallocate",
    target: t ? { customerName: t.customerName, orderNumber: t.orderNumber, lineNo: Number(t.lineNo), orderOpen: open, partyRule: t.policy ? "series" : "serial" } : null,
    bundles,
    willMove: { count: moving.length, kgG: moving.reduce((s, b) => s + b.weightG, 0) },
  };
}

async function tierFacts(db: OrrnDb, companyId: string, tierChangeId: string): Promise<TierFacts | null> {
  const [tc] = await db
    .select()
    .from(dieTierChange)
    .where(and(eq(dieTierChange.id, tierChangeId), eq(dieTierChange.companyId, companyId)))
    .limit(1);
  if (!tc) return null;
  const [copy] = await db
    .select({
      code: dieInstance.code,
      status: dieInstance.status,
      tierRank: dieInstance.tierRank,
      bandId: dieInstance.bandId,
      sectionMin: die.weightMinG,
      sectionMax: die.weightMaxG,
    })
    .from(dieInstance)
    .innerJoin(die, and(eq(die.id, dieInstance.sectionId), eq(die.companyId, companyId)))
    .where(and(eq(dieInstance.id, tc.dieInstanceId), eq(dieInstance.companyId, companyId)))
    .limit(1);
  if (!copy) return null;
  const bandIds = [copy.bandId, tc.fromBandId, tc.toBandId].filter((x): x is string => Boolean(x));
  const bands = bandIds.length
    ? await db
        .select({ id: dieBand.id, label: dieBand.label, weightMinG: dieBand.weightMinG, weightMaxG: dieBand.weightMaxG })
        .from(dieBand)
        .where(and(eq(dieBand.companyId, companyId), inArray(dieBand.id, bandIds)))
    : [];
  const word = (id: string | null) => {
    const b = id ? bands.find((x) => x.id === id) : undefined;
    return b ? bandText(b) : null;
  };
  const live = copy.bandId ? bands.find((b) => b.id === copy.bandId) : undefined;
  const liveBand = live
    ? { text: bandText(live), minG: live.weightMinG, maxG: live.weightMaxG, main: false }
    : { text: bandText({ label: null, weightMinG: copy.sectionMin, weightMaxG: copy.sectionMax }), minG: copy.sectionMin, maxG: copy.sectionMax, main: true };
  const [reading] = await db
    .select({ kgPer12ftMilli: dieWeightReading.kgPer12ftMilli, readAt: dieWeightReading.readAt })
    .from(dieWeightReading)
    .where(and(eq(dieWeightReading.companyId, companyId), eq(dieWeightReading.dieInstanceId, tc.dieInstanceId)))
    .orderBy(desc(dieWeightReading.readAt))
    .limit(1);
  const startedFromBand = tc.isLift ? (tc.fromBandId ?? null) : (copy.bandId ?? null);
  return {
    kind: "die_rerank",
    copy: { code: copy.code, status: copy.status, tierRank: copy.tierRank, band: liveBand },
    request: {
      fromRank: tc.fromRank,
      toRank: tc.toRank,
      isLift: tc.isLift,
      fromBandText: tc.isLift ? word(tc.fromBandId) : null,
      toBandText: tc.isLift ? word(tc.toBandId) : null,
      status: tc.status,
    },
    changedSince: tc.status === "pending" && (copy.tierRank !== tc.fromRank || (copy.bandId ?? null) !== startedFromBand),
    reading: reading ? { kgPer12ftMilli: reading.kgPer12ftMilli, readAt: reading.readAt.getTime() } : null,
  };
}
