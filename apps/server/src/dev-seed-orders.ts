/**
 * Demo order book for the dev seed (FP-OP, BACKLOG 38): ten orders for three customers in every
 * state the order screens show, and the bundles they stand on.
 *
 *   SO-1  KD Extrusion     confirmed 25 d ago, PO-4471, LATE; 2 bundles packed for line 1 (the old demo, unchanged)
 *   SO-2  Royal Aluminium  confirmed 3 d ago, PO-118, tee 13090 at 18 ft on the band-start basis
 *   SO-3  KD Extrusion     booking today, no PO yet (the confirm checklist)
 *   SO-4  KD Extrusion     booking from the party portal (party@orrn.local)
 *   SO-5  Tejura & Sons    CLOSED with a little baki (two trucks, one combined packing list)
 *   SO-6  Royal Aluminium  CANCELLED (entered twice)
 *   SO-7  KD Extrusion     DISPATCHING: the first truck went 4 d ago; packed stock waits on line 2, two
 *                          angles of it are asked to move to SO-9 (a pending order_reallocate)
 *   SO-8  Royal Aluminium  DISPATCHING: a dispatch opened from the order went today; 2 bundles held for line 1
 *   SO-9  Tejura & Sons    confirmed: the reserved dispatch stands on lines 3 and 4
 *   SO-10 KD Extrusion     confirmed: channel 12230, the die KD owns; 8 bundles packed for it (the owned-die refusal)
 *
 * SO-1..SO-4 keep the quantities every older spec reads. The new orders' quantities are derived from
 * the bundles that stand on each line (dispatched + packed, plus a margin still to make), so the baki
 * and balance strips add up by construction and stay right when the bundle generator changes.
 * Ids are fixed (`dev-so-*`, `dev-sol-*`); the main seed deletes every order of the demo company
 * first and writes the SO series to match, so running the seed again gives the same rows.
 */
import type { approval } from "@orrn/db/schema/approval";
import type { auditLog } from "@orrn/db/schema/audit";
import type { salesOrder, salesOrderLine, bundleTransfer } from "@orrn/db/schema/sales";
import type { docSeries } from "@orrn/db/schema/series";
import { orderGrams, orderPieces } from "@orrn/domain";
import { docPeriod } from "@orrn/server/lib/docNumber";

import { HOUR_MS, LENGTH_12FT_MM, LENGTH_18FT_MM, istDay, type SeedBundle, type SeedClock } from "./dev-seed-kit";

/** A dispatch of the main seed as the order book needs it: who it is for and what it carries. */
export type OrderDispatch = {
  id: string;
  customerKey: string;
  status: string;
  completedAt: number | null;
  members: SeedBundle[];
};

/** What the order book writes on a seeded bundle row (applied by the main seed). */
export type BundlePatch = {
  salesOrderLineId?: string | null;
  packedSalesOrderLineId?: string | null;
  heldForLineId?: string | null;
  heldAt?: Date | null;
};

export type DemoOrderSeed = {
  orders: (typeof salesOrder.$inferInsert)[];
  lines: (typeof salesOrderLine.$inferInsert)[];
  series: (typeof docSeries.$inferInsert)[];
  audits: (typeof auditLog.$inferInsert)[];
  approvals: (typeof approval.$inferInsert)[];
  /** Plant-stock moves (a transfer to no line): D20 stock the floor may put on any customer's load. */
  transfers: (typeof bundleTransfer.$inferInsert)[];
  bundlePatches: Map<string, BundlePatch>;
  /** `dispatchId|bundleId` -> the order line the dispatch item fulfils. */
  itemLines: Map<string, string>;
  /** Dispatch id -> the order it was opened from (`dispatch.sales_order_id`). */
  dispatchOrders: Map<string, string>;
  /** Bundles that get a party number from their customer's own series, in pack order. */
  partyBundles: { customerKey: string; bundles: SeedBundle[] }[];
  /** The ids a test or the docs can name. */
  ids: { pendingReallocationApprovalId: string; pendingBundleIds: string[]; heldBundleIds: string[] };
};

export type DemoOrderInput = {
  companyId: string;
  now: number;
  clock: SeedClock;
  ownerId: string;
  officeId: string;
  managerId: string;
  /** The portal login that placed SO-4. */
  partyUserId: string;
  nextSeq: () => number;
  customerId: (key: string) => string;
  /** Section id and the grams-per-12-ft band start (`die.weight_min_g`) by die key. */
  die: (key: string) => { id: string; weightMinG: number };
  copyId: (code: string) => string;
  sessionBundles: readonly (readonly SeedBundle[])[];
  dispatches: readonly OrderDispatch[];
};

const sum = (rows: readonly SeedBundle[], pick: (b: SeedBundle) => number) => rows.reduce((s, b) => s + pick(b), 0);
const ceilTo = (value: number, step: number) => Math.ceil(value / step) * step;

export function demoOrderSeed(input: DemoOrderInput): DemoOrderSeed {
  const { companyId, now, clock, ownerId, officeId, managerId, partyUserId, nextSeq } = input;
  const at = (daysAgo: number, hour = 10) => new Date(clock.pastAt(daysAgo, hour));
  const period = docPeriod("so", new Date(now));

  // The order numbers, by what each order shows.
  const KD_LATE = 1;
  const ROYAL_18FT = 2;
  const KD_BOOKING = 3;
  const KD_PORTAL = 4;
  const TEJURA_CLOSED = 5;
  const ROYAL_CANCELLED = 6;
  const KD_DISPATCHING = 7;
  const ROYAL_DISPATCHING = 8;
  const TEJURA_OPEN = 9;
  const KD_OWNED = 10;
  const soId = (n: number) => `dev-so-${n}`;
  const lineId = (order: number, no: number) => `dev-sol-${order}-${no}`;

  const slice = (session: number, from: number, to: number): SeedBundle[] => {
    const members = input.sessionBundles[session];
    if (!members) throw new Error(`dev-seed: no session ${session}`);
    return members.slice(from, to);
  };
  const dispatchOf = (id: string) => {
    const hit = input.dispatches.find((d) => d.id === id);
    if (!hit) throw new Error(`dev-seed: no dispatch ${id}`);
    return hit;
  };
  /** The bundles of one completed dispatch that came from one packing session. */
  const carried = (dispatchId: string, session: number) => {
    const ids = new Set((input.sessionBundles[session] ?? []).map((b) => b.id));
    return dispatchOf(dispatchId).members.filter((m) => ids.has(m.id));
  };

  // ---------------------------------------------------------------------------------------------
  // Which bundles stand on which line (session, from, to). A session is one packing run of one section.
  //   dispatched = on a completed dispatch;  packed = in stock, packed for the line;  held = plant stock
  //   held in the yard for the line;  reserved = on the reserved dispatch, packed for the line.
  // Some stock is left on no order on purpose (legacy stock the office has not allocated yet).
  // ---------------------------------------------------------------------------------------------
  const S = { patti: 0, angle: 1, tee: 2, chan: 3, patti15: 4, angle125: 5, flat: 6, angleToday: 7, chan12230: 8 } as const;

  // SO-1: the two patti bundles packed for it (as the demo always had).
  const kdLatePacked = slice(S.patti, 12, 14);
  // SO-7 (KD): first truck dispatched, packed angles waiting, two of them asked to move to SO-9.
  const kd1Dispatched = carried("dev-dispatch-done-1", S.patti);
  const kd2Dispatched = carried("dev-dispatch-done-1", S.angle);
  const kdPending = slice(S.angle, 12, 14);
  const kd2Packed = [...slice(S.angle, 8, 12), ...kdPending, ...slice(S.angleToday, 0, 8)];
  // SO-8 (Royal): the dispatch from the order carried tee and channel; channel stock waits; tee stock is held.
  const royal1Dispatched = carried("dev-dispatch-done-2", S.tee);
  const royalHeld = slice(S.tee, 13, 15);
  const royal2Dispatched = carried("dev-dispatch-done-2", S.chan);
  const royal2Packed = slice(S.chan, 8, 11);
  // SO-5 (Tejura, closed): two trucks of patti 1 1/2".
  const tejuraClosed = [...carried("dev-dispatch-done-3", S.patti15), ...carried("dev-dispatch-done-4", S.patti15)];
  // SO-9 (Tejura): the reserved dispatch stands on lines 3 (patti 1 1/2") and 4 (tee); flat and angle 1 1/4" stock is packed.
  const tejura3Reserved = slice(S.patti15, 0, 5);
  const tejura4Reserved = slice(S.tee, 8, 13);
  const tejura2Packed = slice(S.flat, 0, 10);
  const tejura5Packed = slice(S.angle125, 6, 11);

  // SO-10 (KD): the channel 12230 KD owns; its bundles are packed for it.
  const kdOwnedPacked = slice(S.chan12230, 0, 8);

  // Plant stock (a transfer to no line): what the floor may put on any customer's load (D20).
  const plantStock = [
    ...slice(S.angle, 14, 15),
    ...royalHeld,
    ...slice(S.angle125, 0, 6), // on the draft dispatch of Shivam Bhavnagar
    ...slice(S.flat, 10, 14),
  ];
  // Left on no order (no transfer either): angle125 11..14, flat 14..16, angle today 8..14, patti15 11..17.

  // ---------------------------------------------------------------------------------------------
  // Links: bundle -> line (and the dispatch item -> line for what went on a truck).
  // ---------------------------------------------------------------------------------------------
  const patchFor = new Map<string, BundlePatch>();
  const itemLines = new Map<string, string>();
  const standOn = (bundles: readonly SeedBundle[], line: string, opts: { dispatchId?: string } = {}) => {
    for (const b of bundles) {
      patchFor.set(b.id, { ...patchFor.get(b.id), salesOrderLineId: line, packedSalesOrderLineId: line });
      if (opts.dispatchId) itemLines.set(`${opts.dispatchId}|${b.id}`, line);
    }
  };
  standOn(kdLatePacked, lineId(KD_LATE, 1));
  standOn(kd1Dispatched, lineId(KD_DISPATCHING, 1), { dispatchId: "dev-dispatch-done-1" });
  standOn(kd2Dispatched, lineId(KD_DISPATCHING, 2), { dispatchId: "dev-dispatch-done-1" });
  standOn(kd2Packed, lineId(KD_DISPATCHING, 2));
  standOn(royal1Dispatched, lineId(ROYAL_DISPATCHING, 1), { dispatchId: "dev-dispatch-done-2" });
  standOn(royal2Dispatched, lineId(ROYAL_DISPATCHING, 2), { dispatchId: "dev-dispatch-done-2" });
  standOn(royal2Packed, lineId(ROYAL_DISPATCHING, 2));
  standOn(carried("dev-dispatch-done-3", S.patti15), lineId(TEJURA_CLOSED, 1), { dispatchId: "dev-dispatch-done-3" });
  standOn(carried("dev-dispatch-done-4", S.patti15), lineId(TEJURA_CLOSED, 1), { dispatchId: "dev-dispatch-done-4" });
  standOn(tejura2Packed, lineId(TEJURA_OPEN, 2));
  standOn(tejura3Reserved, lineId(TEJURA_OPEN, 3), { dispatchId: "dev-dispatch-held" });
  standOn(tejura4Reserved, lineId(TEJURA_OPEN, 4), { dispatchId: "dev-dispatch-held" });
  standOn(tejura5Packed, lineId(TEJURA_OPEN, 5));
  standOn(kdOwnedPacked, lineId(KD_OWNED, 1));

  const pcs = (rows: readonly SeedBundle[]) => sum(rows, (b) => b.quantity);
  const grams = (rows: readonly SeedBundle[]) => sum(rows, (b) => b.weightG);

  const makeOrder = (o: {
    n: number;
    customerKey: string;
    po: string | null;
    daysAgo: number;
    status: "booking" | "confirmed" | "dispatching" | "closed" | "cancelled";
    lineSeq: number;
    note?: string;
    expected?: string | null;
    source?: "office" | "portal";
    finish?: "none" | "anodise" | "pvd" | null;
    closedDaysAgo?: number;
    closeReason?: string;
    cancelReason?: string;
  }): typeof salesOrder.$inferInsert => {
    const portal = o.source === "portal";
    const actor = portal ? partyUserId : officeId;
    const confirmed = o.status !== "booking";
    return {
      id: soId(o.n),
      companyId,
      serverSeq: nextSeq(),
      period,
      number: `SO-${o.n}`,
      customerId: input.customerId(o.customerKey),
      poNumber: o.po,
      orderDate: istDay(now, o.daysAgo),
      status: o.status,
      note: o.note ?? null,
      expectedDate: o.expected ?? null,
      finish: o.finish ?? null,
      source: o.source ?? "office",
      confirmedAt: confirmed ? at(o.daysAgo) : null,
      confirmedBy: confirmed ? officeId : null,
      closedAt: o.status === "closed" ? at(o.closedDaysAgo ?? 1, 17) : null,
      closedBy: o.status === "closed" ? managerId : null,
      closeReason: o.status === "closed" ? (o.closeReason ?? null) : null,
      cancelledAt: o.status === "cancelled" ? at(o.closedDaysAgo ?? 1, 11) : null,
      cancelledBy: o.status === "cancelled" ? officeId : null,
      cancelReason: o.status === "cancelled" ? (o.cancelReason ?? null) : null,
      lineSeq: o.lineSeq,
      statusChangedAt: at(o.closedDaysAgo ?? o.daysAgo),
      statusChangedBy: actor,
      createdBy: actor,
      createdAt: at(o.daysAgo),
    };
  };

  type LineSpec = {
    order: number;
    no: number;
    dieKey: string;
    cutLengthMm?: number;
    /** `pcs`: the clerk committed on pieces; `kg`: on kilos. The other side is derived. */
    basis: "pcs" | "kg";
    pcs?: number;
    kgG?: number;
    daysAgo: number;
    basisNote?: string | null;
    tierRank?: number | null;
    finish?: string | null;
    copy?: { code: string; milli: number; readingId: string };
    actor?: string;
    note?: string | null;
  };
  const makeLine = (l: LineSpec): typeof salesOrderLine.$inferInsert => {
    const section = input.die(l.dieKey);
    const cut = l.cutLengthMm ?? LENGTH_12FT_MM;
    const basisMilli = l.copy ? l.copy.milli : section.weightMinG;
    const linePcs = l.basis === "pcs" ? l.pcs! : orderPieces(l.kgG!, cut, basisMilli, "inch");
    const lineKg = l.basis === "pcs" ? orderGrams(linePcs, cut, basisMilli, "inch") : l.kgG!;
    return {
      id: lineId(l.order, l.no),
      companyId,
      serverSeq: nextSeq(),
      salesOrderId: soId(l.order),
      lineNo: l.no,
      dieId: section.id,
      kgPer12ftMilli: basisMilli,
      cutLengthMm: cut,
      pcs: linePcs,
      kgG: lineKg,
      finish: l.finish ?? null,
      note: l.note ?? null,
      dieInstanceId: l.copy ? input.copyId(l.copy.code) : null,
      tierRank: l.tierRank === undefined ? 1 : l.tierRank,
      qtyBasis: l.basis,
      impliedG: orderGrams(linePcs, cut, basisMilli, "inch"),
      weightBasis: l.copy ? "copy_current" : "band_start",
      bandStartMilli: section.weightMinG,
      copyMilli: l.copy ? l.copy.milli : null,
      readingId: l.copy ? l.copy.readingId : null,
      basisNote: l.basisNote ?? null,
      alloy: "6063",
      temper: "T6",
      ratePaise: null,
      createdBy: l.actor ?? officeId,
      createdAt: at(l.daysAgo),
    };
  };

  const orders = [
    makeOrder({ n: KD_LATE, customerKey: "kd", po: "PO-4471", daysAgo: 25, status: "confirmed", lineSeq: 2, note: "Running late: die was at nitriding" }),
    makeOrder({ n: ROYAL_18FT, customerKey: "royal", po: "PO-118", daysAgo: 3, status: "confirmed", lineSeq: 1 }),
    makeOrder({ n: KD_BOOKING, customerKey: "kd", po: null, daysAgo: 0, status: "booking", lineSeq: 1 }),
    makeOrder({ n: KD_PORTAL, customerKey: "kd", po: null, daysAgo: 1, status: "booking", lineSeq: 1, note: "Placed from the party portal", source: "portal" }),
    makeOrder({ n: TEJURA_CLOSED, customerKey: "tejura", po: "PO-T-77", daysAgo: 12, status: "closed", lineSeq: 1, closedDaysAgo: 1, closeReason: "Customer accepted the delivered quantity" }),
    makeOrder({ n: ROYAL_CANCELLED, customerKey: "royal", po: "PO-2288", daysAgo: 10, status: "cancelled", lineSeq: 1, closedDaysAgo: 9, cancelReason: "Duplicate of PO-2291; entered twice" }),
    makeOrder({ n: KD_DISPATCHING, customerKey: "kd", po: "PO-4502", daysAgo: 8, status: "dispatching", lineSeq: 2, expected: istDay(now, -3), note: "Patti first, angle to follow" }),
    makeOrder({ n: ROYAL_DISPATCHING, customerKey: "royal", po: "PO-2291", daysAgo: 6, status: "dispatching", lineSeq: 2, expected: istDay(now, -2), finish: "anodise", note: "Anodise after pressing; tee first" }),
    makeOrder({ n: TEJURA_OPEN, customerKey: "tejura", po: "PO-T-81", daysAgo: 4, status: "confirmed", lineSeq: 5, expected: istDay(now, -6), note: "Collect from the gate; call before loading" }),
    makeOrder({ n: KD_OWNED, customerKey: "kd", po: "PO-4533", daysAgo: 5, status: "confirmed", lineSeq: 1, expected: istDay(now, -5), note: "KD's own die 12230: nobody else may press or pack it" }),
  ];

  // Quantities of the older orders are what every spec reads (1,280 kg on SO-1); the new ones are derived
  // from the bundles on each line, rounded up, plus the part still to make.
  const lines = [
    makeLine({ order: KD_LATE, no: 1, dieKey: "patti1", basis: "pcs", pcs: 200, daysAgo: 25 }),
    makeLine({ order: KD_LATE, no: 2, dieKey: "angle1", basis: "kg", kgG: 800_000, daysAgo: 25 }),
    makeLine({
      order: ROYAL_18FT,
      no: 1,
      dieKey: "tee125",
      cutLengthMm: LENGTH_18FT_MM,
      basis: "pcs",
      pcs: 150,
      basisNote: "No weight reading on the copy yet; band start used",
      daysAgo: 3,
    }),
    makeLine({ order: KD_BOOKING, no: 1, dieKey: "patti1", basis: "kg", kgG: 500_000, daysAgo: 0 }),
    makeLine({ order: KD_PORTAL, no: 1, dieKey: "patti1", basis: "pcs", pcs: 200, daysAgo: 1, actor: partyUserId }),
    makeLine({ order: TEJURA_CLOSED, no: 1, dieKey: "patti15", basis: "pcs", pcs: ceilTo(pcs(tejuraClosed), 10) + 10, daysAgo: 12 }),
    makeLine({ order: ROYAL_CANCELLED, no: 1, dieKey: "chan075", basis: "pcs", pcs: 40, daysAgo: 10 }),
    makeLine({ order: KD_DISPATCHING, no: 1, dieKey: "patti1", basis: "pcs", pcs: ceilTo(pcs(kd1Dispatched), 50) + 150, daysAgo: 8 }),
    makeLine({ order: KD_DISPATCHING, no: 2, dieKey: "angle1", basis: "kg", kgG: ceilTo(grams(kd2Dispatched) + grams(kd2Packed), 100_000) + 300_000, daysAgo: 8 }),
    makeLine({
      order: ROYAL_DISPATCHING,
      no: 1,
      dieKey: "tee125",
      basis: "pcs",
      pcs: ceilTo(pcs(royal1Dispatched) + pcs(royalHeld), 50) + 100,
      daysAgo: 6,
      finish: "anodise",
      copy: { code: "13090-1", milli: 2_760, readingId: "dev-reading-13090-1-2" },
      note: "Copy 13090-1 pinned: the customer wants the lightest tee",
    }),
    makeLine({ order: ROYAL_DISPATCHING, no: 2, dieKey: "chan075", basis: "kg", kgG: ceilTo(grams(royal2Dispatched) + grams(royal2Packed), 100_000) + 200_000, daysAgo: 6 }),
    makeLine({ order: TEJURA_OPEN, no: 1, dieKey: "angle1", basis: "pcs", pcs: 240, daysAgo: 4 }),
    makeLine({ order: TEJURA_OPEN, no: 2, dieKey: "flat2", basis: "kg", kgG: ceilTo(grams(tejura2Packed), 100_000) + 200_000, daysAgo: 4 }),
    makeLine({ order: TEJURA_OPEN, no: 3, dieKey: "patti15", basis: "pcs", pcs: ceilTo(pcs(tejura3Reserved), 50) + 100, daysAgo: 4 }),
    makeLine({ order: TEJURA_OPEN, no: 4, dieKey: "tee125", basis: "pcs", pcs: ceilTo(pcs(tejura4Reserved), 50) + 50, daysAgo: 4 }),
    makeLine({ order: TEJURA_OPEN, no: 5, dieKey: "angle125", basis: "pcs", pcs: ceilTo(pcs(tejura5Packed), 50) + 100, daysAgo: 4 }),
    makeLine({ order: KD_OWNED, no: 1, dieKey: "chan1", basis: "pcs", pcs: ceilTo(pcs(kdOwnedPacked), 50) + 100, daysAgo: 5, copy: { code: "12230-1", milli: 2_850, readingId: "dev-reading-12230-1-1" } }),
  ];

  // ---------------------------------------------------------------------------------------------
  // Holds: two plant-stock tee bundles held in the yard for Royal's line 1.
  // ---------------------------------------------------------------------------------------------
  const heldAt = new Date(clock.pastAt(1, 15));
  for (const b of royalHeld) patchFor.set(b.id, { ...patchFor.get(b.id), heldForLineId: lineId(ROYAL_DISPATCHING, 1), heldAt });

  // ---------------------------------------------------------------------------------------------
  // Plant stock transfers (append-only; a move to no line) and the pending reallocation.
  // ---------------------------------------------------------------------------------------------
  const transferAt = new Date(clock.pastAt(2, 18));
  const transfers: (typeof bundleTransfer.$inferInsert)[] = plantStock.map((b, i) => ({
    id: `dev-transfer-${String(i + 1).padStart(3, "0")}`,
    companyId,
    serverSeq: nextSeq(),
    bundleId: b.id,
    fromSalesOrderLineId: null,
    toSalesOrderLineId: null,
    batchId: "dev-transfer-batch-plant",
    reason: "Packed as plant stock for the next load",
    reasonCode: null,
    lengthMismatch: false,
    approvalId: null,
    createdBy: officeId,
    createdAt: transferAt,
  }));

  const pendingId = "dev-approval-reallocate-1";
  const pendingBatch = "dev-realloc-batch-1";
  const pendingKg = grams(kdPending);
  const pendingFrom = lineId(KD_DISPATCHING, 2);
  const pendingTo = lineId(TEJURA_OPEN, 1);
  const pendingNote = "Tejura asked for these two angles; KD can wait for the next run";
  const approvals: (typeof approval.$inferInsert)[] = [
    {
      id: pendingId,
      companyId,
      serverSeq: nextSeq(),
      kind: "order_reallocate",
      subjectId: pendingBatch,
      status: "pending",
      requestNote: pendingNote,
      meta: {
        bundleIds: kdPending.map((b) => b.id),
        fromLineIds: [pendingFrom],
        toLineId: pendingTo,
        kgG: pendingKg,
        reason: pendingNote,
        reasonCode: "customer_request",
        items: kdPending.map((b) => ({ bundleId: b.id, fromLineId: pendingFrom })),
        lengthMismatchBundleIds: [],
        orderIds: [soId(KD_DISPATCHING), soId(TEJURA_OPEN)],
        dieOwnerApprovalId: null,
      },
      requestedBy: officeId,
      createdAt: new Date(clock.todayAt(0.2)),
    },
  ];

  // ---------------------------------------------------------------------------------------------
  // Series and audit trail (the order timeline reads these).
  // ---------------------------------------------------------------------------------------------
  const series: (typeof docSeries.$inferInsert)[] = [
    { id: `dev-series-so-${period}`, companyId, docType: "so", period, value: orders.length, createdBy: ownerId },
  ];
  const audits: (typeof auditLog.$inferInsert)[] = [];
  const audit = (id: string, actorId: string, action: string, subjectType: string, subjectId: string, meta: Record<string, unknown>, when: Date) =>
    audits.push({ id: `dev-audit-${id}`, companyId, actorId, action, subjectType, subjectId, meta, at: when });
  for (const o of orders) {
    const created = o.createdAt as Date;
    const portal = o.source === "portal";
    // The first two demo orders keep the audit actions their specs read; the portal one is the party's.
    audit(`${o.id}-create`, portal ? partyUserId : officeId, portal ? "portal.order.create" : "order.create", "sales_order", o.id!, { number: o.number, period, orderId: o.id, customerId: o.customerId }, created);
    if (o.confirmedAt) {
      audit(`${o.id}-confirm`, officeId, "order.confirm", "sales_order", o.id!, { number: o.number, period, orderId: o.id }, new Date(created.getTime() + HOUR_MS));
    }
    if (o.status === "closed") {
      audit(`${o.id}-close`, managerId, "order.close", "sales_order", o.id!, { number: o.number, orderId: o.id, from: "dispatching", bakiG: 0, reason: o.closeReason }, o.closedAt as Date);
    }
    if (o.status === "cancelled") {
      audit(`${o.id}-cancel`, officeId, "order.cancel", "sales_order", o.id!, { number: o.number, orderId: o.id, from: "confirmed", reason: o.cancelReason }, o.cancelledAt as Date);
    }
  }
  audit(
    "royal-hold",
    officeId,
    "order.hold",
    "sales_order_line",
    lineId(ROYAL_DISPATCHING, 1),
    {
      orderId: soId(ROYAL_DISPATCHING),
      orderNumber: `SO-${ROYAL_DISPATCHING}`,
      lineNo: 1,
      customerId: input.customerId("royal"),
      bundleIds: royalHeld.map((b) => b.id),
      serials: royalHeld.map((b) => b.serial),
      kgG: grams(royalHeld),
      pcs: pcs(royalHeld),
      note: "For the second truck",
      lengthMismatch: [],
    },
    heldAt,
  );
  audit(
    "kd-reallocate-pending",
    officeId,
    "order.reallocate",
    "bundle_transfer",
    pendingBatch,
    { status: "pending", approvalId: pendingId, batchId: pendingBatch, toLineId: pendingTo, orderIds: [soId(KD_DISPATCHING), soId(TEJURA_OPEN)], bundles: kdPending.length, kgG: pendingKg, reasonCode: "customer_request" },
    new Date(clock.todayAt(0.2)),
  );

  // Party numbers for the bundles packed for a customer with its own series (after the dispatched ones).
  const partyBundles = [
    { customerKey: "kd", bundles: [...kdLatePacked, ...kd2Packed, ...kdOwnedPacked] },
    { customerKey: "royal", bundles: [...royal2Packed] },
  ];

  return {
    orders,
    lines,
    series,
    audits,
    approvals,
    transfers,
    bundlePatches: patchFor,
    itemLines,
    // Only Royal's truck was opened from the order (the others were built from bundles; their items still link to lines).
    dispatchOrders: new Map([["dev-dispatch-done-2", soId(ROYAL_DISPATCHING)]]),
    partyBundles,
    ids: { pendingReallocationApprovalId: pendingId, pendingBundleIds: kdPending.map((b) => b.id), heldBundleIds: royalHeld.map((b) => b.id) },
  };
}
