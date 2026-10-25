/**
 * W3-AG-C ageing contracts: migration 0038 (tables, the columns pack reads, partial uniques), schema
 * enums = domain enums, permission keys and roles, reason kinds, the zod contracts, the refusal
 * sentences, the reopen blocker, the bundle rows dispatch reads, the OVEN_SIMULATOR seam, pack's
 * trolley draw against the real table, and the dev seed's ageing masters.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import * as ag from "@orrn/db/schema/ageing";
import { reasonCode } from "@orrn/db/schema/reasons";
import * as dom from "@orrn/domain";
import { and, eq, sql } from "drizzle-orm";

import {
  ageingHoldInput,
  ageingLoadInput,
  ageingRecipeSaveInput,
  ageingStartInput,
  ageingTelemetryInput,
  ageingTempInput,
  ageingVoidInput,
} from "../src/lib/ageingContracts";
import { AGEING_REFUSALS, AGEING_STATUS_PHRASE, ageingRefusal } from "../src/lib/ageingRefusals";
import { ovenSimulatorEnabled, ovenSimulatorProfile, simulatedReadings } from "../src/lib/ageingSimulator";
import { APPROVER_ROLES, can, type Action } from "../src/lib/permissions";
import { createTestEnv, type TestEnv } from "./harness";
import { precreateDevSeedUsers } from "./dev-seed-fixture";

let env: TestEnv;

beforeAll(async () => {
  env = await createTestEnv();
}, 60_000);

afterAll(async () => {
  await env.dispose();
});

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../db/src/migrations");
const q = async <T>(query: PromiseLike<T>): Promise<T> => await query;
const AGEING_TABLES = ["ageing_oven", "trolley", "ageing_recipe", "ageing_batch", "ageing_row", "ageing_temp_log", "ageing_hardness"];

async function columnsOf(table: string): Promise<string[]> {
  return ((await env.db.all(sql.raw(`select name from pragma_table_info('${table}')`))) as { name: string }[]).map((c) => c.name);
}

async function plant() {
  const { companyId, users } = await env.seedCompany();
  const dieId = await env.seedDie(companyId);
  const trolleyId = crypto.randomUUID();
  await env.db.insert(ag.trolley).values({ id: trolleyId, companyId, code: `T-${trolleyId.slice(0, 4)}`, status: "active" });
  const ovenId = crypto.randomUUID();
  await env.db.insert(ag.ageingOven).values({ id: ovenId, companyId, code: `OV-${ovenId.slice(0, 4)}`, status: "active" });
  return { companyId, users, dieId, trolleyId, ovenId };
}

const batch = (p: { companyId: string; trolleyId: string }, over: Partial<typeof ag.ageingBatch.$inferInsert> = {}) => ({
  id: crypto.randomUUID(),
  companyId: p.companyId,
  number: `AG-${Math.floor(Math.random() * 1e9)}`,
  trolleyId: p.trolleyId,
  ...over,
});

describe("migration 0038_ageing", () => {
  test("0038 then 0039 (idx 38, 39), chained, after whatever lands before them; every ageing table exists", async () => {
    const journal = JSON.parse(readFileSync(join(MIGRATIONS_DIR, "meta/_journal.json"), "utf8")) as { entries: { idx: number; tag: string; when: number }[] };
    const e38 = journal.entries.find((e) => e.tag === "0038_ageing");
    const e39 = journal.entries.find((e) => e.tag === "0039_ageing_2");
    expect(e38?.idx).toBe(38);
    expect(e39?.idx).toBe(39);
    // Review I1: the foundry lane's 0036/0037 carry larger `when`s than this branch's 0038/0039. The merger
    // re-points 0038's prevId to the last foundry snapshot and moves both `when`s past it; the pins here are
    // the invariants that survive that: entries sorted by idx have strictly rising `when`s, and 0039 follows 0038.
    const byIdx = [...journal.entries].sort((a, b) => a.idx - b.idx);
    for (let i = 1; i < byIdx.length; i++) expect({ tag: byIdx[i]!.tag, rising: byIdx[i]!.when > byIdx[i - 1]!.when }).toEqual({ tag: byIdx[i]!.tag, rising: true });
    expect(readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"))).toEqual(expect.arrayContaining(["0038_ageing.sql", "0039_ageing_2.sql"]));
    const snap38 = JSON.parse(readFileSync(join(MIGRATIONS_DIR, "meta/0038_snapshot.json"), "utf8")) as { id: string; prevId: string };
    const snap39 = JSON.parse(readFileSync(join(MIGRATIONS_DIR, "meta/0039_snapshot.json"), "utf8")) as { id: string; prevId: string };
    expect(snap39.prevId).toBe(snap38.id);
    // 0038 chains off the migration right before it in idx order (0035 here; the last foundry one after the merge).
    const before = byIdx[byIdx.findIndex((e) => e.tag === "0038_ageing") - 1]!;
    const prev = JSON.parse(readFileSync(join(MIGRATIONS_DIR, `meta/${before.tag.slice(0, 4)}_snapshot.json`), "utf8")) as { id: string };
    expect(snap38.prevId).toBe(prev.id);
    const names = new Set(((await env.db.all(sql`select name from sqlite_master where type = 'table'`)) as { name: string }[]).map((r) => r.name));
    for (const t of AGEING_TABLES) expect({ t, exists: names.has(t) }).toEqual({ t, exists: true });
    // 0039: the telemetry device id and the review m5 indexes.
    expect(await columnsOf("ageing_temp_log")).toContain("device_id");
    const idx = new Set(((await env.db.all(sql`select name from sqlite_master where type = 'index'`)) as { name: string }[]).map((r) => r.name));
    for (const i of ["ageing_batch_company_oven_in_idx", "ageing_batch_company_trolley_idx", "ageing_batch_company_rework_of_idx", "ageing_row_company_rework_row_idx", "ageing_temp_log_feed_device_unique"]) {
      expect({ i, exists: idx.has(i) }).toEqual({ i, exists: true });
    }
  });

  test("0040 (W3-AG-S review m4): follows 0039; ageing_hardness.pass takes null for a sample of the other method, its indexes survive the rebuild", async () => {
    const journal = JSON.parse(readFileSync(join(MIGRATIONS_DIR, "meta/_journal.json"), "utf8")) as { entries: { idx: number; tag: string; when: number }[] };
    const e39 = journal.entries.find((e) => e.tag === "0039_ageing_2")!;
    const e40 = journal.entries.find((e) => e.tag === "0040_ageing_3");
    expect(e40!.idx).toBe(e39.idx + 1);
    expect(e40!.when).toBeGreaterThan(e39.when);
    const snap39 = JSON.parse(readFileSync(join(MIGRATIONS_DIR, "meta/0039_snapshot.json"), "utf8")) as { id: string };
    const snap40 = JSON.parse(readFileSync(join(MIGRATIONS_DIR, "meta/0040_snapshot.json"), "utf8")) as { prevId: string };
    expect(snap40.prevId).toBe(snap39.id);
    const info = (await env.db.all(sql`pragma table_info(ageing_hardness)`)) as { name: string; notnull: number }[];
    expect(info.find((c) => c.name === "pass")!.notnull).toBe(0);
    expect(info.find((c) => c.name === "id")!.notnull).toBe(1);
    const idx = new Set(((await env.db.all(sql`select name from sqlite_master where type = 'index' and tbl_name = 'ageing_hardness'`)) as { name: string }[]).map((r) => r.name));
    for (const i of ["ageing_hardness_company_row_idx", "ageing_hardness_company_batch_idx", "ageing_hardness_company_server_seq_idx"]) expect({ i, exists: idx.has(i) }).toEqual({ i, exists: true });
  });

  test("ageing_row carries the exact columns pack reads (lib/pack.ts)", async () => {
    const cols = await columnsOf("ageing_row");
    for (const c of ["id", "company_id", "die_id", "length_mm", "pcs", "packed_pcs", "scrap_pcs", "rework_pcs", "status", "batch_id", "source", "bundle_id", "press_run_line_id"]) {
      expect({ c, has: cols.includes(c) }).toEqual({ c, has: true });
    }
    const batchCols = await columnsOf("ageing_batch");
    for (const c of ["number", "status", "oven_id", "recipe_id", "target_temp_x10", "soak_min", "gas_start_milli", "gas_end_milli", "soak_started_at", "soak_verdict", "qc_verdict", "void_reason_code_id", "client_mutation_id"]) {
      expect({ c, has: batchCols.includes(c) }).toEqual({ c, has: true });
    }
  });

  test("one unfinished batch per trolley; a closed or void one frees it", async () => {
    const p = await plant();
    const first = batch(p, { status: "released" });
    await env.db.insert(ag.ageingBatch).values(first);
    await expect(q(env.db.insert(ag.ageingBatch).values(batch(p)))).rejects.toThrow();
    await env.db.update(ag.ageingBatch).set({ status: "closed" }).where(eq(ag.ageingBatch.id, first.id));
    await env.db.insert(ag.ageingBatch).values(batch(p, { status: "loading" }));
    await env.db.insert(ag.ageingBatch).values(batch(p, { status: "void" }));
  });

  test("one batch in an oven at a time", async () => {
    const p = await plant();
    const t2 = crypto.randomUUID();
    await env.db.insert(ag.trolley).values({ id: t2, companyId: p.companyId, code: "T-OTHER", status: "active" });
    await env.db.insert(ag.ageingBatch).values(batch(p, { status: "in_oven", ovenId: p.ovenId }));
    await expect(q(env.db.insert(ag.ageingBatch).values(batch({ ...p, trolleyId: t2 }, { status: "in_oven", ovenId: p.ovenId })))).rejects.toThrow();
    await env.db.insert(ag.ageingBatch).values(batch({ ...p, trolleyId: t2 }, { status: "loading", ovenId: p.ovenId }));
  });

  test("one active recipe per alloy, temper and kind; drafts and archived rows do not count", async () => {
    const p = await plant();
    const r = (status: "draft" | "active" | "archived", kind: "full" | "top_up" = "full") => ({
      id: crypto.randomUUID(),
      companyId: p.companyId,
      alloy: "6063",
      temper: "T5",
      kind,
      targetTempX10: 1850,
      soakMin: 240,
      hardnessMinX10: 80,
      status,
    });
    await env.db.insert(ag.ageingRecipe).values([r("active"), r("draft"), r("archived"), r("active", "top_up")]);
    await expect(q(env.db.insert(ag.ageingRecipe).values(r("active")))).rejects.toThrow();
  });

  test("masters: codes are unique per company; numbers per company", async () => {
    const p = await plant();
    await expect(q(env.db.insert(ag.ageingOven).values({ id: crypto.randomUUID(), companyId: p.companyId, code: (await env.db.select().from(ag.ageingOven).where(eq(ag.ageingOven.id, p.ovenId)))[0]!.code }))).rejects.toThrow();
    const b = batch(p, { status: "closed" });
    await env.db.insert(ag.ageingBatch).values(b);
    await expect(q(env.db.insert(ag.ageingBatch).values(batch(p, { number: b.number, status: "void" })))).rejects.toThrow();
    const other = await plant();
    await env.db.insert(ag.ageingBatch).values(batch(other, { number: b.number, status: "loading" }));
  });

  test("a replayed collector or simulator reading is refused by the index; typed readings may repeat", async () => {
    const p = await plant();
    const b = batch(p, { status: "in_oven", ovenId: p.ovenId });
    await env.db.insert(ag.ageingBatch).values(b);
    const at = new Date(Date.UTC(2026, 9, 24, 4));
    const reading = (source: "typed" | "simulator") => ({ id: crypto.randomUUID(), companyId: p.companyId, batchId: b.id, at, tempCX10: 1850, source });
    await env.db.insert(ag.ageingTempLog).values([reading("typed"), reading("typed"), reading("simulator")]);
    await expect(q(env.db.insert(ag.ageingTempLog).values(reading("simulator")))).rejects.toThrow();
    // A second probe (device id) at the same millisecond is another reading; its replay is refused too.
    const probe = { ...reading("simulator"), source: "telemetry" as const, deviceId: "probe-2" };
    await env.db.insert(ag.ageingTempLog).values([{ ...probe, id: crypto.randomUUID(), deviceId: "probe-1" }, probe]);
    await expect(q(env.db.insert(ag.ageingTempLog).values({ ...probe, id: crypto.randomUUID() }))).rejects.toThrow();
    const n = await env.db.select().from(ag.ageingTempLog).where(eq(ag.ageingTempLog.batchId, b.id));
    expect(n).toHaveLength(5);
  });

  test("schema enums equal the domain's", () => {
    expect([...ag.ageingMasterStatuses]).toEqual([...dom.AGEING_MASTER_STATUSES]);
    expect([...ag.ageingRecipeKinds]).toEqual([...dom.AGEING_RECIPE_KINDS]);
    expect([...ag.ageingRecipeStatuses]).toEqual([...dom.AGEING_RECIPE_STATUSES]);
    expect([...ag.hardnessMethods]).toEqual([...dom.HARDNESS_METHODS]);
    expect([...ag.ageingBatchStatuses]).toEqual([...dom.AGEING_BATCH_STATUSES]);
    expect([...ag.AGEING_OPEN_BATCH_STATUSES]).toEqual([...dom.AGEING_OPEN_BATCH_STATUSES]);
    expect([...ag.ageingRowStatuses]).toEqual([...dom.AGEING_ROW_STATUSES]);
    expect([...ag.ageingRowSources]).toEqual([...dom.AGEING_ROW_SOURCES]);
    expect([...ag.ageingTempSources]).toEqual([...dom.AGEING_TEMP_SOURCES]);
    expect([...ag.ageingSoakVerdicts]).toEqual([...dom.AGEING_SOAK_VERDICTS]);
    expect([...ag.ageingQcVerdicts]).toEqual([...dom.AGEING_QC_VERDICTS]);
    expect([...ag.ageingDispositions]).toEqual([...dom.AGEING_DISPOSITIONS]);
  });
});

describe("permissions (W3-AG-C)", () => {
  const member = (role: string) => ({ company: { role }, isPlatformAdmin: false }) as Parameters<typeof can>[0];
  const ROLES = ["owner", "admin", "manager", "office", "accountant", "supervisor", "packer", "foundry", "press", "storekeeper", "die_room", "operator", "viewer"];
  const holders = (action: Action) => ROLES.filter((r) => can(member(r), action));

  test("load and record: the station (press, operator) and the supervisor; release: supervisor and manager", () => {
    expect(holders("ageing.load")).toEqual(["owner", "supervisor", "press", "operator"]);
    expect(holders("ageing.record")).toEqual(["owner", "supervisor", "press", "operator"]);
    expect(holders("ageing.release")).toEqual(["owner", "manager", "supervisor"]);
  });

  test("everyone who loads can see the board; the packer and viewer cannot", () => {
    for (const r of holders("ageing.load")) expect({ r, view: can(member(r), "ageing.view") }).toEqual({ r, view: true });
    expect(can(member("packer"), "ageing.view")).toBe(false);
    expect(can(member("viewer"), "ageing.load")).toBe(false);
    expect(can(member("office"), "ageing.release")).toBe(false);
  });

  test("an override is approved by a manager, admin or owner (never the supervisor who asks)", () => {
    expect([...APPROVER_ROLES.ageing_override]).toEqual(["owner", "admin", "manager"]);
    expect(APPROVER_ROLES.ageing_override).not.toContain("supervisor");
  });
});

describe("reason kinds", () => {
  test("a company gets ageing_abort and ageing_reject codes with the other defaults", async () => {
    const { companyId } = await env.seedCompany();
    const { ensureDefaultReasonCodes } = await import("../src/lib/reasonCodes");
    await ensureDefaultReasonCodes(env.db, companyId);
    const rows = await env.db.select({ kind: reasonCode.kind, code: reasonCode.code }).from(reasonCode).where(and(eq(reasonCode.companyId, companyId)));
    const of = (k: string) => rows.filter((r) => r.kind === k).map((r) => r.code);
    expect(of("ageing_abort").sort()).toEqual(dom.DEFAULT_REASON_CODES.ageing_abort.map((c) => c.code).sort());
    expect(of("ageing_reject")).toEqual(expect.arrayContaining([...dom.AGEING_REJECT_CODES, "other"]));
  });
});

describe("zod contracts", () => {
  test("load: at least one line, press / typed / bundle rows, defaults filled", () => {
    expect(ageingLoadInput.safeParse({ trolleyId: "t" }).success).toBe(false);
    const ok = ageingLoadInput.parse({ trolleyId: "t", rows: [{ pressRunLineId: "l", pcs: 60 }] });
    expect(ok).toMatchObject({ manual: [], bundles: [] });
    expect(ageingLoadInput.safeParse({ trolleyId: "t", bundles: [{ bundleId: "b" }] }).success).toBe(true);
    expect(ageingLoadInput.safeParse({ trolleyId: "t", rows: [{ pressRunLineId: "l", pcs: 0 }] }).success).toBe(false);
    const many = Array.from({ length: 41 }, (_, i) => ({ bundleId: `b${i}` }));
    expect(ageingLoadInput.safeParse({ trolleyId: "t", bundles: many }).success).toBe(false);
  });

  test("temperatures and hardness are integers ×10 within range", () => {
    expect(ageingTempInput.safeParse({ batchId: "b", tempCX10: 1850 }).success).toBe(true);
    expect(ageingTempInput.safeParse({ batchId: "b", tempCX10: 185.5 }).success).toBe(false);
    expect(ageingTempInput.safeParse({ batchId: "b", tempCX10: 18_500 }).success).toBe(false);
    expect(ageingTelemetryInput.safeParse({ batchId: "b", source: "typed", readings: [{ at: 1, tempCX10: 1850 }] }).success).toBe(false);
    expect(ageingRecipeSaveInput.parse({ alloy: "6063", temper: "T5", targetTempX10: 1850, soakMin: 240, hardnessMinX10: 80 })).toMatchObject({
      kind: "full",
      toleranceX10: 100,
      sampleCount: 3,
      hardnessMethod: "webster",
      status: "draft",
    });
  });

  test("start, hold, void shapes", () => {
    expect(ageingStartInput.parse({ batchId: "b", ovenId: "o", recipeId: "r", shiftId: "s", gasStartMilli: 18_420_500 }).meterReset).toBe(false);
    expect(ageingHoldInput.safeParse({ reasonCodeId: "x" }).success).toBe(false);
    expect(ageingHoldInput.safeParse({ batchId: "b", rowId: "r", reasonCodeId: "x" }).success).toBe(false);
    expect(ageingHoldInput.safeParse({ rowId: "r", reasonCodeId: "x" }).success).toBe(true);
    expect(ageingVoidInput.safeParse({ batchId: "b" }).success).toBe(true);
  });
});

describe("refusal sentences", () => {
  test("every refusal code has a sentence and a tRPC code; the error carries the code", () => {
    expect(Object.keys(AGEING_REFUSALS).sort()).toEqual([...dom.AGEING_REFUSAL_CODES].sort());
    const e = ageingRefusal("oven_busy", { oven: "OV-1" });
    expect(e.code).toBe("CONFLICT");
    expect(e.message).toBe("Oven OV-1 already has a batch in it");
    expect((e.cause as { ageingCode?: string }).ageingCode).toBe("oven_busy");
    expect(ageingRefusal("wrong_status", { batch: "AG-7", status: "in_oven" }).message).toBe("AG-7 is in the oven; that step is not open now");
    expect(Object.keys(AGEING_STATUS_PHRASE).sort()).toEqual([...dom.AGEING_BATCH_STATUSES].sort());
  });
});

describe("reopen blocker and the bundle rows dispatch reads", () => {
  test("a non-void row on a live batch blocks the run's reopen; voiding it frees the run", async () => {
    const p = await plant();
    const { ageingReopenBlocker } = await import("../src/lib/ageing");
    const b = batch(p, { status: "out" });
    await env.db.insert(ag.ageingBatch).values(b);
    const rowId = crypto.randomUUID();
    await env.db.insert(ag.ageingRow).values({ id: rowId, companyId: p.companyId, batchId: b.id, dieId: p.dieId, pressRunId: "run-1", lengthMm: 3_658, pcs: 10 });
    expect(await ageingReopenBlocker(env.db, p.companyId, "run-1")).toBe(`Pieces of this run are on ageing batch ${b.number}; void that batch first`);
    expect(await ageingReopenBlocker(env.db, p.companyId, "run-2")).toBeNull();
    const other = await env.seedCompany();
    expect(await ageingReopenBlocker(env.db, other.companyId, "run-1")).toBeNull();
    await env.db.update(ag.ageingRow).set({ status: "void" }).where(eq(ag.ageingRow.id, rowId));
    expect(await ageingReopenBlocker(env.db, p.companyId, "run-1")).toBeNull();
  });

  test("open bundle rows: only source bundle on unfinished batches, 150 ids in chunks under 100 params", async () => {
    const p = await plant();
    const { openBundleRows } = await import("../src/lib/ageing");
    const bundles = await env.seedBundles(p.companyId, p.dieId, 2);
    const b = batch(p, { status: "in_oven" });
    await env.db.insert(ag.ageingBatch).values(b);
    await env.db.insert(ag.ageingRow).values({
      id: crypto.randomUUID(),
      companyId: p.companyId,
      batchId: b.id,
      source: "bundle",
      bundleId: bundles[0]!.id,
      dieId: p.dieId,
      lengthMm: 3_658,
      pcs: 10,
      packedPcs: 10,
    });
    const ids = [bundles[0]!.id, bundles[1]!.id, ...Array.from({ length: 148 }, () => crypto.randomUUID())];
    const open = await openBundleRows(env.db, p.companyId, ids);
    expect([...open.keys()]).toEqual([bundles[0]!.id]);
    const st = dom.bundleAgeingState({ ageingRowId: null, openRow: open.get(bundles[0]!.id)! });
    expect(st).toBe("in_ageing");
    expect(dom.dispatchAgeingRefusal({ state: st, requireAgeing: false, requireAgeingSince: null, packedDay: "2026-10-24" })).toBe("bundle_in_ageing");
    await env.db.update(ag.ageingBatch).set({ status: "closed" }).where(eq(ag.ageingBatch.id, b.id));
    expect((await openBundleRows(env.db, p.companyId, ids)).size).toBe(0);
  });
});

describe("OVEN_SIMULATOR seam", () => {
  test("on only with OVEN_SIMULATOR=1 outside production; profile from the env, default normal", () => {
    expect(ovenSimulatorEnabled({ OVEN_SIMULATOR: "1" })).toBe(true);
    expect(ovenSimulatorEnabled({ OVEN_SIMULATOR: "1", NODE_ENV: "production" })).toBe(false);
    expect(ovenSimulatorEnabled({})).toBe(false);
    expect(ovenSimulatorProfile({ OVEN_SIMULATOR_PROFILE: "over" })).toBe("over");
    expect(ovenSimulatorProfile({ OVEN_SIMULATOR_PROFILE: "boil" })).toBe("normal");
  });

  test("readings up to now (or take-out), deterministic per batch, judged by the recipe", () => {
    const inAt = Date.UTC(2026, 9, 24, 2);
    const snapshot = { targetTempX10: 1850, toleranceX10: 100, soakMin: 240 };
    const now = inAt + 100 * 60_000;
    const so_far = simulatedReadings({ batchId: "b1", snapshot, inAt, outAt: null, now, profile: "normal" });
    expect(so_far.every((r) => r.at <= now)).toBe(true);
    expect(so_far).toHaveLength(7); // minutes 0, 15, … 90
    expect(simulatedReadings({ batchId: "b1", snapshot, inAt, outAt: null, now, profile: "normal" })).toEqual(so_far);
    const full = simulatedReadings({ batchId: "b1", snapshot, inAt, outAt: inAt + 315 * 60_000, now: inAt + 400 * 60_000, profile: "normal" });
    const verdict = dom.soakCompliance({ readings: full, snapshot: { ...snapshot, maxSoakMin: null }, inAt, outAt: inAt + 315 * 60_000, now: inAt + 400 * 60_000 });
    expect(verdict.verdict).toBe("ok");
  });
});

describe("pack's trolley draw on the real table", () => {
  test("readAgeingRow and the draw statements work against migration 0038 (status checked inside the batch)", async () => {
    const p = await plant();
    const { readAgeingRow, drawAgeingRowStatements } = await import("../src/lib/pack");
    const { atomicBatch } = await import("../src/lib/atomic");
    const b = batch(p, { status: "released" });
    await env.db.insert(ag.ageingBatch).values(b);
    const rowId = crypto.randomUUID();
    await env.db.insert(ag.ageingRow).values({ id: rowId, companyId: p.companyId, batchId: b.id, dieId: p.dieId, lengthMm: 3_658, pcs: 48, packedPcs: 5, status: "released" });
    expect(await readAgeingRow(env.db, p.companyId, rowId)).toEqual({
      id: rowId,
      batchId: b.id,
      dieId: p.dieId,
      lengthMm: 3_658,
      pcs: 48,
      remaining: 43,
      status: "released",
      source: "press",
      castId: null,
    });
    // Review I6: a row held between the read and the write fails the draw inside the batch.
    await env.db.update(ag.ageingRow).set({ status: "held" }).where(eq(ag.ageingRow.id, rowId));
    await expect(atomicBatch(env.db, drawAgeingRowStatements(env.db, p.companyId, rowId, 1))).rejects.toThrow();
    expect((await readAgeingRow(env.db, p.companyId, rowId)).remaining).toBe(43);
    await env.db.update(ag.ageingRow).set({ status: "released" }).where(eq(ag.ageingRow.id, rowId));
    // The last pieces close the row and the batch (Q58: the trolley is free).
    await atomicBatch(env.db, drawAgeingRowStatements(env.db, p.companyId, rowId, 43, { batchId: b.id, seq: 1, userId: null }));
    const after = await readAgeingRow(env.db, p.companyId, rowId);
    expect([after.remaining, after.status]).toEqual([0, "closed"]);
    const [closed] = await env.db.select().from(ag.ageingBatch).where(eq(ag.ageingBatch.id, b.id));
    expect(closed!.status).toBe("closed");
  });
});

describe("dev seed: ageing masters (idempotent)", () => {
  test("one active oven, two trolleys, 6063 T5 and T6 active; PR-8 on AG-1 (released) and AG-2 (in the oven)", async () => {
    await precreateDevSeedUsers(env);
    const seedPath = "../../../apps/server/src/dev-seed";
    const { seedDevData } = (await import(seedPath)) as {
      seedDevData: (db: TestEnv["db"], opts: { password: string }) => Promise<{ ok: boolean }>;
    };
    const companyId = "dev-company-orrn";
    for (let i = 0; i < 2; i++) {
      expect((await seedDevData(env.db, { password: "dev-seed-test" })).ok).toBe(true);
      const ovens = await env.db.select().from(ag.ageingOven).where(eq(ag.ageingOven.companyId, companyId));
      expect(ovens.map((o) => [o.code, o.status, o.capacityG])).toEqual([["OV-1", "active", 2_000_000]]);
      const trolleys = await env.db.select().from(ag.trolley).where(eq(ag.trolley.companyId, companyId));
      expect(trolleys.map((t) => [t.code, t.status]).sort()).toEqual([
        ["T-1", "active"],
        ["T-2", "active"],
      ]);
      const recipes = await env.db.select().from(ag.ageingRecipe).where(eq(ag.ageingRecipe.companyId, companyId));
      expect(recipes.map((r) => [r.alloy, r.temper, r.kind, r.status, r.targetTempX10, r.soakMin]).sort()).toEqual([
        ["6063", "T5", "full", "active", 1850, 240],
        ["6063", "T6", "full", "active", 1850, 360],
      ]);
      // W3-AG-S: PR-8's 80 pcs: 40 released on T-1, 30 in OV-1 on T-2, 10 left on the press line.
      const batches = await env.db.select().from(ag.ageingBatch).where(eq(ag.ageingBatch.companyId, companyId));
      expect(batches.map((b) => [b.number, b.status, b.trolleyId]).sort()).toEqual([
        ["AG-1", "released", "dev-trolley-1"],
        ["AG-2", "in_oven", "dev-trolley-2"],
      ]);
      const released = batches.find((b) => b.number === "AG-1")!;
      // The production day may be too young for a 6 h soak: AG-1 is always released on an approved override.
      expect(["under_aged", "no_readings"]).toContain(released.soakVerdict!);
      expect([released.qcVerdict, released.overrideApprovalId]).toEqual(["override", "dev-approval-ageing-override-1"]);
      const rows = await env.db.select().from(ag.ageingRow).where(eq(ag.ageingRow.companyId, companyId));
      expect(rows.map((r) => [r.pressRunLineId, r.pcs, r.kgG, r.status]).sort()).toEqual([
        ["dev-run-12230-1-line-1", 30, 87_825, "pending"],
        ["dev-run-12230-1-line-1", 40, 117_100, "released"],
      ]);
      const sim = await env.db.select().from(ag.ageingTempLog).where(and(eq(ag.ageingTempLog.companyId, companyId), eq(ag.ageingTempLog.batchId, "dev-ageing-batch-2")));
      expect(sim.length).toBeGreaterThan(0);
      expect(sim.every((r) => r.source === "simulator")).toBe(true);
    }
  }, 120_000);
});
