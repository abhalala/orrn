/**
 * Demo sales orders for the dev seed (W1-OP-S, FP-OP): three orders whose lines sit in different
 * states, so the orders list, the balance strip, late orders and the confirm checklist have data.
 *
 * - SO-1 confirmed 25 days ago (late), PO-4471: line 1 by pieces with bundles packed for it (in
 *   stock), line 2 by kg with nothing made yet.
 * - SO-2 confirmed 3 days ago, PO-118, another customer: an 18 ft line on the band-start basis
 *   (no reading yet, `basis_note`), "tier 1 or better".
 * - SO-3 booking today, no PO yet: the confirm checklist shows what is missing.
 *
 * Ids are fixed (`dev-so-*`), the dev seed deletes every order of the demo company first, and the
 * SO series is written to match, so running the seed again gives the same rows (idempotent).
 */
import { orderGrams, orderPieces } from "@orrn/domain";
import type { auditLog } from "@orrn/db/schema/audit";
import type { die } from "@orrn/db/schema/catalog";
import type { customer } from "@orrn/db/schema/customers";
import type { bundle } from "@orrn/db/schema/inventory";
import type { salesOrder, salesOrderLine } from "@orrn/db/schema/sales";
import type { docSeries } from "@orrn/db/schema/series";
import { docPeriod } from "@orrn/server/lib/docNumber";

const FT12 = 3_658;
const FT18 = 5_486;
const DAY_MS = 86_400_000;

export type DemoOrderSeed = {
  orders: (typeof salesOrder.$inferInsert)[];
  lines: (typeof salesOrderLine.$inferInsert)[];
  series: (typeof docSeries.$inferInsert)[];
  audits: (typeof auditLog.$inferInsert)[];
  /** Bundle id -> order line it was packed for (applied to the seeded bundle rows). */
  bundleLines: Map<string, string>;
};

/** `YYYY-MM-DD` of the IST calendar day `daysAgo` days before `now`. */
function istDay(now: number, daysAgo: number): string {
  return new Date(now + 5.5 * 3_600_000 - daysAgo * DAY_MS).toISOString().slice(0, 10);
}

export function demoOrderSeed(input: {
  companyId: string;
  now: number;
  ownerId: string;
  officeId: string;
  customers: readonly (typeof customer.$inferInsert)[];
  dies: readonly (typeof die.$inferInsert)[];
  bundles: readonly (typeof bundle.$inferInsert)[];
  nextSeq: () => number;
}): DemoOrderSeed {
  const { companyId, now, ownerId, officeId, nextSeq } = input;
  const c1 = input.customers[0]?.id;
  const c2 = input.customers[1]?.id ?? c1;
  const d0 = input.dies[0];
  const d1 = input.dies[1] ?? d0;
  const d2 = input.dies[2] ?? d0;
  if (!c1 || !c2 || !d0?.id || !d1?.id || !d2?.id) throw new Error("dev-seed: orders need two customers and three dies");
  const at = (daysAgo: number) => new Date(now - daysAgo * DAY_MS);
  const period = docPeriod("so", new Date(now));
  const basis0 = d0.weightMinG;
  const basis1 = d1.weightMinG;
  const basis2 = d2.weightMinG;

  const order = (o: {
    n: number;
    customerId: string;
    po: string | null;
    daysAgo: number;
    status: "booking" | "confirmed";
    lineSeq: number;
    note?: string;
  }): typeof salesOrder.$inferInsert => ({
    id: `dev-so-${o.n}`,
    companyId,
    serverSeq: nextSeq(),
    period,
    number: `SO-${o.n}`,
    customerId: o.customerId,
    poNumber: o.po,
    orderDate: istDay(now, o.daysAgo),
    status: o.status,
    note: o.note ?? null,
    source: "office",
    confirmedAt: o.status === "confirmed" ? at(o.daysAgo) : null,
    confirmedBy: o.status === "confirmed" ? officeId : null,
    lineSeq: o.lineSeq,
    statusChangedAt: at(o.daysAgo),
    statusChangedBy: officeId,
    createdBy: officeId,
    createdAt: at(o.daysAgo),
  });

  const line = (l: {
    order: number;
    no: number;
    dieId: string;
    cutLengthMm: number;
    qtyBasis: "pcs" | "kg";
    pcs?: number;
    kgG?: number;
    basisMilli: number;
    tierRank?: number | null;
    basisNote?: string | null;
    daysAgo: number;
  }): typeof salesOrderLine.$inferInsert => {
    const pcs = l.qtyBasis === "pcs" ? l.pcs! : orderPieces(l.kgG!, l.cutLengthMm, l.basisMilli, "inch");
    const kgG = l.qtyBasis === "pcs" ? orderGrams(pcs, l.cutLengthMm, l.basisMilli, "inch") : l.kgG!;
    return {
      id: `dev-sol-${l.order}-${l.no}`,
      companyId,
      serverSeq: nextSeq(),
      salesOrderId: `dev-so-${l.order}`,
      lineNo: l.no,
      dieId: l.dieId,
      kgPer12ftMilli: l.basisMilli,
      cutLengthMm: l.cutLengthMm,
      pcs,
      kgG,
      finish: null,
      note: null,
      dieInstanceId: null,
      tierRank: l.tierRank ?? 1,
      qtyBasis: l.qtyBasis,
      impliedG: orderGrams(pcs, l.cutLengthMm, l.basisMilli, "inch"),
      weightBasis: "band_start",
      bandStartMilli: l.basisMilli,
      copyMilli: null,
      readingId: null,
      basisNote: l.basisNote ?? null,
      alloy: "6063",
      temper: "T6",
      ratePaise: null,
      createdBy: officeId,
      createdAt: at(l.daysAgo),
    };
  };

  const orders = [
    order({ n: 1, customerId: c1, po: "PO-4471", daysAgo: 25, status: "confirmed", lineSeq: 2, note: "Running late: die was at nitriding" }),
    order({ n: 2, customerId: c2, po: "PO-118", daysAgo: 3, status: "confirmed", lineSeq: 1 }),
    order({ n: 3, customerId: c1, po: null, daysAgo: 0, status: "booking", lineSeq: 1 }),
  ];
  const lines = [
    line({ order: 1, no: 1, dieId: d0.id, cutLengthMm: FT12, qtyBasis: "pcs", pcs: 200, basisMilli: basis0, daysAgo: 25 }),
    line({ order: 1, no: 2, dieId: d1.id, cutLengthMm: FT12, qtyBasis: "kg", kgG: 800_000, basisMilli: basis1, daysAgo: 25 }),
    line({
      order: 2,
      no: 1,
      dieId: d2.id,
      cutLengthMm: FT18,
      qtyBasis: "pcs",
      pcs: 150,
      basisMilli: basis2,
      basisNote: "No weight reading on the copy yet; band start used",
      daysAgo: 3,
    }),
    line({ order: 3, no: 1, dieId: d0.id, cutLengthMm: FT12, qtyBasis: "kg", kgG: 500_000, basisMilli: basis0, daysAgo: 0 }),
  ];

  // SO-1 line 1: up to three in-stock bundles of that die are packed for it.
  const bundleLines = new Map<string, string>();
  for (const b of input.bundles) {
    if (bundleLines.size >= 3) break;
    if (b.dieId === d0.id && b.status === "available" && !b.currentDispatchId && b.id) bundleLines.set(b.id, "dev-sol-1-1");
  }

  const series: (typeof docSeries.$inferInsert)[] = [
    { id: `dev-series-so-${period}`, companyId, docType: "so", period, value: orders.length, createdBy: ownerId },
  ];
  const audits: (typeof auditLog.$inferInsert)[] = orders.flatMap((o) => [
    {
      id: `dev-audit-${o.id}-create`,
      companyId,
      actorId: officeId,
      action: "order.create",
      subjectType: "sales_order",
      subjectId: o.id!,
      meta: { number: o.number, period, orderId: o.id, customerId: o.customerId },
      at: o.createdAt as Date,
    },
    ...(o.status === "confirmed"
      ? [
          {
            id: `dev-audit-${o.id}-confirm`,
            companyId,
            actorId: officeId,
            action: "order.confirm",
            subjectType: "sales_order",
            subjectId: o.id!,
            meta: { number: o.number, period, orderId: o.id },
            at: new Date((o.createdAt as Date).getTime() + 3_600_000),
          },
        ]
      : []),
  ]);
  return { orders, lines, series, audits, bundleLines };
}
