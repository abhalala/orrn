/**
 * W1-PK-S: the hand pack path (FP-PK-01/02/03/05/10/14) on `bundle.createReceipt`, `bundle.previewLine`,
 * the stock views (FP-PK-08) and the ledger rows pack writes. The trolley (ageing) draw is a seam:
 * the `ageing_row` table is created here by hand, the way the ageing slice will ship it.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";

import { bundle, customer, die, dieInstance, packReject, stockLedger } from "@orrn/db/schema";
import { and, eq, sql } from "drizzle-orm";

import { createTestEnv, type TestEnv } from "./harness";
import { kg, NOON, salesHelpers, SLOW } from "./sales-fixture";

let env: TestEnv;
let setClock: (at: Date | null) => void;

beforeAll(async () => {
  env = await createTestEnv();
  setClock = (await import("../src/lib/clock")).setClockForTests;
}, 60_000);
afterEach(() => setClock(null));
afterAll(async () => {
  await env.dispose();
});

const { plant, ledgerOf } = salesHelpers(() => env);

async function ensureAgeingTable() {
  await env.db.run(
    sql`create table if not exists ageing_row (id text primary key, company_id text not null, die_id text not null,
      length_mm integer not null, pcs integer not null, packed_pcs integer not null default 0,
      scrap_pcs integer not null default 0, rework_pcs integer not null default 0)`,
  );
}

async function ageingRow(companyId: string, dieId: string, pcs: number, lengthMm = 3_658) {
  await ensureAgeingTable();
  const id = crypto.randomUUID();
  await env.db.run(sql`insert into ageing_row (id, company_id, die_id, length_mm, pcs) values (${id}, ${companyId}, ${dieId}, ${lengthMm}, ${pcs})`);
  return id;
}

async function packedPcs(id: string) {
  const [r] = await env.db.all<{ packed_pcs: number }>(sql`select packed_pcs from ageing_row where id = ${id}`);
  return Number(r!.packed_pcs);
}

/** A scale on the plant's edge node (column ships with W1-SPOOL; added here when absent). */
async function configureScale(companyId: string) {
  const cols = await env.db.all<{ name: string }>(sql`pragma table_info(spool_deployment)`);
  if (!cols.some((c) => c.name === "scale_configured")) {
    await env.db.run(sql`alter table spool_deployment add column scale_configured integer not null default 0`);
  }
  const id = crypto.randomUUID();
  await env.db.run(sql`insert into spool_deployment (id, company_id, instance_id, status, subdomain, spool_domain,
      cf_tunnel_token_wrapped, shared_secret_hash, shared_secret_wrapped, capabilities, scale_configured)
    values (${id}, ${companyId}, ${id}, 'active', ${id}, ${`${id}.example`}, 'x', 'x', 'x', '[]', 1)`);
}

const row = (kgs: number, pcs = 10, mm = 3_658) => ({ quantity: pcs, weightG: kg(kgs), lengthMm: mm });

describe("createReceipt: hand path batch", () => {
  test("server kg/12ft, party numbers and the packed-for line are written per bundle", async () => {
    setClock(NOON);
    const p = await plant();
    const o = await p.order([{ dieId: p.dieA, kg: 500 }]);
    const res = await p.owner.bundle.createReceipt({
      dieId: p.dieA,
      unit: "pcs",
      locationId: p.yard,
      salesOrderLineId: o.lineIds[0],
      rows: [row(30), row(31.5, 12), row(29)],
    });
    expect(res.bundleCount).toBe(3);
    expect(res.bundles).toHaveLength(3);
    const rows = await env.db.select().from(bundle).where(eq(bundle.groupId, res.groupId));
    for (const b of rows) {
      const got = res.bundles.find((x) => x.id === b.id)!;
      expect(b.kgPer12ftMilli).toBe(got.kgPer12ftMilli);
      // 12 ft = 3657.6 mm; kg per piece scaled to 12 ft.
      const expected = Math.round(((b.weightG / b.quantity) * 3657.6) / b.lengthMm);
      expect(Math.abs((b.kgPer12ftMilli ?? 0) - expected)).toBeLessThanOrEqual(1);
      expect(b.packedSalesOrderLineId).toBe(o.lineIds[0]!);
      // No party policy: the party number is the serial.
      expect(b.partyNo).toBe(b.serial);
      expect(b.weightSource).toBe("manual");
      expect(b.showLogo).toBe(true);
    }
  }, SLOW);

  test("more than 200 rows is refused before any write", async () => {
    setClock(NOON);
    const p = await plant();
    await expect(
      p.owner.bundle.createReceipt({ dieId: p.dieA, unit: "pcs", locationId: p.yard, rows: Array.from({ length: 201 }, () => row(5)) }),
    ).rejects.toThrow(/Max 200 rows/);
    expect(await env.db.select().from(bundle).where(eq(bundle.companyId, p.companyId))).toHaveLength(0);
  }, SLOW);

  test("200 rows land in one receipt within the bound-parameter limit", async () => {
    setClock(NOON);
    const p = await plant();
    const before = env.peakParams();
    const res = await p.owner.bundle.createReceipt({ dieId: p.dieA, unit: "pcs", locationId: p.yard, rows: Array.from({ length: 200 }, () => row(5)) });
    expect(res.bundleCount).toBe(200);
    expect(env.peakParams()).toBeLessThanOrEqual(Math.max(before, 100));
  }, SLOW);

  test("cast is required while requireCastOnBundle is on", async () => {
    setClock(NOON);
    const p = await plant({ settings: { requireCastOnBundle: true } });
    await expect(
      p.owner.bundle.createReceipt({ dieId: p.dieA, unit: "pcs", locationId: p.yard, rows: [row(10)] }),
    ).rejects.toThrow("Pick the cast these bundles came from");
    await expect(
      p.owner.bundle.createReceipt({ dieId: p.dieA, unit: "pcs", locationId: p.yard, castId: "nope", rows: [row(10)] }),
    ).rejects.toThrow("Cast not found");
  }, SLOW);

  test("branding off is snapshotted on the bundles (label hides the logo)", async () => {
    setClock(NOON);
    const p = await plant();
    const res = await p.owner.bundle.createReceipt({ dieId: p.dieA, unit: "pcs", locationId: p.yard, showLogo: false, rows: [row(10)] });
    const [b] = await env.db.select().from(bundle).where(eq(bundle.groupId, res.groupId));
    expect(b!.showLogo).toBe(false);
    const { loadPackLabelVariables } = await import("../src/lib/pack");
    const vars = await loadPackLabelVariables(env.db as never, p.companyId, b!);
    expect(vars.showLogo).toBe("0");
    expect(vars.partyNo).toBe(b!.serial);
    expect(vars.qr).toContain(encodeURIComponent(b!.serial).replace(/%2F/g, "/").split("/").pop()!);
  }, SLOW);

  test("label variables carry the packed-for order line code", async () => {
    setClock(NOON);
    const p = await plant();
    const o = await p.order([{ dieId: p.dieA, kg: 100 }]);
    const res = await p.owner.bundle.createReceipt({ dieId: p.dieA, unit: "pcs", locationId: p.yard, salesOrderLineId: o.lineIds[0], rows: [row(10)] });
    const [b] = await env.db.select().from(bundle).where(eq(bundle.groupId, res.groupId));
    const { loadPackLabelVariables } = await import("../src/lib/pack");
    const vars = await loadPackLabelVariables(env.db as never, p.companyId, b!);
    expect(vars.salesOrder).toBe(`${o.number}/1`);
    expect(vars.showLogo).toBe("1");
    expect(vars.cast).toBe("");
  }, SLOW);
});

describe("createReceipt: trolley seam (ageing row)", () => {
  test("refused while ageing tables do not exist", async () => {
    setClock(NOON);
    const p = await plant();
    const tables = await env.db.all<{ name: string }>(sql`select name from sqlite_master where type = 'table' and name = 'ageing_row'`);
    if (tables.length === 0) {
      await expect(
        p.owner.bundle.createReceipt({ dieId: p.dieA, unit: "pcs", locationId: p.yard, ageingRowId: "x", rows: [row(10)] }),
      ).rejects.toThrow("Packing from a trolley is not on yet; pack by hand");
    }
  }, SLOW);

  test("over-draw is refused with the server remaining; a fitting draw counts good and rejected pieces", async () => {
    setClock(NOON);
    const p = await plant();
    const rowId = await ageingRow(p.companyId, p.dieA, 25);
    await expect(
      p.owner.bundle.createReceipt({ dieId: p.dieA, unit: "pcs", locationId: p.yard, ageingRowId: rowId, rows: [row(10, 20), row(5, 6)] }),
    ).rejects.toThrow("Only 25 pieces left on this trolley row; this pack takes 26");
    await expect(
      p.owner.bundle.createReceipt({ dieId: p.dieB, unit: "pcs", locationId: p.yard, ageingRowId: rowId, rows: [row(10)] }),
    ).rejects.toThrow("That trolley row is of another section");
    await p.owner.bundle.createReceipt({
      dieId: p.dieA,
      unit: "pcs",
      locationId: p.yard,
      ageingRowId: rowId,
      rows: [row(20, 20)],
      rejects: [{ pcs: 2, reasonCode: "bend" }],
    });
    expect(await packedPcs(rowId)).toBe(22);
  }, SLOW);

  test("a concurrent draw that empties the row fails the whole batch (no bundles, no ledger)", async () => {
    setClock(NOON);
    const p = await plant();
    const rowId = await ageingRow(p.companyId, p.dieA, 20);
    env.beforeNextBatch(() => env.db.run(sql`update ageing_row set packed_pcs = 15 where id = ${rowId}`));
    await expect(
      p.owner.bundle.createReceipt({ dieId: p.dieA, unit: "pcs", locationId: p.yard, ageingRowId: rowId, rows: [row(10, 10)] }),
    ).rejects.toThrow(/left on this trolley row/);
    expect(await packedPcs(rowId)).toBe(15);
    expect(await env.db.select().from(bundle).where(eq(bundle.companyId, p.companyId))).toHaveLength(0);
    expect(await env.db.select().from(stockLedger).where(eq(stockLedger.companyId, p.companyId))).toHaveLength(0);
  }, SLOW);

  test("void gives the pieces back to the row; restore takes them again", async () => {
    setClock(NOON);
    const p = await plant();
    const rowId = await ageingRow(p.companyId, p.dieA, 30);
    const res = await p.owner.bundle.createReceipt({ dieId: p.dieA, unit: "pcs", locationId: p.yard, ageingRowId: rowId, rows: [row(10, 12)] });
    expect(await packedPcs(rowId)).toBe(12);
    const id = res.bundles[0]!.id;
    await p.owner.bundle.transitionStatus({ id, toStatus: "void", reason: "wrong cut" });
    expect(await packedPcs(rowId)).toBe(0);
    await p.owner.bundle.transitionStatus({ id, toStatus: "available" });
    expect(await packedPcs(rowId)).toBe(12);
  }, SLOW);
});

describe("createReceipt: weight source (FP-PK-02)", () => {
  test("typed weight needs a reason only when the plant has a scale", async () => {
    setClock(NOON);
    const p = await plant();
    // No scale: typed is fine without a reason.
    await p.owner.bundle.createReceipt({ dieId: p.dieA, unit: "pcs", locationId: p.yard, rows: [{ ...row(10), weightSource: "manual" }] });
    await configureScale(p.companyId);
    await expect(
      p.owner.bundle.createReceipt({ dieId: p.dieA, unit: "pcs", locationId: p.yard, rows: [row(10), { ...row(11), weightSource: "manual" }] }),
    ).rejects.toThrow("Row 1: say why the weight was typed instead of weighed");
    const ok = await p.owner.bundle.createReceipt({
      dieId: p.dieA,
      unit: "pcs",
      locationId: p.yard,
      rows: [
        { ...row(11), weightSource: "manual", scaleReadingG: kg(10.4), weightOverrideReason: "Scale drifting" },
        { ...row(12), weightSource: "scale", scaleReadingG: kg(12) },
      ],
    });
    const rows = await env.db.select().from(bundle).where(eq(bundle.groupId, ok.groupId));
    const typed = rows.find((b) => b.weightG === kg(11))!;
    expect(typed).toMatchObject({ weightSource: "manual", weightOverrideReason: "Scale drifting", scaleReadingG: kg(10.4) });
    expect(rows.find((b) => b.weightG === kg(12))).toMatchObject({ weightSource: "scale", scaleReadingG: kg(12) });
  }, SLOW);

  test("a scale weight must equal the reading", async () => {
    setClock(NOON);
    const p = await plant();
    await expect(
      p.owner.bundle.createReceipt({
        dieId: p.dieA,
        unit: "pcs",
        locationId: p.yard,
        rows: [{ ...row(12), weightSource: "scale", scaleReadingG: kg(11.9) }],
      }),
    ).rejects.toThrow("Row 1: a scale weight must be the reading");
  }, SLOW);
});

describe("createReceipt: owned die (FP-PK-10)", () => {
  test("refused naming the owner, for another customer's line and for plant stock; the owner's line packs", async () => {
    setClock(NOON);
    const p = await plant();
    const [owner] = await env.db.select({ name: customer.name }).from(customer).where(eq(customer.id, p.otherCustomer));
    await env.db.update(die).set({ ownerCustomerId: p.otherCustomer }).where(eq(die.id, p.dieA));
    const copyId = crypto.randomUUID();
    await env.db.insert(dieInstance).values({ id: copyId, companyId: p.companyId, sectionId: p.dieA, seqNo: 1, code: "D-1" });
    const mine = await p.order([{ dieId: p.dieA, kg: 100 }]);
    const theirs = await p.order([{ dieId: p.dieA, kg: 100 }], { customerId: p.otherCustomer });

    await expect(
      p.owner.bundle.createReceipt({ dieId: p.dieA, unit: "pcs", locationId: p.yard, dieInstanceId: copyId, salesOrderLineId: mine.lineIds[0], rows: [row(10)] }),
    ).rejects.toThrow(`This die belongs to ${owner!.name}`);
    await expect(
      p.owner.bundle.createReceipt({ dieId: p.dieA, unit: "pcs", locationId: p.yard, dieInstanceId: copyId, rows: [row(10)] }),
    ).rejects.toThrow(`This die belongs to ${owner!.name}`);
    await expect(
      p.owner.bundle.createReceipt({ dieId: p.dieA, unit: "pcs", locationId: p.yard, salesOrderLineId: theirs.lineIds[0], rows: [row(10)] }),
    ).rejects.toThrow("Pick the die copy");
    const ok = await p.owner.bundle.createReceipt({
      dieId: p.dieA,
      unit: "pcs",
      locationId: p.yard,
      dieInstanceId: copyId,
      salesOrderLineId: theirs.lineIds[0],
      rows: [row(10)],
    });
    const [b] = await env.db.select().from(bundle).where(eq(bundle.groupId, ok.groupId));
    expect(b!.dieInstanceId).toBe(copyId);
  }, SLOW);
});

describe("rejects at pack (FP-PK-14) and the ledger", () => {
  test("pack +kg at the yard, weighed rejects +kg at PLANT-SCRAP, unweighed rejects post nothing", async () => {
    setClock(NOON);
    const p = await plant();
    const res = await p.owner.bundle.createReceipt({
      dieId: p.dieA,
      unit: "pcs",
      locationId: p.yard,
      rows: [row(20), row(30)],
      rejects: [
        { pcs: 3, weightG: kg(4.5), reasonCode: "bend" },
        { pcs: 1, reasonCode: "other", note: "Dent at end" },
      ],
    });
    expect(res.rejectCount).toBe(2);
    const packRows = await ledgerOf(p.companyId, res.groupId);
    expect(packRows.every((r) => r.voucherType === "pack" && r.locationId === p.yard && r.qtyG > 0)).toBe(true);
    expect(packRows.reduce((s, r) => s + r.qtyG, 0)).toBe(kg(50));

    const rejects = await env.db.select().from(packReject).where(eq(packReject.groupId, res.groupId));
    expect(rejects.map((r) => r.reason).sort()).toEqual(["bend", "other: Dent at end"]);
    const scrap = await env.db
      .select()
      .from(stockLedger)
      .where(and(eq(stockLedger.companyId, p.companyId), eq(stockLedger.voucherType, "pack_reject")));
    expect(scrap).toHaveLength(1);
    expect(scrap[0]).toMatchObject({ itemKind: "return_stream", qtyG: kg(4.5) });
    expect(scrap[0]!.locationId).not.toBe(p.yard);
    const bal = await p.owner.stock.balance({ itemKind: "return_stream" });
    expect(bal.items.reduce((s, i) => s + (i.qtyG ?? 0), 0)).toBe(kg(4.5));
  }, SLOW);

  test("'other' needs a note; an unknown reason is refused", async () => {
    setClock(NOON);
    const p = await plant();
    await expect(
      p.owner.bundle.createReceipt({ dieId: p.dieA, unit: "pcs", locationId: p.yard, rows: [row(10)], rejects: [{ pcs: 1, reasonCode: "other" }] }),
    ).rejects.toThrow();
    await expect(
      p.owner.bundle.createReceipt({ dieId: p.dieA, unit: "pcs", locationId: p.yard, rows: [row(10)], rejects: [{ pcs: 1, reasonCode: "nope" }] }),
    ).rejects.toThrow();
    expect(await env.db.select().from(packReject).where(eq(packReject.companyId, p.companyId))).toHaveLength(0);
  }, SLOW);

  test("stock.rejections lists them with totals per reason", async () => {
    setClock(NOON);
    const p = await plant();
    await p.owner.bundle.createReceipt({
      dieId: p.dieA,
      unit: "pcs",
      locationId: p.yard,
      rows: [row(10)],
      rejects: [
        { pcs: 2, weightG: kg(1), reasonCode: "bend" },
        { pcs: 1, reasonCode: "surface" },
      ],
    });
    await p.owner.bundle.createReceipt({ dieId: p.dieB, unit: "pcs", locationId: p.yard, rows: [row(10)], rejects: [{ pcs: 4, reasonCode: "bend" }] });
    const all = await p.owner.stock.rejections();
    expect(all.items).toHaveLength(3);
    expect(all.byReason.find((r) => r.reasonCode === "bend")).toMatchObject({ lines: 2, pcs: 6, weightG: kg(1) });
    const onlyA = await p.owner.stock.rejections({ dieId: p.dieA, limit: 50, offset: 0 });
    expect(onlyA.items).toHaveLength(2);
  }, SLOW);
});

describe("stock.byDieLength and previewLine", () => {
  test("in-stock bundles group by section and cut length", async () => {
    setClock(NOON);
    const p = await plant();
    await p.pack(p.dieA, [{ kg: 10, mm: 3_658 }, { kg: 12, mm: 3_658 }, { kg: 8, mm: 4_877 }]);
    await p.pack(p.dieB, [{ kg: 5, mm: 3_658 }]);
    const res = await p.owner.stock.byDieLength();
    const a = res.items.filter((i) => i.dieId === p.dieA);
    expect(a.map((i) => [i.lengthMm, i.bundles, i.weightG])).toEqual([
      [3_658, 2, kg(22)],
      [4_877, 1, kg(8)],
    ]);
    expect(res.totals).toEqual({ bundles: 4, pcs: 40, weightG: kg(35) });
  }, SLOW);

  test("previewLine returns the server kg/12ft and a drift tone", async () => {
    setClock(NOON);
    const p = await plant();
    const prev = await p.owner.bundle.previewLine({ dieId: p.dieA, lengthMm: 3_658, weightG: kg(30), pcs: 10 });
    expect(Math.abs((prev.kgPer12ftMilli ?? 0) - 3_000)).toBeLessThanOrEqual(1);
    expect(prev.range12ft).toBe(3);
    expect(prev).toHaveProperty("driftTone");
  }, SLOW);
});
