/**
 * FP Wave 1 shared contracts: migration 0023 (tables, the oblique note move), new document
 * series and party bundle numbers, the die ownership gate, platform actions.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Miniflare } from "miniflare";

import { approval, die, dieInstance, docSeries } from "@orrn/db/schema";
import { and, eq } from "drizzle-orm";

import { can, type Action } from "../src/lib/permissions";
import { createTestEnv, type TestEnv } from "./harness";

let env: TestEnv;
type DocNumbers = typeof import("../src/lib/docNumber");
type DieOwner = typeof import("../src/lib/dieOwner");
let dn: DocNumbers;
let owner: DieOwner;

beforeAll(async () => {
  env = await createTestEnv();
  dn = await import("../src/lib/docNumber");
  owner = await import("../src/lib/dieOwner");
});

afterAll(async () => {
  await env.dispose();
});

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../db/src/migrations");
const ist = (iso: string) => new Date(`${iso}+05:30`);

const WAVE1_TABLES = [
  "die_band",
  "die_file",
  "die_maker",
  "die_maker_job",
  "die_issue",
  "reason_code",
  "press_line",
  "press_plan",
  "press_plan_die",
  "press_plan_line",
  "press_run",
  "bundle_transfer",
  "pack_reject",
  "transporter",
  "packing_list_dispatch",
  "app_release",
  "backup_run",
  "support_request",
];

describe("migration 0023_fp_wave1", () => {
  test("is migration 23 (later waves append after it) and creates every Wave 1 table", async () => {
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
    expect(files[23]).toBe("0023_fp_wave1.sql");
    expect(files.slice(24).every((f) => f > "0023_fp_wave1.sql")).toBe(true);
    const rows = (await env.db.all<{ name: string }>(
      // biome-ignore lint: raw sqlite_master read
      (await import("drizzle-orm")).sql`select name from sqlite_master where type = 'table'`,
    )) as { name: string }[];
    const names = new Set(rows.map((r) => r.name));
    for (const t of WAVE1_TABLES) expect({ t, exists: names.has(t) }).toEqual({ t, exists: true });
  });

  test("oblique_mm is gone and a stored value moves into the die note (D7)", async () => {
    const mf = new Miniflare({ modules: true, script: "export default { fetch() { return new Response('ok'); } }", d1Databases: ["DB"] });
    try {
      const d1 = await mf.getD1Database("DB");
      const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
      const apply = async (file: string) => {
        const statements = readFileSync(join(MIGRATIONS_DIR, file), "utf8")
          .split("--> statement-breakpoint")
          .map((s) => s.trim())
          .filter(Boolean);
        await d1.batch(statements.map((s) => d1.prepare(s)));
      };
      for (const f of files.filter((f) => f < "0023")) await apply(f);
      await d1.prepare("insert into company (id, name, slug) values ('c1', 'C', 'c1')").run();
      const ins = "insert into die (id, company_id, series, section_code, weight_min_g, weight_max_g, oblique_mm, notes) values (?, 'c1', 'S', ?, 1, 2, ?, ?)";
      await d1.batch([
        d1.prepare(ins).bind("d1", "A", 38, null),
        d1.prepare(ins).bind("d2", "B", 12, "Old note"),
        d1.prepare(ins).bind("d3", "C", null, "Keep"),
      ]);
      await apply("0023_fp_wave1.sql");
      const { results } = await d1.prepare("select id, notes from die order by id").all<{ id: string; notes: string | null }>();
      expect(results).toEqual([
        { id: "d1", notes: "Oblique (legacy): 38 mm" },
        { id: "d2", notes: "Old note\nOblique (legacy): 12 mm" },
        { id: "d3", notes: "Keep" },
      ]);
      const cols = await d1.prepare("select name from pragma_table_info('die')").all<{ name: string }>();
      expect(cols.results.map((c) => c.name)).not.toContain("oblique_mm");
    } finally {
      await mf.dispose();
    }
  });
});

describe("Wave 1 document series", () => {
  test("press plan, ageing, die maker job, certificate", async () => {
    const { companyId } = await env.seedCompany();
    const at = ist("2026-10-24T10:00:00");
    expect(await dn.nextDocNumber(env.db, companyId, "press_plan", at)).toEqual({ seq: 1, number: "PP-1", period: "2026-27" });
    expect((await dn.nextDocNumber(env.db, companyId, "press_plan", at)).number).toBe("PP-2");
    expect((await dn.nextDocNumber(env.db, companyId, "ageing", at)).number).toBe("AG-1");
    expect((await dn.nextDocNumber(env.db, companyId, "die_maker_job", at)).number).toBe("DM-1");
    expect((await dn.nextDocNumber(env.db, companyId, "cert", at)).number).toBe("TC/2026-27/1");
    // FY rollover on 1 April IST
    expect((await dn.nextDocNumber(env.db, companyId, "press_plan", ist("2027-04-01T00:00:00"))).number).toBe("PP-1");
  });

  test("party_bundle only through allocatePartyBundleNumbers", async () => {
    const { companyId } = await env.seedCompany();
    await expect(dn.nextDocNumber(env.db, companyId, "party_bundle", new Date())).rejects.toThrow();
  });
});

describe("party bundle numbers (FP-PK-07)", () => {
  test("monthly: per customer, resets on 1 Nov IST; company series untouched", async () => {
    const { companyId } = await env.seedCompany();
    const a = await env.seedCustomer(companyId);
    const b = await env.seedCustomer(companyId);
    const oct = await dn.allocatePartyBundleNumbers(env.db, companyId, a, "monthly", ist("2026-10-31T23:59:00"), 3);
    expect(oct).toEqual({ period: "2026-10", seqs: [1, 2, 3], numbers: ["26J1", "26J2", "26J3"] });
    expect((await dn.allocatePartyBundleNumbers(env.db, companyId, b, "monthly", ist("2026-10-31T23:59:00"), 1)).numbers).toEqual(["26J1"]);
    // 31 Oct 18:30 UTC = 1 Nov 00:00 IST
    expect((await dn.allocatePartyBundleNumbers(env.db, companyId, a, "monthly", new Date("2026-10-31T18:30:00Z"), 1)).numbers).toEqual(["26K1"]);
    expect((await dn.nextDocNumber(env.db, companyId, "bundle", ist("2026-10-31T10:00:00"))).number).toBe("26J1");
    const rows = await env.db.select().from(docSeries).where(and(eq(docSeries.companyId, companyId), eq(docSeries.docType, "party_bundle")));
    expect(rows.map((r) => `${r.scope === a ? "a" : "b"}:${r.period}:${r.value}`).sort()).toEqual(["a:2026-10:3", "a:2026-11:1", "b:2026-10:1"]);
  });

  test("fy resets 1 April; lifelong never resets", async () => {
    const { companyId } = await env.seedCompany();
    const c = await env.seedCustomer(companyId);
    expect((await dn.allocatePartyBundleNumbers(env.db, companyId, c, "fy", ist("2027-03-31T23:00:00"), 2)).numbers).toEqual(["2026-27/1", "2026-27/2"]);
    expect((await dn.allocatePartyBundleNumbers(env.db, companyId, c, "fy", ist("2027-04-01T00:00:00"), 1)).numbers).toEqual(["2027-28/1"]);
    const d = await env.seedCustomer(companyId);
    expect((await dn.allocatePartyBundleNumbers(env.db, companyId, d, "lifelong", ist("2026-10-01T09:00:00"), 2)).numbers).toEqual(["1", "2"]);
    expect((await dn.allocatePartyBundleNumbers(env.db, companyId, d, "lifelong", ist("2031-01-01T09:00:00"), 1)).numbers).toEqual(["3"]);
  });

  test("20 concurrent allocations for one customer are distinct and gapless", async () => {
    const { companyId } = await env.seedCompany();
    const c = await env.seedCustomer(companyId);
    const at = ist("2026-10-24T10:00:00");
    const out = await Promise.all(Array.from({ length: 20 }, () => dn.allocatePartyBundleNumbers(env.db, companyId, c, "monthly", at, 1)));
    expect(out.map((o) => o.seqs[0]).sort((x, y) => x! - y!)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });
});

describe("assertDieAllowed (FP-DR-13, C2)", () => {
  async function setup() {
    const { companyId, users } = await env.seedCompany();
    const ownerCust = await env.seedCustomer(companyId);
    const other = await env.seedCustomer(companyId);
    const plantDie = await env.seedDie(companyId);
    const ownedDie = await env.seedDie(companyId, { ownerCustomerId: ownerCust });
    const emptyOwnedDie = await env.seedDie(companyId, { ownerCustomerId: ownerCust });
    const copyId = crypto.randomUUID();
    await env.db.insert(dieInstance).values({ id: copyId, companyId, sectionId: ownedDie, seqNo: 1, code: "X-1" });
    return { companyId, users, ownerCust, other, plantDie, ownedDie, emptyOwnedDie, copyId };
  }

  test("plant die passes for anyone, plant stock included", async () => {
    const s = await setup();
    await expect(owner.assertDieAllowed(env.db, s.companyId, { dieId: s.plantDie, customerId: s.other, purpose: "pack" })).resolves.toMatchObject({ ok: true });
    await expect(owner.assertDieAllowed(env.db, s.companyId, { dieId: s.plantDie, customerId: null, purpose: "pack" })).resolves.toMatchObject({ ok: true });
  });

  test("owned section: no copy picked / no copies", async () => {
    const s = await setup();
    await expect(owner.assertDieAllowed(env.db, s.companyId, { dieId: s.ownedDie, customerId: s.ownerCust, purpose: "plan" })).rejects.toMatchObject({ code: "BAD_REQUEST", message: "Pick the die copy" });
    await expect(owner.assertDieAllowed(env.db, s.companyId, { dieId: s.emptyOwnedDie, customerId: s.ownerCust, purpose: "plan" })).rejects.toMatchObject({ code: "BAD_REQUEST", message: "This section has no copies" });
  });

  test("owner passes; another customer and plant stock are refused with the owner's name", async () => {
    const s = await setup();
    await expect(owner.assertDieAllowed(env.db, s.companyId, { dieInstanceId: s.copyId, customerId: s.ownerCust, purpose: "press" })).resolves.toMatchObject({ ok: true, viaGrant: false });
    const check = await owner.checkDieAllowed(env.db, s.companyId, { dieInstanceId: s.copyId, customerId: s.other, purpose: "pack" });
    expect(check).toMatchObject({ ok: false, block: "owned", ownerCustomerId: s.ownerCust });
    await expect(owner.assertDieAllowed(env.db, s.companyId, { dieInstanceId: s.copyId, customerId: s.other, purpose: "pack" })).rejects.toMatchObject({ code: "FORBIDDEN", message: `This die belongs to ${check.ownerName}` });
    await expect(owner.assertDieAllowed(env.db, s.companyId, { dieInstanceId: s.copyId, customerId: null, purpose: "pack" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  test("an approved, open override for this copy and customer lets it through; closed or other customer does not", async () => {
    const s = await setup();
    const grant = crypto.randomUUID();
    await env.db.insert(approval).values({
      id: grant,
      companyId: s.companyId,
      kind: "die_owner_override",
      subjectId: s.copyId,
      status: "approved",
      requestedBy: s.users.supervisor.id,
      meta: { attemptedCustomerId: s.other, purpose: "pack", closedAt: null },
    });
    await expect(owner.assertDieAllowed(env.db, s.companyId, { dieInstanceId: s.copyId, customerId: s.other, purpose: "pack" })).resolves.toMatchObject({ ok: true, viaGrant: true, grantId: grant });
    const third = await env.seedCustomer(s.companyId);
    await expect(owner.assertDieAllowed(env.db, s.companyId, { dieInstanceId: s.copyId, customerId: third, purpose: "pack" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await env.db.update(approval).set({ meta: { attemptedCustomerId: s.other, purpose: "pack", closedAt: Date.now() } }).where(eq(approval.id, grant));
    await expect(owner.assertDieAllowed(env.db, s.companyId, { dieInstanceId: s.copyId, customerId: s.other, purpose: "pack" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  test("tenant isolation: another company's copy or die is not found", async () => {
    const s = await setup();
    const { companyId: otherCo } = await env.seedCompany();
    await expect(owner.assertDieAllowed(env.db, otherCo, { dieInstanceId: s.copyId, customerId: null, purpose: "pack" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(owner.assertDieAllowed(env.db, otherCo, { dieId: s.plantDie, customerId: null, purpose: "pack" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("a copy that is not of the named die is refused", async () => {
    const s = await setup();
    await expect(owner.assertDieAllowed(env.db, s.companyId, { dieId: s.plantDie, dieInstanceId: s.copyId, customerId: s.ownerCust, purpose: "pack" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("platform actions (Wave 1)", () => {
  const staff = (platformRole: "super_admin" | "admin" | "support") => ({ company: null, isPlatformAdmin: true, platformRole });
  const cases: [Action, ("super_admin" | "admin" | "support")[]][] = [
    ["platform.release.publish", ["super_admin", "admin"]],
    ["platform.backup.run", ["super_admin", "admin"]],
    ["platform.support.reply", ["super_admin", "admin", "support"]],
  ];
  for (const [action, roles] of cases) {
    test(action, () => {
      for (const role of ["super_admin", "admin", "support"] as const) {
        expect({ role, ok: can(staff(role), action) }).toEqual({ role, ok: roles.includes(role) });
      }
      expect(can({ company: { role: "owner" }, isPlatformAdmin: false }, action)).toBe(false);
    });
  }
});

describe("dev seed: Wave 1 masters (idempotent)", () => {
  test("shifts, standards, all modules, press line, transporter and reason codes survive a re-seed", async () => {
    const { user, company, pressLine, reasonCode, transporter, dieInstance: copies, dieBand } = await import("@orrn/db/schema");
    const { defaultReasonCodeRows, COMPANY_MODULES, readFloorSettings } = await import("@orrn/domain");
    for (const key of ["owner", "operator", "viewer", "office", "staff"]) {
      await env.db.insert(user).values({ id: `dev-user-${key}`, name: key, email: `${key}@orrn.local` }).onConflictDoNothing();
    }
    const seedPath = "../../../apps/server/src/dev-seed";
    const { seedDevData } = (await import(seedPath)) as {
      seedDevData: (db: TestEnv["db"], opts: { password: string }) => Promise<{ ok: boolean }>;
    };
    const companyId = "dev-company-orrn";
    expect((await seedDevData(env.db, { password: "dev-seed-test" })).ok).toBe(true);

    // App rows made between seeds (a die copy with a band) must not block the reset.
    const [someDie] = await env.db.select({ id: die.id }).from(die).where(eq(die.companyId, companyId)).limit(1);
    const bandId = crypto.randomUUID();
    await env.db.insert(dieBand).values({ id: bandId, companyId, sectionId: someDie!.id, wallTenthMm: 12, weightMinG: 1, weightMaxG: 2 });
    await env.db.insert(copies).values({ id: crypto.randomUUID(), companyId, sectionId: someDie!.id, seqNo: 99, code: "SEED-99", bandId });

    expect((await seedDevData(env.db, { password: "dev-seed-test" })).ok).toBe(true);
    const [co] = await env.db.select().from(company).where(eq(company.id, companyId));
    const floor = readFloorSettings(co!.settings);
    expect(floor.shifts.map((s) => [s.name, s.seq, s.startMin, s.endMin])).toEqual([
      ["Day", 1, 480, 1200],
      ["Night", 2, 1200, 480],
    ]);
    expect(floor.standards).toEqual({ solid: { standard: "IS 733", cml: "" }, hollow: { standard: "IS 1285", cml: "" } });
    expect(co!.modules).toEqual([...COMPANY_MODULES]);
    expect(await env.db.select({ code: pressLine.code }).from(pressLine).where(eq(pressLine.companyId, companyId))).toEqual([{ code: "P1" }]);
    expect(await env.db.select().from(transporter).where(eq(transporter.companyId, companyId))).toHaveLength(1);
    expect(await env.db.select().from(reasonCode).where(eq(reasonCode.companyId, companyId))).toHaveLength(defaultReasonCodeRows().length);
    // The app-made copy is gone; only the die room demo copies (W1-DR-S) are back.
    const seeded = await env.db.select({ code: copies.code }).from(copies).where(eq(copies.companyId, companyId));
    expect(seeded.map((c) => c.code)).not.toContain("SEED-99");
    expect(seeded).toHaveLength(5);
  });
});
