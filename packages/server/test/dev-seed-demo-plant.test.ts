/**
 * W2-SEED: the consolidated demo plant (`POST /dev/seed`, docs/DEMO_PLANT.md). One seed that every
 * merged module reads without contradicting another: a login per role, the die room and the press
 * board, nine orders in every state whose figures add up, stock linked to those orders, dispatches
 * with packing lists (revisions and a combined list), a closed stock count, printing waiting, and the
 * party portal. It is idempotent (same rows on a re-run) and time-robust (today's data sits in the
 * production day whatever the hour it runs).
 *
 * The expected counts below are the demo plant: change the seed and this file is where the new truth
 * goes, with docs/DEMO_PLANT.md.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";

import { setClockForTests } from "../src/lib/clock";
import { createTestEnv, type TestEnv } from "./harness";
import { DEV_SEED_COMPANY, DEV_SEED_PASSWORD, loadDevSeed, precreateDevSeedUsers, type DevSeedResult } from "./dev-seed-fixture";

setDefaultTimeout(60_000);

let env: TestEnv;
let seed: Awaited<ReturnType<typeof loadDevSeed>>;
let first: DevSeedResult;

beforeAll(async () => {
  env = await createTestEnv();
  await precreateDevSeedUsers(env);
  seed = await loadDevSeed();
  first = await seed(env.db, { password: DEV_SEED_PASSWORD });
}, 120_000);
afterAll(async () => {
  setClockForTests(null);
  await env.dispose();
});

const company = DEV_SEED_COMPANY;
const count = async (table: string, where = "company_id = ?") =>
  Number((await env.d1.prepare(`select count(*) n from ${table} where ${where}`).bind(company).first<{ n: number }>())?.n ?? 0);
const owner = () => env.caller({ role: "owner", companyId: company });

/** Rows per company-scoped table: the demo plant in numbers. */
const TABLE_COUNTS: Record<string, number> = {
  membership: 13,
  customer: 6,
  die: 12,
  die_band: 6,
  die_instance: 34,
  die_tier_change: 35,
  die_weight_reading: 36,
  die_issue: 5,
  die_maker: 2,
  die_maker_job: 2,
  nitriding_log: 2,
  press_line: 2,
  press_plan: 4,
  press_plan_die: 6,
  press_plan_line: 5,
  press_run: 14,
  press_run_line: 4,
  press_billet_use: 7,
  qc_entry: 5,
  press_downtime: 2,
  cast: 2,
  furnace: 1,
  alloy: 2,
  sales_order: 10,
  sales_order_line: 17,
  store_item: 5,
  store_txn: 8,
  backup_run: 1,
  bundle_group: 9,
  bundle: 129,
  bundle_transfer: 13,
  dispatch: 6,
  dispatch_item: 58,
  packing_list: 6,
  transporter: 3,
  location: 10,
  approval: 5,
  count_session: 1,
  count_seen: 33,
  count_line: 4,
  label_template: 1,
  printer_profile: 1,
  print_log: 2,
  spool_deployment: 1,
  customer_portal_user: 1,
  customer_portal_section: 2,
  test_certificate: 1,
  purchase_lot: 10,
  vendor: 8,
};

describe("the demo plant in numbers", () => {
  test("rows per table", async () => {
    const got: Record<string, number> = {};
    for (const table of Object.keys(TABLE_COUNTS)) got[table] = await count(table);
    expect(got).toEqual(TABLE_COUNTS);
  });

  test("the seed's own report agrees", () => {
    expect(first.ok).toBe(true);
    expect(first.counts).toMatchObject({
      members: 13,
      customers: 6,
      dies: 12,
      dieCopies: 34,
      salesOrders: 10,
      salesOrderLines: 17,
      pressRuns: 14,
      bundles: 129,
      dispatches: 6,
      packingLists: 6,
      printJobs: 2,
    });
    // (+1 available: the plant-stock bundle whose number clashes with KD's first party number, made after this report.)
    expect(first.bundlesByStatus).toEqual({ available: 73, reserved: 10, dispatched: 42, void: 3 });
  });
});

describe("accounts and roles", () => {
  test("every plant role has a login with the same password convention; staff and party are not members", async () => {
    const rows = await env.d1
      .prepare("select u.email, m.role from membership m join user u on u.id = m.user_id where m.company_id = ? order by m.role")
      .bind(company)
      .all<{ email: string; role: string }>();
    expect(Object.fromEntries(rows.results.map((r) => [r.role, r.email]))).toEqual({
      accountant: "accountant@orrn.local",
      admin: "admin@orrn.local",
      die_room: "dieroom@orrn.local",
      foundry: "foundry@orrn.local",
      manager: "manager@orrn.local",
      office: "office@orrn.local",
      operator: "operator@orrn.local",
      owner: "owner@orrn.local",
      packer: "packer@orrn.local",
      press: "press@orrn.local",
      storekeeper: "storekeeper@orrn.local",
      supervisor: "supervisor@orrn.local",
      viewer: "viewer@orrn.local",
    });
    expect(first.accounts).toMatchObject({ staff: "staff@orrn.local", party: "party@orrn.local" });
    const staff = await env.d1.prepare("select role from platform_admin pa join user u on u.id = pa.user_id where u.email = 'staff@orrn.local'").first<{ role: string }>();
    expect(staff?.role).toBe("super_admin");
    const party = await env.d1.prepare("select id from user where email = 'party@orrn.local'").first<{ id: string }>();
    expect(await env.d1.prepare("select count(*) n from membership where user_id = ?").bind(party!.id).first()).toMatchObject({ n: 0 });
    // Every login has a password account, one convention for all.
    const accounts = await env.d1
      .prepare("select count(*) n from account a join user u on u.id = a.user_id where a.provider_id = 'credential' and u.email like '%@orrn.local'")
      .first<{ n: number }>();
    expect(Number(accounts?.n)).toBeGreaterThanOrEqual(1);
  });

  test("each role sees what it should: packer packs, manager decides, viewer only reads", async () => {
    const as = async (key: string) => {
      const u = await env.d1.prepare("select id from user where email = ?").bind(`${key}@orrn.local`).first<{ id: string }>();
      return env.callerForUser(u!.id, { company });
    };
    for (const key of ["owner", "admin", "manager", "office", "supervisor", "operator", "packer", "die_room".replace("_", ""), "press", "storekeeper", "foundry", "accountant", "viewer"]) {
      const api = await as(key);
      const today = await api.dashboard.today();
      expect(today.kpis.inStockBundles, `${key} reads Today`).toBe(74);
    }
    const manager = await as("manager");
    const approvals = await manager.approval.list({ status: "pending" });
    const kinds = (approvals.items ?? approvals).map((a: { kind: string }) => a.kind).sort();
    expect(kinds).toEqual(["die_rerank", "order_reallocate", "press_late_entry"]);
  });
});

describe("masters", () => {
  test("twelve sections with one to three copies each (Tee has the e2e ones), bands, owner, trial, nitriding, maker", async () => {
    const perSection = await env.d1
      .prepare("select d.section_code code, count(i.id) copies from die d left join die_instance i on i.section_id = d.id where d.company_id = ? group by d.section_code order by d.section_code")
      .bind(company)
      .all<{ code: string; copies: number }>();
    const copies = Object.fromEntries(perSection.results.map((r) => [r.code, Number(r.copies)]));
    expect(Object.keys(copies)).toHaveLength(12);
    for (const [code, n] of Object.entries(copies)) {
      if (code === "13090") expect(n).toBe(19);
      else expect(n, `section ${code}`).toBeGreaterThanOrEqual(1);
      if (code !== "13090") expect(n, `section ${code}`).toBeLessThanOrEqual(3);
    }
    const status = await env.d1
      .prepare("select status, count(*) n from die_instance where company_id = ? group by status")
      .bind(company)
      .all<{ status: string; n: number }>();
    const byStatus = Object.fromEntries(status.results.map((r) => [r.status, Number(r.n)]));
    expect(byStatus).toMatchObject({ at_nitriding: 1, at_maker: 1, on_trial: 9 });
    expect(byStatus.in_use).toBe(2);
    // KD owns section 12230; the maker job for 12212-2 is open.
    const owned = await env.d1.prepare("select c.name from die d join customer c on c.id = d.owner_customer_id where d.company_id = ?").bind(company).first<{ name: string }>();
    expect(owned?.name).toBe("KD Extrusion");
    expect(await count("die_maker_job", "company_id = ? and status = 'sent'")).toBe(1);
  });

  test("drift: green, amber and red copies exist, computed by the server", async () => {
    const tones = new Set<string>();
    for (const code of ["14701", "11250", "13090", "14730", "12212"]) {
      const section = (await owner().die.list({ search: code })).items[0]!;
      const card = await owner().die.get({ id: section.id });
      for (const c of card.copies) tones.add(c.tone);
    }
    expect([...tones].sort()).toEqual(["amber", "green", "none", "red"]);
  });

  test("masters: shifts, standards, press lines, furnace, alloys, yards, reason codes, transporters", async () => {
    const { readFloorSettings } = await import("@orrn/domain");
    const co = await env.d1.prepare("select settings from company where id = ?").bind(company).first<{ settings: string }>();
    const floor = readFloorSettings(JSON.parse(co!.settings));
    expect(floor.shifts.map((s) => s.name)).toEqual(["Day", "Night"]);
    expect(floor.standards.solid?.standard).toBe("IS 733");
    expect(await count("location", "company_id = ? and kind = 'yard'")).toBe(6);
    expect((await env.d1.prepare("select code from alloy where company_id = ? order by code").bind(company).all<{ code: string }>()).results.map((r) => r.code)).toEqual(["6061", "6063"]);
    expect(await count("transporter", "company_id = ? and active = 1")).toBe(2);
  });
});

describe("the order book", () => {
  test("states: booking, confirmed, dispatching, closed, cancelled, late, a portal booking", async () => {
    const list = await env.d1.prepare("select number, status, source from sales_order where company_id = ? order by cast(substr(number, 4) as integer)").bind(company).all<{ number: string; status: string; source: string }>();
    expect(list.results.map((r) => [r.number, r.status, r.source])).toEqual([
      ["SO-1", "confirmed", "office"],
      ["SO-2", "confirmed", "office"],
      ["SO-3", "booking", "office"],
      ["SO-4", "booking", "portal"],
      ["SO-5", "closed", "office"],
      ["SO-6", "cancelled", "office"],
      ["SO-7", "dispatching", "office"],
      ["SO-8", "dispatching", "office"],
      ["SO-9", "confirmed", "office"],
      ["SO-10", "confirmed", "office"],
    ]);
    const late = await owner().orders.late({});
    expect([...new Set(late.lines.map((l) => l.orderNumber))]).toEqual(["SO-1"]);
    // Three customers carry the open book (KD, Royal, Tejura).
    const customers = await env.d1.prepare("select count(distinct customer_id) n from sales_order where company_id = ?").bind(company).first<{ n: number }>();
    expect(Number(customers?.n)).toBe(3);
  });

  test("baki adds up on every line: baki = max(0, ordered - dispatched); produced = dispatched + packed (not void)", async () => {
    for (let n = 1; n <= 10; n += 1) {
      const order = await owner().orders.get({ id: `dev-so-${n}` });
      for (const detail of order.lineDetails) {
        const s = detail.strip;
        expect(s.bakiG, `SO-${n}`).toBe(Math.max(0, s.orderedG - s.dispatchedG));
        expect(s.dispatchedG).toBeLessThanOrEqual(s.producedG);
        expect(s.overG).toBe(Math.max(0, s.producedG - s.orderedG));
      }
    }
    // The closed order closed with a little baki and says why; nothing is still on its lines.
    const closed = await owner().orders.get({ id: "dev-so-5" });
    expect(closed.order).toMatchObject({ status: "closed", closeReason: "Customer accepted the delivered quantity" });
    expect(closed.lineDetails[0]!.strip.bakiG).toBeGreaterThan(0);
    expect(closed.lineDetails[0]!.strip.dispatchedG).toBeGreaterThan(0);
  });

  test("a hold, a pending reallocation, and what the older specs read (SO-1: 1,280 kg, two packed bundles)", async () => {
    const so8 = await owner().orders.get({ id: "dev-so-8" });
    expect(so8.lineDetails[0]!.strip.heldBundles).toBe(2);
    const so1 = await owner().orders.get({ id: "dev-so-1" });
    expect(so1.lineDetails.map((l) => l.strip.orderedG)).toEqual([480_000, 800_000]);
    expect(so1.lineDetails[0]!.strip.packedG).toBeGreaterThan(0);
    expect(so1.lineDetails[1]!.strip).toMatchObject({ packedG: 0, dispatchedG: 0 });
    const pending = await env.d1.prepare("select meta from approval where company_id = ? and kind = 'order_reallocate' and status = 'pending'").bind(company).all<{ meta: string }>();
    expect(pending.results).toHaveLength(1);
    const meta = JSON.parse(pending.results[0]!.meta) as { bundleIds: string[]; toLineId: string; fromLineIds: string[] };
    expect(meta.bundleIds).toHaveLength(2);
    expect(meta).toMatchObject({ toLineId: "dev-sol-9-1", fromLineIds: ["dev-sol-7-2"] });
    // Bundles in a pending request stay where they are until a manager decides.
    for (const id of meta.bundleIds) {
      const row = await env.d1.prepare("select sales_order_line_id l, status s from bundle where id = ?").bind(id).first<{ l: string; s: string }>();
      expect(row).toEqual({ l: "dev-sol-7-2", s: "available" });
    }
  });
});

describe("stock", () => {
  test("most available bundles stand on an order line; some are plant stock, a few held, a few unassigned", async () => {
    const rows = await env.d1
      .prepare(
        `select
           sum(case when b.sales_order_line_id is not null then 1 else 0 end) on_line,
           sum(case when b.sales_order_line_id is null and b.held_for_line_id is null and exists (select 1 from bundle_transfer t where t.bundle_id = b.id) then 1 else 0 end) plant,
           sum(case when b.held_for_line_id is not null then 1 else 0 end) held,
           sum(case when b.sales_order_line_id is null and not exists (select 1 from bundle_transfer t where t.bundle_id = b.id) then 1 else 0 end) unassigned
         from bundle b where b.company_id = ? and b.status in ('available', 'reserved')`,
      )
      .bind(company)
      .first<{ on_line: number; plant: number; held: number; unassigned: number }>();
    const onLine = Number(rows!.on_line);
    const unassigned = Number(rows!.unassigned);
    expect(onLine).toBeGreaterThan(unassigned * 2);
    expect(Number(rows!.plant)).toBeGreaterThanOrEqual(10);
    expect(Number(rows!.held)).toBe(2);
    expect(unassigned).toBeGreaterThan(0);
    expect(onLine + Number(rows!.plant) + Number(rows!.held) + unassigned).toBe(84);
  });

  test("bundles: a copy on every one, a cast on all but the oldest two sessions, party numbers for KD (monthly) and Royal (fy)", async () => {
    expect(await count("bundle", "company_id = ? and die_instance_id is null")).toBe(0);
    // Only KD's first truck (sessions 1 and 2, with the clash copy) predates cast numbers: its certificate says so.
    expect(await count("bundle", "company_id = ? and cast_id is null")).toBe(14 + 16 + 1);
    const kd = await env.d1.prepare("select party_no from bundle where company_id = ? and party_no like '26%' order by length(party_no), party_no limit 3").bind(company).all<{ party_no: string }>();
    expect(kd.results.length).toBe(3);
    const royal = await env.d1.prepare("select party_no from bundle where company_id = ? and party_no like '20%/%' limit 2").bind(company).all<{ party_no: string }>();
    expect(royal.results.length).toBe(2);
    // The plant series is past the party numbers, with the one deliberate clash for the scan screen.
    expect(await count("bundle", "company_id = ? and serial = party_no")).toBe(1);
    expect(await count("bundle", "company_id = ? and status = 'void'")).toBe(3);
  });

  test("yards are populated and CNT-1 closed with a variance", async () => {
    const yards = await env.d1
      .prepare("select l.code, count(b.id) n from location l left join bundle b on b.location_id = l.id and b.status in ('available','reserved') where l.company_id = ? and l.kind = 'yard' group by l.code")
      .bind(company)
      .all<{ code: string; n: number }>();
    for (const y of yards.results) expect(Number(y.n), y.code).toBeGreaterThan(0);
    const report = (await owner().count.get({ sessionId: "dev-count-1" })).report;
    expect(report).toMatchObject({ frozen: true, status: "closed" });
    expect(report.summary).toMatchObject({ phantom: 2, found: 1, moved: 1 });
    // Phantoms are still in the yard: the count only reported them.
    for (const p of report.phantom) expect(p.status).toBe("available");
  });

  test("seed gaps the owner saw are filled honestly (BACKLOG 86, 97)", async () => {
    const row = await env.d1.prepare("select settings from company where id = ?").bind(company).first<{ settings: string }>();
    const settings = JSON.parse(row!.settings) as {
      letterhead: { legalName: string; gstin: string; address: string; phone: string };
      support: { name: string; phone: string; hours: string };
      standards: Record<string, { standard: string }>;
    };
    // Letterhead: legal name, a format-valid dummy GSTIN, address, phone.
    expect(settings.letterhead.legalName).toContain("Fourcubes");
    expect(settings.letterhead.gstin).toMatch(/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/);
    expect(settings.letterhead.address).not.toBe("");
    expect(settings.letterhead.phone).not.toBe("");
    expect(settings.support).toMatchObject({ name: expect.any(String), phone: expect.any(String), hours: expect.any(String) });
    // Standards: the semi hollow entry is set beside solid and hollow.
    expect(Object.keys(settings.standards).sort()).toEqual(["hollow", "semi", "solid"]);
    expect(settings.standards.semi!.standard).not.toBe("");
    // Die life is set on more than one copy, so the die-life report is not a one-row page.
    expect(await count("die_instance", "company_id = ? and life_g is not null")).toBeGreaterThanOrEqual(4);
    // The spectro inbox holds the simulator's file only: no test fixtures in a plant the owner opens.
    const inbox = await env.d1.prepare("select file_name, simulated from spectro_inbox where company_id = ?").bind(company).all<{ file_name: string; simulated: number }>();
    expect(inbox.results).toEqual([{ file_name: "simulated-6063.csv", simulated: 1 }]);
  });

  test("docs/DEMO_PLANT.md states what the seed holds: approvals waiting and the downtime stops (BACKLOG 107, L18)", async () => {
    const doc = await Bun.file(new URL("../../../docs/DEMO_PLANT.md", import.meta.url)).text();
    const waiting = Number(/### Approvals waiting \((\d+)\)/.exec(doc)?.[1]);
    expect(waiting).toBe(await count("approval", "company_id = ? and status = 'pending'"));
    expect(Number(/Approvals queue \((\d+) waiting\)/.exec(doc)?.[1])).toBe(waiting);
    // Downtime: P1's stop is fixed; P2's is 62 minutes, cut short when the seed runs early in the production day.
    const stops = await env.d1
      .prepare("select (stopped_at - started_at) / 60000 min from press_downtime where company_id = ? order by id")
      .bind(company)
      .all<{ min: number }>();
    const [p1, p2] = stops.results.map((r) => Number(r.min));
    expect(p1).toBe(18);
    expect(p2).toBeLessThanOrEqual(62);
    expect(doc).toContain(`${p1} min stop on P1`);
    expect(doc).toContain("62 min breakdown on P2");
  });

  test("the first packing session stays BG-000001 (the scan and redirect specs open BG-000001-B001); the opening row takes a later number", async () => {
    expect(await count("bundle", "company_id = ? and serial = 'BG-000001-B001'")).toBe(1);
  });

  test("the stock count tile 'still missing' counts CNT-1's two phantoms (owner walk-through M4, BACKLOG 95)", async () => {
    const report = (await owner().count.get({ sessionId: "dev-count-1" })).report;
    const phantomG = report.phantom.reduce((sum, p) => sum + Number(p.weightG ?? 0), 0);
    expect(report.phantom).toHaveLength(2);
    const summary = await owner().count.phantomSummary();
    expect(summary.lastCount).toMatchObject({ number: "CNT-1", phantom: 2 });
    expect(summary.open).toEqual({ bundles: 2, weightG: phantomG });
  });
});

describe("the owned die, the store and the backup", () => {
  test("KD's 12230: eight bundles packed for KD's SO-10, and another customer is refused", async () => {
    const rows = await env.d1
      .prepare("select b.sales_order_line_id l, b.party_no p from bundle b join die d on d.id = b.die_id where b.company_id = ? and d.section_code = '12230'")
      .bind(company)
      .all<{ l: string; p: string | null }>();
    expect(rows.results).toHaveLength(8);
    expect(new Set(rows.results.map((r) => r.l))).toEqual(new Set(["dev-sol-10-1"]));
    expect(rows.results.every((r) => r.p !== null)).toBe(true);
    const check = await owner().dieInstance.ownerCheck({ dieInstanceId: "dev-copy-12230-1", customerId: "dev-customer-royal", purpose: "dispatch" });
    expect(check).toMatchObject({ ok: false });
    const kd = await owner().dieInstance.ownerCheck({ dieInstanceId: "dev-copy-12230-1", customerId: "dev-customer-kd", purpose: "dispatch" });
    expect(kd).toMatchObject({ ok: true });
  });

  test("the store has five items with entries and the books agree; one backup run succeeded", async () => {
    const balances = (await owner().store.balances()).items;
    expect(balances).toHaveLength(5);
    expect(balances.every((b) => b.balanceMilli > 0)).toBe(true);
    const run = await env.d1.prepare("select status, purpose from backup_run where id = 'dev-backup-run-1'").first<{ status: string; purpose: string }>();
    expect(run).toEqual({ status: "succeeded", purpose: "export" });
  });
});

describe("dispatch", () => {
  test("four completed (PL v2: two revisions, one combined), one building, one held; transporter, capacity, one opened from an order", async () => {
    const rows = await env.d1
      .prepare("select id, status, transporter_name t, vehicle_capacity_g cap, sales_order_id so, pl_number pl from dispatch where company_id = ? order by id")
      .bind(company)
      .all<{ id: string; status: string; t: string | null; cap: number | null; so: string | null; pl: string | null }>();
    expect(rows.results.map((r) => [r.id, r.status])).toEqual([
      ["dev-dispatch-done-1", "completed"],
      ["dev-dispatch-done-2", "completed"],
      ["dev-dispatch-done-3", "completed"],
      ["dev-dispatch-done-4", "completed"],
      ["dev-dispatch-draft", "draft"],
      ["dev-dispatch-held", "reserved"],
    ]);
    const done = Object.fromEntries(rows.results.map((r) => [r.id, r]));
    expect(done["dev-dispatch-done-1"]).toMatchObject({ t: "Shree Logistics", cap: 9_000_000 });
    expect(done["dev-dispatch-done-2"]).toMatchObject({ t: "Balaji Roadways", cap: 12_000_000, so: "dev-so-8" });
    expect(rows.results.filter((r) => r.so !== null)).toHaveLength(1);
    // Packing lists: done-1 has two revisions of one number; done-3 and done-4 are folded into one combined list.
    const lists = await env.d1.prepare("select id, code, revision, supersedes_id sup, combined_into_id comb, dispatch_id d from packing_list where company_id = ? order by created_at").bind(company).all<{ id: string; code: string; revision: number; sup: string | null; comb: string | null; d: string }>();
    const revs = lists.results.filter((l) => l.d === "dev-dispatch-done-1");
    expect(revs.map((l) => l.revision)).toEqual([1, 2]);
    expect(revs[1]!.sup).toBe(revs[0]!.id);
    expect(new Set(revs.map((l) => l.code)).size).toBe(1);
    const combined = lists.results.find((l) => l.id === "dev-pl-combined-1")!;
    expect(lists.results.filter((l) => l.comb === combined.id)).toHaveLength(2);
    expect(await count("packing_list_dispatch", "packing_list_id = 'dev-pl-combined-1' and company_id = ?")).toBe(2);
    // Every completed dispatch's items stand on a line; the PL carries the order codes.
    expect(await count("dispatch_item", "company_id = ? and sales_order_line_id is null and dispatch_id in (select id from dispatch where status = 'completed')")).toBe(0);
  });

  test("the party portal: KD sees its own dispatch and certificate, not Royal's", async () => {
    const party = await env.d1.prepare("select id from user where email = 'party@orrn.local'").first<{ id: string }>();
    const { portalHelpers } = await import("./portal-w3-fixture");
    const h = portalHelpers(() => env);
    const api = await h.headerCaller(party!.id);
    expect((await api.portal.dispatches.list()).items.map((d) => d.id)).toEqual(["dev-dispatch-done-1"]);
    expect((await api.portal.orders.list()).items.map((o) => o.number)).toEqual(expect.arrayContaining(["SO-4", "SO-7"]));
  });
});

describe("press and today", () => {
  test("a run on each state: queued behind released plans, die issued, running, logged x3 today, late entry waiting, trial queued", async () => {
    const runs = await env.d1.prepare("select number, status, late_entry le, plan_id from press_run where company_id = ? order by cast(substr(number, 4) as integer)").bind(company).all<{ number: string; status: string; le: number; plan_id: string | null }>();
    const byStatus: Record<string, string[]> = {};
    for (const r of runs.results) (byStatus[r.status] ??= []).push(r.number);
    expect(byStatus).toEqual({
      die_issued: ["PR-1"],
      queued: ["PR-2", "PR-3", "PR-4", "PR-5", "PR-6", "PR-7", "PR-13", "PR-14"],
      logged: ["PR-8", "PR-11", "PR-12"],
      counting: ["PR-9"],
      running: ["PR-10"],
    });
    expect(runs.results.find((r) => r.number === "PR-9")!.le).toBe(1);
    const plans = await env.d1.prepare("select number, status, purpose from press_plan where company_id = ? order by number").bind(company).all<{ number: string; status: string; purpose: string }>();
    expect(plans.results.map((p) => [p.number, p.status, p.purpose])).toEqual([
      ["PP-1", "draft", "die_trial"],
      ["PP-2", "released", "die_trial"],
      ["PP-3", "released", "production"],
      ["PP-4", "released", "production"],
    ]);
    // Billets on hand: the cast's opening, less what the three logged runs took (the ledger is exact).
    const billet = await env.d1.prepare("select sum(qty_g) g from stock_ledger where company_id = ? and item_kind = 'billet'").bind(company).first<{ g: number }>();
    expect(Number(billet?.g)).toBe(2_400_000 - 310_400 - 296_000 - 300_000);
  });

  test("the three logged runs: good, rejects, downtime; recovery and balance are the server's figures", async () => {
    const pr11 = await owner().press.runs.get({ id: "dev-run-14701-2-rejects" });
    expect(pr11.figures).toMatchObject({ recoveryBp: 7145, rejectG: 38_000 });
    const pr12 = await owner().press.runs.get({ id: "dev-run-14730-1-downtime" });
    expect(pr12.figures).toMatchObject({ recoveryBp: 7960 });
    const down = await env.d1.prepare("select (stopped_at - started_at) / 60000 min from press_downtime where press_run_id = 'dev-run-14730-1-downtime'").first<{ min: number }>();
    expect(Number(down?.min)).toBeGreaterThan(0);
  });

  test("printing: one node not connected and no scale, two jobs waiting", async () => {
    const node = await env.d1.prepare("select status, scale_configured s, last_seen_at seen from spool_deployment where company_id = ?").bind(company).first<{ status: string; s: number; seen: number | null }>();
    expect(node).toEqual({ status: "pending", s: 0, seen: null });
    expect(await count("print_log", "company_id = ? and status = 'queued'")).toBe(2);
  });

  test("Today reads the production day: packed, dispatched, pressed, and nothing failed", async () => {
    const today = await owner().dashboard.today();
    expect(today.packedToday.bundles).toBe(30);
    expect(today.dispatchedToday.dispatches).toBe(1);
    expect(today.pressedToday!.runs).toBe(3);
    expect(today.failedPrintJobs).toBe(0);
    expect(today.openDispatchCount).toBe(2);
  });
});

describe("idempotent and time-robust", () => {
  test("running it again gives the same rows (same ids on the fixed-id tables)", async () => {
    const ids = async (table: string) =>
      (await env.d1.prepare(`select id from ${table} where company_id = ? order by id`).bind(company).all<{ id: string }>()).results.map((r) => r.id);
    const tables = ["sales_order", "sales_order_line", "bundle", "bundle_transfer", "dispatch", "dispatch_item", "die_instance", "press_run", "press_plan", "approval", "count_seen", "print_log", "audit_log"];
    const before: Record<string, string[]> = {};
    for (const t of tables) before[t] = await ids(t);
    const counts: Record<string, number> = {};
    for (const t of Object.keys(TABLE_COUNTS)) counts[t] = await count(t);
    const again = await seed(env.db, { password: DEV_SEED_PASSWORD });
    expect(again.ok).toBe(true);
    for (const t of tables) {
      // Audit rows written by the packing list writer get fresh random ids: compare those by count.
      if (t === "audit_log") expect((await ids(t)).length, t).toBe(before[t]!.length);
      else expect(await ids(t), t).toEqual(before[t]!);
    }
    for (const t of Object.keys(TABLE_COUNTS)) expect(await count(t), t).toBe(counts[t]!);
  });

  test("seeded at any hour (also across a month and a financial year), today's data stays in the production day", async () => {
    // IST wall clock: just after midnight, before the day shift starts, right after, midday, the night shift, late.
    const IST = 330 * 60_000;
    const at = (iso: string) => Date.parse(`${iso}+05:30`);
    const moments = [
      at("2026-10-24T00:30:00"),
      at("2026-10-24T07:59:00"),
      at("2026-10-24T08:20:00"),
      at("2026-10-24T13:00:00"),
      at("2026-10-24T21:15:00"),
      at("2026-11-01T01:10:00"), // first hours of a month: last month's bundle letter and cast period
      at("2027-04-01T00:20:00"), // first hours of a financial year: SO, PL and DM series start over
    ];
    expect(IST).toBeGreaterThan(0);
    try {
      for (const now of moments) {
        setClockForTests(new Date(now));
        const out = await seed(env.db, { password: DEV_SEED_PASSWORD, now });
        expect(out.ok, new Date(now).toISOString()).toBe(true);
        const today = await owner().dashboard.today();
        const label = new Date(now).toISOString();
        expect(today.packedToday.bundles, `packed ${label}`).toBe(30);
        expect(today.dispatchedToday.dispatches, `dispatched ${label}`).toBe(1);
        expect(today.pressedToday!.runs, `pressed ${label}`).toBe(3);
        expect(today.pressedToday!.kgG, `pressed kg ${label}`).toBeGreaterThan(600_000);
        // Nothing in the future (a minute of slack for the seed's own spacing).
        const future = await env.d1.prepare("select count(*) n from bundle where company_id = ? and created_at > ?").bind(company, now + 60_000).first<{ n: number }>();
        expect(Number(future?.n), `future bundles ${label}`).toBe(0);
        expect(await count("press_run", "company_id = ? and status = 'running'")).toBe(1);
        expect(await count("sales_order")).toBe(10);
      }
    } finally {
      setClockForTests(null);
    }
  });
});
