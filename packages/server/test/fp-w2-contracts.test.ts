/**
 * FP Wave 2 shared contracts (press + foundry): migration 0028 (tables, columns, the melt rebuild
 * and its guard), partial uniques, actions and approver roles, the cast series start, settings
 * and the dev seed's Wave 2 masters.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Miniflare } from "miniflare";

import { cast, die, melt, pressDowntime, pressLine, pressRun, reasonCode } from "@orrn/db/schema";
import { eq, sql } from "drizzle-orm";

import { APPROVER_ROLES, can, canApprove, type Action } from "../src/lib/permissions";
import { createTestEnv, type TestEnv } from "./harness";

let env: TestEnv;
type DocNumbers = typeof import("../src/lib/docNumber");
let dn: DocNumbers;

beforeAll(async () => {
  env = await createTestEnv();
  dn = await import("../src/lib/docNumber");
});

afterAll(async () => {
  await env.dispose();
});

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../db/src/migrations");
const ist = (iso: string) => new Date(`${iso}+05:30`);
/** Drizzle builders are thenables, not promises: run one so `expect().rejects` sees its error. */
const q = async <T>(query: PromiseLike<T>): Promise<T> => await query;

const WAVE2_TABLES = ["press_run_line", "press_billet_use", "qc_entry", "press_downtime", "press_remark", "die_remark", "furnace", "alloy", "alloy_limit"];

async function columnsOf(table: string): Promise<{ name: string; notnull: number }[]> {
  return (await env.db.all(sql.raw(`select name, "notnull" from pragma_table_info('${table}')`))) as { name: string; notnull: number }[];
}

describe("migration 0028_fp_wave2", () => {
  test("is migration 28 and creates every Wave 2 table", async () => {
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
    expect(files[27]).toBe("0027_order_hold.sql");
    expect(files[28]).toBe("0028_fp_wave2.sql");
    const rows = (await env.db.all(sql`select name from sqlite_master where type = 'table'`)) as { name: string }[];
    const names = new Set(rows.map((r) => r.name));
    for (const t of WAVE2_TABLES) expect({ t, exists: names.has(t) }).toEqual({ t, exists: true });
    expect(names.has("__w2_melt_guard")).toBe(false);
    expect(names.has("__new_melt")).toBe(false);
  });

  test("new columns on existing tables", async () => {
    const want: Record<string, string[]> = {
      press_run: ["late_entry", "late_entry_approval_id", "client_mutation_id", "queue_pos", "trial_result"],
      press_plan: ["purpose"],
      die_instance: ["maker_die_no", "maker_project_no"],
      cast: ["alloy_id", "cancelled_at", "cancelled_by", "cancel_reason"],
      melt: ["status", "furnace_id", "alloy_id", "yield_bp", "spectro_reason", "locked_at", "locked_by"],
      spectro_result: ["si_ppm", "fe_ppm", "cu_ppm", "mn_ppm", "mg_ppm", "zn_ppm", "ti_ppm", "cr_ppm", "al_ppm", "al_source", "verdict", "limits_snapshot", "file_key", "voided_at"],
    };
    for (const [table, cols] of Object.entries(want)) {
      const have = new Set((await columnsOf(table)).map((c) => c.name));
      expect({ table, missing: cols.filter((c) => !have.has(c)) }).toEqual({ table, missing: [] });
    }
  });

  test("a draft melt may leave its times and dips empty; figures default to 0; status defaults to locked", async () => {
    const cols = new Map((await columnsOf("melt")).map((c) => [c.name, c.notnull]));
    for (const c of ["preheat_start_at", "charging_start_at", "charging_end_at", "casting_start_at", "casting_end_at", "ldo_start_tenth_in", "ldo_end_tenth_in"]) {
      expect({ c, notnull: cols.get(c) }).toEqual({ c, notnull: 0 });
    }
    const { companyId } = await env.seedCompany();
    const castId = crypto.randomUUID();
    await env.db.insert(cast).values({ id: castId, companyId, number: "K1", period: "2026-11", year: 2026, month: 11, seq: 1, alloy: "6063", openedAt: new Date() });
    const draftId = crypto.randomUUID();
    await env.db.insert(melt).values({ id: draftId, companyId, castId, seq: 1, alloy: "6063", status: "draft" });
    const [row] = await env.db.select().from(melt).where(eq(melt.id, draftId));
    expect(row).toMatchObject({ status: "draft", chargingStartAt: null, castingEndAt: null, inputG: 0, logsG: 0, lossBp: 0, yieldBp: null });
    const plId = crypto.randomUUID();
    await env.db.insert(melt).values({ id: plId, companyId, castId, seq: 2, alloy: "6063" });
    expect((await env.db.select({ s: melt.status }).from(melt).where(eq(melt.id, plId)))[0]!.s).toBe("locked");
  });

  test("the melt rebuild refuses to run over existing melts instead of cascading their lines away", async () => {
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
      for (const f of files.filter((f) => f < "0028")) await apply(f);
      await d1.prepare("insert into company (id, name, slug) values ('c1', 'C', 'c1')").run();
      await d1
        .prepare("insert into `cast` (id, company_id, number, period, year, month, seq, alloy, opened_at) values ('k1', 'c1', 'K1', '2026-11', 2026, 11, 1, '6063', 1)")
        .run();
      await d1
        .prepare(
          "insert into melt (id, company_id, cast_id, seq, alloy, preheat_start_at, charging_start_at, charging_end_at, casting_start_at, casting_end_at, ldo_start_tenth_in, ldo_end_tenth_in, input_g, logs_pcs, logs_length_mm, logs_g, output_g, loss_g, loss_bp, allowed_burn_g) values ('m1', 'c1', 'k1', 1, '6063', 1, 2, 3, 4, 5, 10, 9, 1000, 1, 1, 900, 950, 50, 500, 30)",
        )
        .run();
      await expect(apply("0028_fp_wave2.sql")).rejects.toThrow(/NOT NULL/);
      // Nothing moved: the melt is still there, no Wave 2 table landed.
      expect((await d1.prepare("select count(*) as n from melt").first<{ n: number }>())!.n).toBe(1);
      expect(await d1.prepare("select name from sqlite_master where name = 'furnace'").first()).toBeNull();
      // An empty melt table migrates.
      await d1.prepare("delete from melt").run();
      await apply("0028_fp_wave2.sql");
      expect(await d1.prepare("select name from sqlite_master where name = 'furnace'").first()).not.toBeNull();
    } finally {
      await mf.dispose();
    }
  });
});

describe("press partial uniques", () => {
  async function pressFixture() {
    const { companyId, users } = await env.seedCompany();
    const sectionId = crypto.randomUUID();
    await env.db.insert(die).values({ id: sectionId, companyId, series: "S", sectionCode: `A${Math.random()}`, weightMinG: 1, weightMaxG: 2 });
    const lineId = crypto.randomUUID();
    await env.db.insert(pressLine).values({ id: lineId, companyId, code: "P1", name: "Press 1" });
    return { companyId, users, sectionId, lineId };
  }
  let n = 0;
  const runRow = (f: { companyId: string; sectionId: string; lineId: string }, status: "running" | "queued") => ({
    id: crypto.randomUUID(),
    companyId: f.companyId,
    number: `PR-${++n}`,
    period: "2026-27",
    status,
    pressLineId: f.lineId,
    sectionId: f.sectionId,
  });

  test("one running run per line", async () => {
    const f = await pressFixture();
    await env.db.insert(pressRun).values(runRow(f, "running"));
    await expect(q(env.db.insert(pressRun).values(runRow(f, "running")))).rejects.toThrow();
    await env.db.insert(pressRun).values(runRow(f, "queued"));
  });

  test("one open downtime per line; a stopped one does not count", async () => {
    const f = await pressFixture();
    const reasonId = crypto.randomUUID();
    await env.db.insert(reasonCode).values({ id: reasonId, companyId: f.companyId, kind: "downtime", code: "power", label: "Power" });
    const dt = (stoppedAt: Date | null) => ({ id: crypto.randomUUID(), companyId: f.companyId, pressLineId: f.lineId, reasonCodeId: reasonId, startedAt: new Date(), stoppedAt });
    await env.db.insert(pressDowntime).values(dt(new Date()));
    await env.db.insert(pressDowntime).values(dt(null));
    await expect(q(env.db.insert(pressDowntime).values(dt(null)))).rejects.toThrow();
  });

  test("a client mutation id is unique per company", async () => {
    const f = await pressFixture();
    await env.db.insert(pressRun).values({ ...runRow(f, "queued"), clientMutationId: "dev-1:42" });
    await expect(q(env.db.insert(pressRun).values({ ...runRow(f, "queued"), clientMutationId: "dev-1:42" }))).rejects.toThrow();
  });
});

describe("Wave 2 actions and approvals", () => {
  const member = (role: string) => ({ company: { role }, isPlatformAdmin: false }) as Parameters<typeof can>[0];
  const ROLES = ["owner", "admin", "manager", "office", "accountant", "supervisor", "packer", "foundry", "press", "storekeeper", "die_room", "operator", "viewer"];
  const matrix: [Action, string[]][] = [
    ["press.run", ["owner", "press", "supervisor"]],
    ["press.close", ["owner", "supervisor", "manager", "admin"]],
    ["press.queue", ["owner", "supervisor", "office", "manager"]],
    ["cast.enter", ["owner", "foundry", "supervisor"]],
    ["cast.close", ["owner", "supervisor", "manager"]],
    ["qc.enter", ["owner", "press", "supervisor"]],
    ["masters.publish", ["owner", "manager", "admin"]],
  ];
  for (const [action, holders] of matrix) {
    test(action, () => {
      for (const role of ROLES) expect({ role, ok: can(member(role), action) }).toEqual({ role, ok: holders.includes(role) });
    });
  }

  test("press_late_entry: owner, supervisor, manager approve; nobody else", () => {
    expect(APPROVER_ROLES.press_late_entry).toEqual(["owner", "supervisor", "manager"]);
    for (const role of ROLES) {
      expect({ role, ok: canApprove(role as never, "press_late_entry") }).toEqual({ role, ok: ["owner", "supervisor", "manager"].includes(role) });
    }
  });

  test("the requester cannot approve their own late entry", async () => {
    const { companyId, users } = await env.seedCompany();
    const { approval } = await import("@orrn/db/schema");
    const id = crypto.randomUUID();
    await env.db.insert(approval).values({ id, companyId, kind: "press_late_entry", subjectId: crypto.randomUUID(), requestedBy: users.supervisor.id });
    await expect(env.caller({ role: "supervisor", companyId }).approval.decide({ id, decision: "approved" })).rejects.toThrow();
    const [row] = await env.db.select({ status: approval.status }).from(approval).where(eq(approval.id, id));
    expect(row!.status).toBe("pending");
  });
});

describe("document series (Wave 2)", () => {
  test("press runs are PR-n per FY", async () => {
    const { companyId } = await env.seedCompany();
    expect(await dn.nextDocNumber(env.db, companyId, "press_run", ist("2026-10-24T10:00:00"))).toEqual({ seq: 1, number: "PR-1", period: "2026-27" });
  });

  test("casts continue the paper book in the castSeriesStart month, then restart at 1", async () => {
    const { companyId } = await env.seedCompany({ settings: { castSeriesStart: { period: "2026-11", start: 32 } } });
    expect(await dn.nextDocNumber(env.db, companyId, "cast", ist("2026-10-31T10:00:00"))).toEqual({ seq: 1, number: "J1", period: "2026-10" });
    expect(await dn.nextDocNumber(env.db, companyId, "cast", ist("2026-11-02T10:00:00"))).toEqual({ seq: 32, number: "K32", period: "2026-11" });
    expect((await dn.nextDocNumber(env.db, companyId, "cast", ist("2026-11-03T10:00:00"))).number).toBe("K33");
    expect((await dn.nextDocNumber(env.db, companyId, "cast", ist("2026-12-01T10:00:00"))).number).toBe("L1");
  });

  test("a company without castSeriesStart starts each month at 1", async () => {
    const { companyId } = await env.seedCompany();
    expect((await dn.nextDocNumber(env.db, companyId, "cast", ist("2026-11-02T10:00:00"))).number).toBe("K1");
  });
});

describe("settings (Wave 2)", () => {
  test("dieRoom.newCopyOnTrial defaults on, is written by settings.update, read back by getSettings", async () => {
    const { companyId } = await env.seedCompany();
    const admin = env.caller({ role: "admin", companyId });
    expect((await admin.company.getSettings()).dieRoom).toEqual({ newCopyOnTrial: true });
    await admin.company.updateSettings({ dieRoom: { newCopyOnTrial: false } });
    expect((await admin.company.getSettings()).dieRoom).toEqual({ newCopyOnTrial: false });
    await expect(env.caller({ role: "office", companyId }).company.updateSettings({ dieRoom: { newCopyOnTrial: true } })).rejects.toThrow();
  });
});

describe("dev seed: Wave 2 masters (idempotent)", () => {
  test("furnace F1, alloys 6063/6061 with limits, return streams, P1 + P2, a draft die-trial plan", async () => {
    const schema = await import("@orrn/db/schema");
    const { user } = schema;
    for (const key of ["owner", "operator", "viewer", "office", "supervisor", "press", "staff"]) {
      await env.db.insert(user).values({ id: `dev-user-${key}`, name: key, email: `${key}@orrn.local` }).onConflictDoNothing();
    }
    const seedPath = "../../../apps/server/src/dev-seed";
    const { seedDevData } = (await import(seedPath)) as {
      seedDevData: (db: TestEnv["db"], opts: { password: string }) => Promise<{ ok: boolean }>;
    };
    const companyId = "dev-company-orrn";
    for (let i = 0; i < 2; i++) {
      expect((await seedDevData(env.db, { password: "dev-seed-test" })).ok).toBe(true);
      const furnaces = await env.db.select().from(schema.furnace).where(eq(schema.furnace.companyId, companyId));
      expect(furnaces.map((f) => [f.code, f.capacityG, f.billetDiaMm])).toEqual([["F1", 6_000_000, 127]]);
      const alloys = await env.db.select({ code: schema.alloy.code }).from(schema.alloy).where(eq(schema.alloy.companyId, companyId));
      expect(alloys.map((a) => a.code).sort()).toEqual(["6061", "6063"]);
      expect(await env.db.select().from(schema.alloyLimit).where(eq(schema.alloyLimit.companyId, companyId))).toHaveLength(16);
      const streams = await env.db.select({ code: schema.returnStream.code }).from(schema.returnStream).where(eq(schema.returnStream.companyId, companyId));
      expect(streams.map((s) => s.code)).toContain("FE");
      expect(streams).toHaveLength(11);
      const lines = await env.db.select({ code: pressLine.code }).from(pressLine).where(eq(pressLine.companyId, companyId));
      expect(lines.map((l) => l.code).sort()).toEqual(["P1", "P2"]);
      const plans = await env.db.select().from(schema.pressPlan).where(eq(schema.pressPlan.companyId, companyId));
      // PP-1 is the draft trial of the new copy; PP-2 is the released die trial plan holding the die room e2e's trial runs (W2-DR2).
      expect(plans.map((p) => [p.number, p.status, p.purpose]).sort()).toEqual([
        ["PP-1", "draft", "die_trial"],
        ["PP-2", "released", "die_trial"],
      ]);
    }
    // The plan book continues after PP-2.
    const next = await dn.nextDocNumber(env.db, companyId, "press_plan", new Date());
    expect(next.number).toBe("PP-3");
  });
});
