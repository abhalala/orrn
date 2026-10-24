/**
 * Shared fixture for the PL-8 sales test files (plant-sales, plant-sales-defects, plant-sales-gaps):
 * a plant with a yard, two sections, two customers, and helpers to pack, order, hold and read back.
 * Each test file keeps its own `env` (one Miniflare per file) and passes a getter for it.
 */
import { expect } from "bun:test";

import { approval, bundle, customer, dispatch, dispatchItem, packingList, salesOrder, stockLedger } from "@orrn/db/schema";
import { and, asc, eq, sql } from "drizzle-orm";

import type { LineBalance } from "../src/lib/orders";
import type { appRouter } from "../src/routers";
import type { CompanyRole, TestEnv } from "./harness";

/** Harness tests take 1–4 s each; under a loaded machine bun's 5 s default turns them into a Miniflare cascade. */
export const SLOW = 60_000;

export const ROLES: CompanyRole[] = [
  "owner", "admin", "manager", "office", "accountant", "supervisor", "packer",
  "foundry", "press", "storekeeper", "die_room", "operator", "viewer",
];

export const kg = (n: number) => Math.round(n * 1000);
/** 2026-10-03 12:00 IST. */
export const NOON = new Date("2026-10-03T06:30:00.000Z");
export const ist = (local: string) => new Date(`${local}+05:30`);

export type Api = ReturnType<typeof appRouter.createCaller>;

/**
 * `orders.update` as the order screen sends it: with the `serverSeq` the editor read (required since
 * PL-8 review round 3). An explicit `serverSeq` in `input` is sent as given (stale-save tests).
 */
export async function saveOrder(
  api: Api,
  input: Omit<Parameters<Api["orders"]["update"]>[0], "serverSeq"> & { serverSeq?: number },
) {
  const serverSeq = input.serverSeq ?? (await api.orders.get({ id: input.id })).order.serverSeq;
  return api.orders.update({ ...input, serverSeq });
}

/**
 * D11 (W1-OP-S review round 1 I-1): an order is confirmed only through `orders.confirm`, which
 * needs a PO and, on every line, pieces and a die copy or tier. PL-8 test orders are kg-only and
 * PO-less, so this fills what is missing first (PO `PO-<SO number>`, 1 piece, tier 1) with an
 * ordinary edit, then confirms. A non-booking order is left as it is.
 */
export async function confirmOrder(api: Api, id: string) {
  const got = await api.orders.get({ id });
  if (got.order.status !== "booking") return;
  if (got.confirmBlockers.length > 0) {
    const details = new Map(got.lineDetails.map((d) => [d.lineId, d]));
    await saveOrder(api, {
      id,
      poNumber: got.order.poNumber ?? `PO-${got.order.number}-${got.order.period}`,
      lines: got.lines.map((l) => {
        const d = details.get(l.lineId);
        return {
          id: l.lineId,
          sectionId: l.sectionId,
          cutLengthMm: l.cutLengthMm,
          kgPer12ftMilli: l.kgPer12ftMilli,
          kgG: l.orderedG,
          pcs: l.orderedPcs ?? 1,
          finish: l.finish,
          note: l.note,
          ...(d?.dieInstanceId || d?.tierRank != null ? {} : { tierRank: 1 }),
        };
      }),
    });
  }
  await api.orders.confirm({ id });
}

/** `orders.close` (a booking is confirmed first: §E2 closes only confirmed / dispatching orders). */
export async function closeOrder(api: Api, id: string, reason = "Closed in a test") {
  await confirmOrder(api, id);
  return api.orders.close({ id, reason });
}

/** `orders.cancel` with a reason. */
export async function cancelOrder(api: Api, id: string, reason = "Cancelled in a test") {
  return api.orders.cancel({ id, reason });
}

/**
 * §E2 has no "reopen" move (and an edit never moves a status, D11): tests that need a closed order
 * open again (PL-8 races against an order coming back) set it in the database, as another writer would.
 */
export async function reopenOrder(env: TestEnv, id: string) {
  await env.db
    .update(salesOrder)
    .set({ status: "confirmed", closedAt: null, closedBy: null, closeReason: null, serverSeq: sql`${salesOrder.serverSeq} + 1` })
    .where(eq(salesOrder.id, id));
}

type PackRow = { kg: number; pcs?: number; mm?: number; po?: string };
type OrderLineSpec = { dieId: string; kg: number; pcs?: number; finish?: string; mm?: number };

/** One seeded plant (explicit so the declaration emit never has to spell out the tRPC caller). */
export interface SalesPlant {
  companyId: string;
  users: Record<CompanyRole, { id: string; email: string }>;
  as(role: CompanyRole): Api;
  owner: Api;
  yard: string;
  dieA: string;
  dieB: string;
  customerId: string;
  otherCustomer: string;
  /** `dieInstanceId`: the copy pressed on (a section with an owned copy must name it, FP-PK-10). */
  pack(dieId: string, rows: PackRow[], salesOrderLineId?: string, dieInstanceId?: string): Promise<string[]>;
  order(
    lines: OrderLineSpec[],
    over?: { customerId?: string; poNumber?: string; status?: "booking" | "confirmed" },
  ): Promise<{ id: string; number: string; lineIds: string[] }>;
  held(serials: string[], cust?: string, api?: Api): Promise<string>;
  lineOf(lineId: string): Promise<LineBalance>;
}

export interface SalesHelpers {
  plant(opts?: { settings?: Record<string, unknown> }): Promise<SalesPlant>;
  itemsOf(dispatchId: string): Promise<{ id: string; bundleId: string; lineId: string | null; serial: string }[]>;
  dispatchRow(id: string): Promise<typeof dispatch.$inferSelect>;
  plRow(dispatchId: string): Promise<typeof packingList.$inferSelect | null>;
  ledgerOf(companyId: string, voucherId: string): Promise<(typeof stockLedger.$inferSelect)[]>;
  expectLedgerConsistent(p: SalesPlant): Promise<void>;
  pendingOverdraw(companyId: string, dispatchId: string): Promise<(typeof approval.$inferSelect)[]>;
}

let sectionSeq = 0;

export function salesHelpers(getEnv: () => TestEnv): SalesHelpers {
  async function plant(opts: { settings?: Record<string, unknown> } = {}): Promise<SalesPlant> {
    const env = getEnv();
    const { companyId, users } = await env.seedCompany({
      settings: {
        timezone: "Asia/Kolkata",
        letterhead: {
          legalName: "Fourcubes Aluminium Pvt Ltd",
          gstin: "24AAACF1234A1Z5",
          address: "Plot 12, GIDC, Surat 394 230",
          phone: "+91 98250 00000",
        },
        ...opts.settings,
      },
    });
    const as = (role: CompanyRole): Api => env.caller({ role, companyId });
    const owner: Api = as("owner");
    await owner.stock.locations.seedDefaults();
    const yard = (await owner.stock.locations.list()).items.find((l) => l.code === "Y1")!.id;
    sectionSeq += 1;
    const dieA = await env.seedDie(companyId, { series: "Domal", sectionCode: `1217${sectionSeq}A`, name: "Domal" });
    const dieB = await env.seedDie(companyId, { series: "Slim", sectionCode: `1288${sectionSeq}B`, name: null });
    const customerId = await env.seedCustomer(companyId);
    const otherCustomer = await env.seedCustomer(companyId);
    await env.db
      .update(customer)
      .set({
        taxId: "24ABCDE1234F1Z9",
        billingAddress: { line1: "Shed 4, Udhna", city: "Surat", state: "Gujarat", pincode: "394210" },
        shippingAddress: { name: "Site office", lines: ["Ring Road", "Vadodara"] },
      })
      .where(eq(customer.id, customerId));

    /** Pack bundles; rows are kg (and optional pcs / mm / po). Returns serials in row order. */
    async function pack(dieId: string, rows: PackRow[], salesOrderLineId?: string, dieInstanceId?: string) {
      const res = await owner.bundle.createReceipt({
        dieId,
        unit: "pcs",
        locationId: yard,
        ...(salesOrderLineId ? { salesOrderLineId } : {}),
        ...(dieInstanceId ? { dieInstanceId } : {}),
        rows: rows.map((r) => ({
          quantity: r.pcs ?? 10,
          weightG: kg(r.kg),
          lengthMm: r.mm ?? 3_658,
          poNumber: r.po ?? null,
        })),
      });
      const made = await env.db
        .select({ id: bundle.id, serial: bundle.serial, weightG: bundle.weightG })
        .from(bundle)
        .where(and(eq(bundle.companyId, companyId), eq(bundle.groupId, res.groupId)))
        .orderBy(asc(bundle.serial));
      return made.map((b) => b.serial);
    }

    async function order(
      lines: OrderLineSpec[],
      over: { customerId?: string; poNumber?: string; status?: "booking" | "confirmed" } = {},
    ) {
      const res = await owner.orders.create({
        customerId: over.customerId ?? customerId,
        poNumber: over.poNumber ?? null,
        lines: lines.map((l) => ({
          sectionId: l.dieId,
          cutLengthMm: l.mm ?? 3_658,
          kgG: kg(l.kg),
          pcs: l.pcs ?? null,
          finish: l.finish ?? null,
        })),
      });
      if (over.status === "confirmed") await confirmOrder(owner, res.id);
      const got = await owner.orders.get({ id: res.id });
      return { id: res.id, number: res.number, lineIds: got.lines.map((l) => l.lineId) };
    }

    /**
     * Create, scan and reserve a dispatch; returns its id. The owner builds it as the office does
     * (D12 `allowUnassigned`, since most fixtures pack plant stock with no order line).
     */
    async function held(serials: string[], cust = customerId, api: Api = owner) {
      const { id } = await api.dispatch.create({ customerId: cust });
      for (let i = 0; i < serials.length; i += 100) {
        await api.dispatch.addBundlesBySerial({ id, serials: serials.slice(i, i + 100), ...(api === owner ? { allowUnassigned: true } : {}) });
      }
      await api.dispatch.reserve({ id });
      return id;
    }

    async function lineOf(lineId: string): Promise<LineBalance> {
      const { lines } = await owner.orders.balance({ includeClosed: true });
      const l = lines.find((x) => x.lineId === lineId);
      if (!l) throw new Error(`line ${lineId} not in balance`);
      return l;
    }

    return { companyId, users, as, owner, yard, dieA, dieB, customerId, otherCustomer, pack, order, held, lineOf };
  }

  async function itemsOf(dispatchId: string) {
    return getEnv()
      .db.select({ id: dispatchItem.id, bundleId: dispatchItem.bundleId, lineId: dispatchItem.salesOrderLineId, serial: bundle.serial })
      .from(dispatchItem)
      .innerJoin(bundle, eq(bundle.id, dispatchItem.bundleId))
      .where(eq(dispatchItem.dispatchId, dispatchId))
      .orderBy(asc(bundle.serial));
  }

  async function dispatchRow(id: string) {
    const [d] = await getEnv().db.select().from(dispatch).where(eq(dispatch.id, id));
    return d!;
  }

  async function plRow(dispatchId: string) {
    const [pl] = await getEnv().db.select().from(packingList).where(eq(packingList.dispatchId, dispatchId));
    return pl ?? null;
  }

  async function ledgerOf(companyId: string, voucherId: string) {
    return getEnv()
      .db.select()
      .from(stockLedger)
      .where(and(eq(stockLedger.companyId, companyId), eq(stockLedger.voucherId, voucherId)));
  }

  /** Review Focus 1: ledger balance per bundle and location equals the bundle rows. */
  async function expectLedgerConsistent(p: SalesPlant) {
    const rows = await getEnv()
      .db.select({ id: bundle.id, status: bundle.status, locationId: bundle.locationId, weightG: bundle.weightG })
      .from(bundle)
      .where(eq(bundle.companyId, p.companyId));
    const proj = new Map<string, number>();
    for (const b of rows) if (b.status === "available" || b.status === "reserved") proj.set(`${b.id}|${b.locationId}`, b.weightG);
    const { items } = await p.owner.stock.balance({ itemKind: "bundle" });
    const led = new Map(items.filter((i) => (i.qtyG ?? 0) !== 0).map((i) => [`${i.itemRef}|${i.locationId}`, i.qtyG ?? 0]));
    const sorted = (m: Map<string, number>) => [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
    expect(sorted(led)).toEqual(sorted(proj));
  }

  async function pendingOverdraw(companyId: string, dispatchId: string) {
    return getEnv()
      .db.select()
      .from(approval)
      .where(
        and(
          eq(approval.companyId, companyId),
          eq(approval.kind, "dispatch_overdraw"),
          eq(approval.subjectId, dispatchId),
          eq(approval.status, "pending"),
        ),
      );
  }

  return { plant, itemsOf, dispatchRow, plRow, ledgerOf, expectLedgerConsistent, pendingOverdraw };
}
