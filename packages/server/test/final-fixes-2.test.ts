/**
 * FINAL-FIXES-2: the owner's live tour on the demo seed. Each block reproduces what the owner saw
 * (BACKLOG 80, 81, 88, 91) and holds the one definition that now answers it.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";

import { setClockForTests } from "../src/lib/clock";
import { dispatchShipDay, enteredShipYmd } from "../src/lib/dispatchFigures";
import { buildPlSnapshotV2 } from "../src/lib/packingListSnapshot";
import { createTestEnv, type TestEnv } from "./harness";
import { DEV_SEED_COMPANY, DEV_SEED_PASSWORD, loadDevSeed, precreateDevSeedUsers } from "./dev-seed-fixture";
import { portalHelpers } from "./portal-w3-fixture";
import { dispatch as dispatchTable, user } from "@orrn/db/schema";
import { eq } from "drizzle-orm";

setDefaultTimeout(60_000);

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
  await precreateDevSeedUsers(env);
  const seed = await loadDevSeed();
  await seed(env.db, { password: DEV_SEED_PASSWORD });
}, 120_000);
afterAll(async () => {
  setClockForTests(null);
  await env.dispose();
});

const company = DEV_SEED_COMPANY;
const owner = () => env.caller({ role: "owner", companyId: company });

describe("BACKLOG 88: the line funnel", () => {
  test("every seeded line reads pressed >= packed (incl. dispatched) >= dispatched, and SO-7 line 1 shows what PR-11 logged", async () => {
    const o = owner();
    const ids = Array.from({ length: 10 }, (_, i) => `dev-so-${i + 1}`);
    for (const id of ids) {
      const detail = await o.orders.get({ id });
      for (const l of detail.lineDetails) {
        const s = l.strip;
        expect(s.pressedAllG, `${id} pressed >= packed`).toBeGreaterThanOrEqual(s.packedAllG);
        expect(s.packedAllG, `${id} packed >= dispatched`).toBeGreaterThanOrEqual(s.dispatchedG);
        expect(s.packedAllG).toBeGreaterThanOrEqual(s.packedG);
      }
    }
    const so7 = await o.orders.get({ id: "dev-so-7" });
    const line1 = so7.lineDetails.find((l) => l.lineId === "dev-sol-7-1")!.strip;
    // The old strip: pressed 0 (all of it already bundled), packed 0 (all of it gone out), dispatched 603.659.
    expect(line1.dispatchedG).toBeGreaterThan(0);
    expect(line1.pressedAllG).toBeGreaterThanOrEqual(211_500);
    expect(line1.packedAllG).toBeGreaterThanOrEqual(line1.dispatchedG);
  });

  test("the phone plan counts what was logged: PP-5 and PP-6 hold PR-11 and PR-12, PP-3 has pressed nothing yet", async () => {
    const { plans } = await owner().plans.phone({});
    const byNo = (n: string) => plans.find((p) => p.number === n)!;
    expect(byNo("PP-5").pressedG).toBe(211_500);
    expect(byNo("PP-5").pressedBp).toBeGreaterThan(0);
    expect(byNo("PP-5").dies.find((d) => d.sectionCode === "14701")!.pressedG).toBe(211_500);
    expect(byNo("PP-6").pressedG).toBe(238_800);
    expect(byNo("PP-3").pressedG).toBe(0);
  });
});

describe("BACKLOG 80: dispatch figures agree across the list, the detail and the packing list", () => {
  // 20:45 UTC is 02:15 the next day in IST: the moment a UTC-day reading and the plant's calendar part ways.
  const LATE_UTC = Date.UTC(2026, 9, 25, 20, 45);
  let late: TestEnv;
  beforeAll(async () => {
    late = await createTestEnv();
    await precreateDevSeedUsers(late);
    await (await loadDevSeed())(late.db, { password: DEV_SEED_PASSWORD, now: LATE_UTC });
  }, 120_000);
  afterAll(async () => {
    setClockForTests(null);
    await late.dispose();
  });

  const ist = (ms: number) => new Date(ms + 330 * 60_000).toISOString().slice(0, 10);

  test("every seeded dispatch has the same ship day and the same kg on the list and the detail; the packing list says the same", async () => {
    const o = late.caller({ role: "owner", companyId: company });
    const list = await o.dispatch.listDispatches({ limit: 100 });
    expect(list.items.length).toBeGreaterThanOrEqual(6);
    for (const row of list.items) {
      const detail = await o.dispatch.getDispatch({ id: row.id });
      expect(detail.shipDay, `${row.code} ship day`).toEqual(row.shipDay);
      expect(detail.totals.weightG, `${row.code} kg`).toBe(Number(row.totalWeightG));
      expect(detail.totals.bundles, `${row.code} bundles`).toBe(Number(row.itemCount));
      expect(detail.items.reduce((s, i) => s + Number(i.weightG), 0)).toBe(Number(row.totalWeightG));
      // The rule (review round 1, I1): a completed load reads the day it left; one still being built or held
      // reads the ship date somebody entered, in the plant's calendar.
      if (row.status === "completed") {
        expect(row.shipDay).toEqual({ ymd: ist(new Date(row.completedAt!).getTime()), kind: "dispatched" });
      } else if (row.shipDate) {
        expect(row.shipDay).toEqual({ ymd: ist(new Date(row.shipDate).getTime()), kind: "ship" });
      }
      const pl = await o.packingList.byDispatch({ dispatchId: row.id });
      if (row.status === "completed" && pl) {
        const snap = pl.snapshot as { header: { shipDate: string | null }; summary: { weightG: number; bundles: number } };
        // The packing list prints the ENTERED ship date only (it prints its own issue date besides).
        expect(snap.header.shipDate, `${row.code} packing list ship day`).toBe(row.shipDate ? ist(new Date(row.shipDate).getTime()) : null);
        expect(snap.summary.weightG, `${row.code} packing list kg`).toBe(Number(row.totalWeightG));
        expect(snap.summary.bundles).toBe(Number(row.itemCount));
      }
    }
  });

  test("DSP-000029 (held) and DSP-000034 (completed today): the day is the plant's, not the UTC date of the instant", async () => {
    const o = late.caller({ role: "owner", companyId: company });
    const list = await o.dispatch.listDispatches({ limit: 100 });
    const byCode = (c: string) => list.items.find((r) => r.code === c)!;
    const held = byCode("DSP-000029");
    const utcDay = new Date(held.shipDate!).toISOString().slice(0, 10);
    expect(held.shipDay!.kind).toBe("ship");
    expect(held.shipDay!.ymd).toBe(ist(new Date(held.shipDate!).getTime()));
    expect(held.shipDay!.ymd).not.toBe(utcDay);
    const done = byCode("DSP-000034");
    expect(Number(done.totalWeightG)).toBe(809_764);
    expect(done.shipDay!.ymd).toBe(ist(new Date(done.completedAt!).getTime()));
  });

  test("a load planned for one day that left on another reads the day it left on the list, the detail, the customer page, the portal and today; the packing list keeps the entered date", async () => {
    const o = late.caller({ role: "owner", companyId: company });
    const DAY = 86_400_000;
    // KD Extrusion's completed load: the party login's own customer, so the portal lists it too.
    const before = (await o.dispatch.listDispatches({ limit: 100 })).items.find((r) => r.id === "dev-dispatch-done-1")!;
    const planned = new Date(before.completedAt!).getTime() - 2 * DAY;
    await late.db.update(dispatchTable).set({ shipDate: new Date(planned) }).where(eq(dispatchTable.id, before.id));
    const want = { ymd: ist(new Date(before.completedAt!).getTime()), kind: "dispatched" as const };
    expect(ist(planned)).not.toBe(want.ymd);

    const row = (await o.dispatch.listDispatches({ limit: 100 })).items.find((r) => r.id === before.id)!;
    expect(row.shipDay).toEqual(want);
    expect((await o.dispatch.getDispatch({ id: before.id })).shipDay).toEqual(want);
    // The customer page lists the same rows (listDispatches by customer) and so reads the same day.
    const mine = (await o.dispatch.listDispatches({ customerId: before.customerId, limit: 100 })).items.find((r) => r.id === before.id)!;
    expect(mine.shipDay).toEqual(want);

    // The party portal: list, detail and Today carry the very same day.
    const [party] = await late.db.select({ id: user.id }).from(user).where(eq(user.email, "party@orrn.local"));
    const api = await portalHelpers(() => late).headerCaller(party!.id);
    const portalRows = (await api.portal.dispatches.list()).items;
    const portalMine = portalRows.find((r) => r.id === before.id);
    expect(portalMine, "the party sees its own completed load").toBeTruthy();
    expect(portalMine!.shipDay).toEqual(want);
    expect((await api.portal.dispatches.get({ id: before.id })).shipDay).toEqual(want);
    for (const r of portalRows) {
      const listed = (await o.dispatch.listDispatches({ limit: 100 })).items.find((x) => x.id === r.id)!;
      expect(r.shipDay, `${r.code} portal ship day`).toEqual(listed.shipDay);
    }
    const last = (await api.portal.today()).lastDispatch;
    expect(last, "Today carries the last dispatch").toBeTruthy();
    const listedLast = (await o.dispatch.listDispatches({ limit: 100 })).items.find((x) => x.id === last!.id)!;
    expect(last!.shipDay).toEqual(listedLast.shipDay);
  });
});

describe("BACKLOG 80: the ship-day rule itself (lib/dispatchFigures)", () => {
  const entered = new Date("2026-10-26T00:00:00.000Z");
  const left = new Date("2026-10-28T09:30:00.000Z");

  test("completed loads read the day they left; building and held loads read the entered ship date", () => {
    expect(dispatchShipDay({ status: "completed", completedAt: left, shipDate: entered }, "Asia/Kolkata")).toEqual({ ymd: "2026-10-28", kind: "dispatched" });
    expect(dispatchShipDay({ status: "completed", completedAt: left, shipDate: null }, "Asia/Kolkata")).toEqual({ ymd: "2026-10-28", kind: "dispatched" });
    expect(dispatchShipDay({ status: "draft", completedAt: null, shipDate: entered }, "Asia/Kolkata")).toEqual({ ymd: "2026-10-26", kind: "ship" });
    expect(dispatchShipDay({ status: "reserved", completedAt: null, shipDate: entered }, "Asia/Kolkata")).toEqual({ ymd: "2026-10-26", kind: "ship" });
    expect(dispatchShipDay({ status: "draft", completedAt: null, shipDate: null }, "Asia/Kolkata")).toBeNull();
    // A completed row without a completion instant (never happens, but) falls back to the entered date.
    expect(dispatchShipDay({ status: "completed", completedAt: null, shipDate: entered }, "Asia/Kolkata")).toEqual({ ymd: "2026-10-26", kind: "ship" });
    // The day is the plant's: 20:30 UTC is already the next day in IST.
    expect(dispatchShipDay({ status: "completed", completedAt: new Date("2026-10-28T20:30:00.000Z"), shipDate: null }, "Asia/Kolkata")?.ymd).toBe("2026-10-29");
  });

  test("m10: a ship date typed as a day (UTC midnight, how the web and the phone store it) is that day in every zone; any other instant is read on the plant's clock", () => {
    const typed = new Date(Date.UTC(2026, 9, 26));
    for (const tz of ["Asia/Kolkata", "America/New_York", "Pacific/Auckland"]) {
      expect(dispatchShipDay({ status: "draft", completedAt: null, shipDate: typed }, tz)).toEqual({ ymd: "2026-10-26", kind: "ship" });
      expect(enteredShipYmd(typed, tz)).toBe("2026-10-26");
    }
    // A real instant (the seed's, an import's) still goes by the plant's calendar: 20:00 UTC on the 4th is the 5th in IST.
    const instant = new Date("2026-10-04T20:00:00.000Z");
    expect(enteredShipYmd(instant, "Asia/Kolkata")).toBe("2026-10-05");
    expect(enteredShipYmd(instant, "America/New_York")).toBe("2026-10-04");
  });

  test("the packing list header carries the entered ship date only, never the completion day", () => {
    expect(enteredShipYmd(entered, "Asia/Kolkata")).toBe("2026-10-26");
    expect(enteredShipYmd(null, "Asia/Kolkata")).toBeNull();
    const snap = (shipDate: Date | null) =>
      buildPlSnapshotV2({
        plNumber: "PL/2026-27/1", date: "2026-10-28", generatedAt: left, generatedBy: "u",
        company: { id: "c", name: "FC", settings: null },
        dispatch: { code: "D1", status: "completed", shipDate, notes: null, completedAt: left, vehicleNo: null, driverName: null, driverPhone: null, transporter: null, invoiceNumber: null, invoiceDate: null },
        customer: null,
        items: [],
      });
    expect(snap(entered).header.shipDate).toBe("2026-10-26");
    expect(snap(null).header.shipDate).toBeNull();
  });
});

describe("BACKLOG 91: one meaning for in stock and for held", () => {
  test("in stock is the available bundles on Today, the Stock screen, the stock-age chart and the stock-age report", async () => {
    const o = owner();
    const today = await o.dashboard.today();
    const position = (await o.stock.byDieLength({ includeReserved: true })).stock;
    const chart = await o.analytics.stockAgeing();
    const report = await o.analytics.stockAge({});
    const [row] = (await env.d1
      .prepare("select count(*) n, coalesce(sum(weight_g), 0) w from bundle where company_id = ? and status = 'available'")
      .bind(company)
      .all()).results as { n: number; w: number }[];
    const want = { bundles: Number(row!.n), weightG: Number(row!.w) };

    expect({ bundles: today.kpis.inStockBundles, weightG: today.kpis.inStockG }).toEqual(want);
    expect({ bundles: position.inStock.bundles, weightG: position.inStock.weightG }).toEqual(want);
    // The owner's tour: the chart on Today read 4,395.8 kg against 3,849.6 kg (it added the held truck).
    expect(chart.totals).toEqual({ bundles: want.bundles, kgG: want.weightG });
    expect(chart.buckets.reduce((s, b) => s + b.kgG, 0)).toBe(want.weightG);
    expect(chart.topSections.reduce((s, x) => s + x.kgG, 0)).toBe(want.weightG);
    expect(report.totals).toEqual({ bundles: want.bundles, kgG: want.weightG });
  });

  test("held is the reserved bundles on held dispatches; Orders' wider 'held for orders' is that plus the yard holds, and says so", async () => {
    const o = owner();
    const position = (await o.stock.byDieLength({ includeReserved: true })).stock;
    const [heldTruck] = (await env.d1
      .prepare("select count(*) n, coalesce(sum(weight_g), 0) w from bundle where company_id = ? and status = 'reserved'")
      .bind(company)
      .all()).results as { n: number; w: number }[];
    expect({ bundles: position.held.bundles, weightG: position.held.weightG }).toEqual({ bundles: Number(heldTruck!.n), weightG: Number(heldTruck!.w) });
    // The seed's held dispatch: 10 bundles, 546.248 kg.
    expect(position.held).toMatchObject({ bundles: 10, weightG: 546_248 });

    // Orders: held for orders = bundles on held dispatches (linked to a line) + bundles held in the yard for a line.
    const [yardHold] = (await env.d1
      .prepare("select count(*) n, coalesce(sum(weight_g), 0) w from bundle where company_id = ? and status = 'available' and held_for_line_id is not null")
      .bind(company)
      .all()).results as { n: number; w: number }[];
    expect(Number(yardHold!.n)).toBe(2);
    const book = await o.orders.bookTotals({});
    expect(book.heldBundles).toBe(position.held.bundles + Number(yardHold!.n));
    expect(book.heldG).toBe(position.held.weightG + Number(yardHold!.w));
  });
});

describe("BACKLOG 91: the held rule (AGENTS.md, Stock words)", () => {
  test("held is the bundle status `reserved`: every reserved bundle is on a held load, and a bundle listed on a building load is still in stock", async () => {
    const orphans = (await env.d1
      .prepare(
        "select count(*) n from bundle b left join dispatch d on d.id = b.current_dispatch_id and d.company_id = b.company_id where b.company_id = ? and b.status = 'reserved' and (d.id is null or d.status <> 'reserved')",
      )
      .bind(company)
      .all()).results as { n: number }[];
    expect(Number(orphans[0]!.n)).toBe(0);
    const building = (await env.d1
      .prepare(
        "select count(*) n, sum(case when b.status = 'available' then 1 else 0 end) a from dispatch_item di join dispatch d on d.id = di.dispatch_id and d.company_id = di.company_id join bundle b on b.id = di.bundle_id and b.company_id = di.company_id where di.company_id = ? and d.status = 'draft'",
      )
      .bind(company)
      .all()).results as { n: number; a: number }[];
    expect(Number(building[0]!.n)).toBeGreaterThan(0);
    expect(Number(building[0]!.a)).toBe(Number(building[0]!.n));
    // The count every screen shows: held bundles = the items of held loads (the seed has one, ten bundles).
    const position = (await owner().stock.byDieLength({ includeReserved: true })).stock;
    const onHeldLoads = (await env.d1
      .prepare("select count(*) n from dispatch_item di join dispatch d on d.id = di.dispatch_id and d.company_id = di.company_id where di.company_id = ? and d.status = 'reserved'")
      .bind(company)
      .all()).results as { n: number }[];
    expect(position.held.bundles).toBe(Number(onHeldLoads[0]!.n));
  });
});

describe("BACKLOG 88: one line walked through run, pack and dispatch (own plant, it completes a dispatch)", () => {
  let walkEnv: TestEnv;
  beforeAll(async () => {
    walkEnv = await createTestEnv();
    await precreateDevSeedUsers(walkEnv);
    await (await loadDevSeed())(walkEnv.db, { password: DEV_SEED_PASSWORD });
  }, 120_000);
  afterAll(async () => {
    setClockForTests(null);
    await walkEnv.dispose();
  });

  test("walk one line: run logged, bundles packed, dispatch completes; the funnel stays monotone and Today, orders and the portal agree", async () => {
    const o = walkEnv.caller({ role: "owner", companyId: company });
    const strip = async (so: string, line: string) => (await o.orders.get({ id: so })).lineDetails.find((l) => l.lineId === line)!.strip;
    // SO-9 line 2 (flat 14730): PR-12 logged 238.8 kg, bundles packed, ten bundles on the held truck.
    const held = await o.dispatch.getDispatch({ id: "dev-dispatch-held" });
    const lineOf = held.items.find((i) => i.salesOrderLineId)?.salesOrderLineId;
    expect(lineOf).toBeTruthy();
    const so = lineOf!.replace(/^dev-sol-(\d+)-\d+$/, "dev-so-$1");
    const before = await strip(so, lineOf!);
    expect(before.pressedAllG).toBeGreaterThanOrEqual(before.packedAllG);
    await o.dispatch.complete({ id: "dev-dispatch-held" });
    const after = await strip(so, lineOf!);
    expect(after.dispatchedG).toBeGreaterThan(before.dispatchedG);
    expect(after.pressedAllG).toBeGreaterThanOrEqual(after.packedAllG);
    expect(after.packedAllG).toBeGreaterThanOrEqual(after.dispatchedG);
    // Dispatching moves kg from packed to dispatched; it never un-presses or un-packs anything.
    expect(after.pressedAllG).toBe(before.pressedAllG);
    expect(after.packedAllG).toBe(before.packedAllG);

    // Orders list, order detail and the dispatched baki agree.
    const list = await o.orders.list({} as never);
    const row = list.items.find((r) => r.id === so)!;
    const detail = await o.orders.get({ id: so });
    expect(row.dispatchedG).toBe(detail.totals.dispatchedG);
    expect(row.bakiG).toBe(detail.totals.bakiG);

    // Today's pressed kg is the press summary's (production runs only).
    const today = await o.dashboard.today();
    const summary = await o.press.summary({} as never);
    expect(today.pressedToday?.kgG).toBe(summary.kgG);

    // The party portal reads the same dispatched / baki for KD's SO-7.
    const [party] = await walkEnv.db.select({ id: user.id }).from(user).where(eq(user.email, "party@orrn.local"));
    const api = await portalHelpers(() => walkEnv).headerCaller(party!.id);
    const portalList = await api.portal.orders.list();
    const so7 = (await o.orders.get({ id: "dev-so-7" })).totals;
    const portalSo7 = portalList.items.find((r) => r.number === "SO-7");
    expect(portalSo7?.totals.dispatchedG).toBe(so7.dispatchedG);
    expect(portalSo7?.totals.bakiG).toBe(so7.bakiG);
  });
});

describe("BACKLOG 81: press alerts, one meaning of open", () => {
  let alertEnv: TestEnv;
  beforeAll(async () => {
    alertEnv = await createTestEnv();
    await precreateDevSeedUsers(alertEnv);
    await (await loadDevSeed())(alertEnv.db, { password: DEV_SEED_PASSWORD });
  }, 120_000);
  afterAll(async () => {
    setClockForTests(null);
    await alertEnv.dispose();
  });

  test("open = not acknowledged, ended or not: the Today chip, the alerts list, its tab count and the empty state agree on the seed", async () => {
    const o = alertEnv.caller({ role: "owner", companyId: company });
    const [row] = (await alertEnv.d1
      .prepare("select count(*) n, sum(case when acknowledged_at is null then 1 else 0 end) u, sum(case when acknowledged_at is null and ended_at is not null then 1 else 0 end) e from press_alert where company_id = ?")
      .bind(company)
      .all()).results as { n: number; u: number; e: number }[];
    const unacknowledged = Number(row!.u);
    // The owner's tour: four were Ended and never acknowledged, yet the page said "No open alerts".
    expect(Number(row!.e)).toBe(4);
    expect(unacknowledged).toBe(4);

    const today = await o.dashboard.today();
    const list = await o.press.collector.alerts({ openOnly: true, limit: 100 });
    const counts = await o.press.collector.openAlertCount();
    expect(today.pressAlerts?.open).toBe(unacknowledged);
    expect(list).toHaveLength(unacknowledged);
    expect(counts).toMatchObject({ open: unacknowledged, all: Number(row!.n) });
    expect((await o.press.collector.alerts({ openOnly: false, limit: 100 })).length).toBe(counts.all);
    // The list's rows say ended or ongoing on their own; both are open until acknowledged.
    expect(list.every((a) => a.acknowledgedAt === null)).toBe(true);

    // Acknowledge them all: the list, the count and the chip empty together (the "No open alerts" state).
    for (const a of list) await o.press.collector.acknowledgeAlert({ id: a.id });
    expect(await o.press.collector.alerts({ openOnly: true, limit: 100 })).toEqual([]);
    expect((await o.press.collector.openAlertCount()).open).toBe(0);
    expect((await o.dashboard.today()).pressAlerts?.open).toBe(0);
  });
});
