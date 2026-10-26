/**
 * FP-PF-12 backups and the restore drill (platform spec §3 backup_run, §4 Backups, §6 Backup):
 * export excludes secrets, a drill restores into a suspended `restore-drill-{date}` company and
 * compares customer/die/bundle/dispatch, every failure path leaves a failed run and the previous
 * Ok object untouched. R2 is a fake bucket here (`workersEnv.BACKUPS`).
 */
import { afterAll, afterEach, beforeAll, describe, expect, test, setDefaultTimeout } from "bun:test";

import { auditLog, backupRun, bundle, company, customer, die, dispatch, dispatchItem, invite, session } from "@orrn/db/schema";
import { and, count, eq } from "drizzle-orm";

import { workersEnv } from "./env-mock";
import { createTestEnv, type TestEnv } from "./harness";

// Heavy Miniflare D1 cases: the 5 s default flakes when other gates share the machine.
setDefaultTimeout(30_000);

let env: TestEnv;

class FakeR2 {
  objects = new Map<string, string>();
  failPut = false;
  async put(key: string, value: string) {
    if (this.failPut) throw new Error("R2 put failed: 503");
    this.objects.set(key, value);
    return { key };
  }
  async get(key: string) {
    const v = this.objects.get(key);
    return v === undefined ? null : { text: async () => v };
  }
}

let r2: FakeR2;

beforeAll(async () => {
  env = await createTestEnv();
});

afterAll(async () => {
  delete workersEnv.BACKUPS;
  await env.dispose();
});

afterEach(() => {
  delete workersEnv.BACKUPS;
});

function bindBucket() {
  r2 = new FakeR2();
  workersEnv.BACKUPS = r2;
  return r2;
}

/** A plant with 2 customers, 2 dies, 5 bundles, 1 dispatch, an invite, a session and a wrapped key. */
async function seedPlant() {
  const { companyId, users } = await env.seedCompany({ modules: ["dies", "bundles"], settings: { timezone: "Asia/Kolkata", locale: "gu" } });
  const customerA = await env.seedCustomer(companyId);
  await env.seedCustomer(companyId);
  const dieA = await env.seedDie(companyId);
  const dieB = await env.seedDie(companyId);
  const bundles = await env.seedBundles(companyId, dieA, 3);
  await env.seedBundles(companyId, dieB, 2, "dispatched");
  const dispatchId = crypto.randomUUID();
  await env.db.insert(dispatch).values({ id: dispatchId, companyId, code: `D-${dispatchId.slice(0, 4)}`, customerId: customerA, status: "draft" });
  await env.db.insert(dispatchItem).values({ id: crypto.randomUUID(), companyId, dispatchId, bundleId: bundles[0]!.id });
  await env.db.insert(invite).values({
    id: crypto.randomUUID(),
    companyId,
    email: `new.${crypto.randomUUID().slice(0, 6)}@test.orrn`,
    role: "packer",
    tokenHash: `hash-${crypto.randomUUID()}`,
    expiresAt: new Date(Date.now() + 86_400_000),
  });
  await env.db.insert(session).values({
    id: crypto.randomUUID(),
    userId: users.owner.id,
    token: `session-token-${crypto.randomUUID()}`,
    expiresAt: new Date(Date.now() + 86_400_000),
    createdAt: new Date(),
    updatedAt: new Date(),
  } as never);
  await env.db.update(company).set({ spoolApiKeyWrapped: "WRAPPED-SECRET-KEY" }).where(eq(company.id, companyId));
  await env.caller({ role: "owner", companyId }).company.updateSettings({ priceOnSalesOrder: true });
  return { companyId };
}

const tally = async (table: typeof customer | typeof die | typeof bundle | typeof dispatch, companyId: string) =>
  Number((await env.db.select({ n: count() }).from(table).where(eq(table.companyId, companyId)))[0]!.n);

const staff = () => env.caller({ platformRole: "admin" });

describe("export", () => {
  test("writes the company's rows to R2 without secrets; succeeded run with bytes, counts and an audit row", async () => {
    const bucket = bindBucket();
    const { companyId } = await seedPlant();
    const run = await staff().platform.backup.run({ companyId });
    expect(run).toMatchObject({ purpose: "export", kind: "manual", status: "ok", error: null });
    expect(run.bytes).toBeGreaterThan(100);
    expect(run.detail).toMatchObject({ counts: { customer: 2, die: 2, bundle: 5, dispatch: 1 } });

    const [key] = [...bucket.objects.keys()];
    expect(key).toMatch(new RegExp(`^backups/${companyId}/\\d{4}-\\d{2}-\\d{2}/`));
    const body = bucket.objects.get(key!)!;
    const payload = JSON.parse(body) as { tables: Record<string, { columns: string[] }>; company: Record<string, unknown> };
    for (const t of ["session", "account", "verification", "two_factor", "invite", "spool_deployment", "backup_run"]) {
      expect({ t, present: t in payload.tables }).toEqual({ t, present: false });
    }
    for (const [name, t] of Object.entries(payload.tables)) {
      for (const c of t.columns) expect({ name, c, secret: /(_wrapped$|_hash$|token|secret|password)/.test(c) }).toMatchObject({ secret: false });
    }
    expect(payload.company).not.toHaveProperty("spool_api_key_wrapped");
    expect(body).not.toContain("WRAPPED-SECRET-KEY");
    expect(body).not.toContain("session-token-");
    expect(body).not.toContain("hash-");
    // Settings, audit and masters are in.
    expect(String(payload.company.settings)).toContain("priceOnSalesOrder");
    expect(payload.tables.audit_log).toBeDefined();

    const audits = await env.db.select().from(auditLog).where(and(eq(auditLog.action, "backup.export"), eq(auditLog.subjectId, run.id)));
    expect(audits).toHaveLength(1);
    expect(audits[0]!.companyId).toBe(companyId);

    // The plant's card shows it without the R2 key; plant roles below settings.update cannot read it.
    const status = await env.caller({ role: "owner", companyId }).backup.status();
    expect(status.lastOk).toMatchObject({ id: run.id, status: "ok" });
    expect(JSON.stringify(status)).not.toContain("backups/");
    await expect(env.caller({ role: "manager", companyId }).backup.status()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  test("support staff and plant owners cannot run a backup", async () => {
    bindBucket();
    const { companyId } = await env.seedCompany();
    await expect(env.caller({ platformRole: "support" }).platform.backup.run({ companyId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(env.caller({ role: "owner", companyId }).platform.backup.run({ companyId })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  test("failure: R2 error -> failed run with a note; the previous Ok run and object stay", async () => {
    const bucket = bindBucket();
    const { companyId } = await seedPlant();
    const ok = await staff().platform.backup.run({ companyId });
    const objects = bucket.objects.size;

    bucket.failPut = true;
    const failed = await staff().platform.backup.run({ companyId });
    expect(failed).toMatchObject({ status: "failed", error: "R2 put failed: 503" });
    expect(bucket.objects.size).toBe(objects);

    const status = await env.caller({ role: "admin", companyId }).backup.status();
    expect(status.configured).toBe(true);
    expect(status.lastOk?.id).toBe(ok.id);
    expect(status.lastAttempt).toMatchObject({ id: failed.id, status: "failed" });
    const okRow = await env.db.select().from(backupRun).where(eq(backupRun.id, ok.id)).get();
    expect(okRow!.status).toBe("succeeded");
  });

  test("no BACKUPS binding (R2 not enabled, D10/D36): export and drill refuse PRECONDITION_FAILED and write no run", async () => {
    bindBucket();
    const { companyId } = await seedPlant();
    const ok = await staff().platform.backup.run({ companyId });

    delete workersEnv.BACKUPS;
    const before = await env.db.select().from(backupRun).where(eq(backupRun.companyId, companyId));
    const notSetUp = { code: "PRECONDITION_FAILED", message: "Backups are not set up for this plant yet" };
    await expect(staff().platform.backup.run({ companyId })).rejects.toMatchObject(notSetUp);
    await expect(staff().platform.backup.drill({ companyId })).rejects.toMatchObject(notSetUp);
    const after = await env.db.select().from(backupRun).where(eq(backupRun.companyId, companyId));
    expect(after).toHaveLength(before.length);

    // The plant's card says backups are not switched on; the last good backup still shows.
    const status = await env.caller({ role: "owner", companyId }).backup.status();
    expect(status).toMatchObject({ configured: false, lastOk: { id: ok.id }, lastAttempt: null });
  });

  test("the daily job with no BACKUPS binding does nothing: no runs, no failed rows", async () => {
    const { companyId } = await seedPlant();
    const { runScheduledBackups } = await import("../src/lib/backup");
    expect(await runScheduledBackups(env.db, new Date())).toBeNull();
    expect(await env.db.select().from(backupRun).where(eq(backupRun.companyId, companyId))).toHaveLength(0);
  });

  test("the daily job exports each active company once per IST day", async () => {
    bindBucket();
    const { companyId } = await seedPlant();
    const { runScheduledBackups } = await import("../src/lib/backup");
    const at = new Date();
    const first = (await runScheduledBackups(env.db, at))!;
    expect(first.find((r) => r.companyId === companyId)?.status).toBe("succeeded");
    const second = (await runScheduledBackups(env.db, at))!;
    expect(second.find((r) => r.companyId === companyId)?.status).toBe("skipped");
    const runs = await env.db
      .select()
      .from(backupRun)
      .where(and(eq(backupRun.companyId, companyId), eq(backupRun.kind, "scheduled")));
    expect(runs).toHaveLength(1);
  });
});

describe("failures leave an audit row too (runbook step 3)", () => {
  test("a failed export writes backup.export with ok false and the note; Ok exports say ok true", async () => {
    const bucket = bindBucket();
    const { companyId } = await seedPlant();
    const ok = await staff().platform.backup.run({ companyId });
    bucket.failPut = true;
    const failed = await staff().platform.backup.run({ companyId });
    expect(failed.status).toBe("failed");
    const rows = await env.db.select().from(auditLog).where(and(eq(auditLog.companyId, companyId), eq(auditLog.action, "backup.export")));
    const byRun = Object.fromEntries(rows.map((r) => [r.subjectId, r.meta]));
    expect(byRun[ok.id]).toMatchObject({ ok: true });
    expect(byRun[failed.id]).toMatchObject({ ok: false, error: "R2 put failed: 503", kind: "manual" });
  });

  test("a failed drill writes backup.drill with ok false and the note", async () => {
    bindBucket();
    const { companyId } = await seedPlant();
    const none = await staff().platform.backup.drill({ companyId });
    expect(none.status).toBe("failed");
    const row = await env.db.select().from(auditLog).where(and(eq(auditLog.action, "backup.drill"), eq(auditLog.subjectId, none.id))).get();
    expect(row!.companyId).toBe(companyId);
    expect(row!.meta).toMatchObject({ ok: false, error: "No successful export to restore" });
  });

  test("auth_session_id (device) is never exported; a stock count's session_id is", async () => {
    const { isSecretColumn } = await import("../src/lib/backup");
    expect(isSecretColumn("auth_session_id")).toBe(true);
    expect(isSecretColumn("session_id")).toBe(false);
  });
});

describe("drill scratch companies are discarded after 7 days (daily job)", () => {
  test("older than 7 days: the scratch company and its rows go; newer ones and the live plant stay", async () => {
    const bucket = bindBucket();
    const { companyId } = await seedPlant();
    const { runDrill, runScheduledBackups, DRILL_SCRATCH_KEEP_DAYS } = await import("../src/lib/backup");
    expect(DRILL_SCRATCH_KEEP_DAYS).toBe(7);
    const exportRun = await staff().platform.backup.run({ companyId });
    const day = 86_400_000;
    const now = Date.now();
    const actor = { db: env.db, session: null };
    const old = await runDrill(actor, { companyId, at: new Date(now - 8 * day) });
    const young = await runDrill(actor, { companyId, at: new Date(now - 6 * day) });
    expect(old.status).toBe("succeeded");
    expect(young.status).toBe("succeeded");
    // A failed drill's partial scratch company is discarded the same way.
    const key = [...bucket.objects.keys()].find((k) => k.includes(exportRun.id))!;
    const payload = JSON.parse(bucket.objects.get(key)!);
    const customers = payload.tables.customer as { columns: string[]; rows: unknown[][] };
    customers.rows[0]![customers.columns.indexOf("name")] = null; // NOT NULL
    bucket.objects.set(key, JSON.stringify(payload));
    const partial = await runDrill(actor, { companyId, at: new Date(now - 9 * day), sourceRunId: exportRun.id });
    expect(partial.status).toBe("failed");
    expect(partial.scratchCompanyId).toBeTruthy();
    const live = {
      customer: await tally(customer, companyId),
      die: await tally(die, companyId),
      bundle: await tally(bundle, companyId),
      dispatch: await tally(dispatch, companyId),
    };

    await runScheduledBackups(env.db, new Date(now));

    const exists = async (id: string) => Boolean(await env.db.select({ id: company.id }).from(company).where(eq(company.id, id)).get());
    expect(await exists(old.scratchCompanyId!)).toBe(false);
    expect(await exists(partial.scratchCompanyId!)).toBe(false);
    expect(await tally(bundle, old.scratchCompanyId!)).toBe(0);
    expect(await tally(die, old.scratchCompanyId!)).toBe(0);
    expect(await exists(young.scratchCompanyId!)).toBe(true);
    expect(await tally(bundle, young.scratchCompanyId!)).toBe(5);
    expect(await exists(companyId)).toBe(true);
    expect({
      customer: await tally(customer, companyId),
      die: await tally(die, companyId),
      bundle: await tally(bundle, companyId),
      dispatch: await tally(dispatch, companyId),
    }).toEqual(live);
    // The drill runs stay as history; the live plant's log says the scratch copy was discarded.
    expect((await env.db.select().from(backupRun).where(eq(backupRun.id, old.id)).get())!.status).toBe("succeeded");
    const discards = await env.db.select().from(auditLog).where(and(eq(auditLog.companyId, companyId), eq(auditLog.action, "backup.drill.discard")));
    expect(discards.map((d) => d.subjectId).sort()).toEqual([old.id, partial.id].sort());

    // A second run finds nothing more to discard.
    await runScheduledBackups(env.db, new Date(now));
    expect(
      await env.db.select().from(auditLog).where(and(eq(auditLog.companyId, companyId), eq(auditLog.action, "backup.drill.discard"))),
    ).toHaveLength(2);
  });

  test("only suspended restore-drill-* companies named by a drill run are touched", async () => {
    bindBucket();
    const { companyId } = await seedPlant();
    const { runDrill, runScheduledBackups } = await import("../src/lib/backup");
    await staff().platform.backup.run({ companyId });
    const now = Date.now();
    const old = await runDrill({ db: env.db, session: null }, { companyId, at: new Date(now - 10 * 86_400_000) });
    // Someone reactivated it: it is no longer a scratch copy to throw away.
    await env.db.update(company).set({ status: "active" }).where(eq(company.id, old.scratchCompanyId!));
    await runScheduledBackups(env.db, new Date(now));
    expect(await env.db.select({ id: company.id }).from(company).where(eq(company.id, old.scratchCompanyId!)).get()).toBeTruthy();
  });
});

describe("restore drill", () => {
  test("restores into a suspended restore-drill-{date} company; customer/die/bundle/dispatch counts match; live rows untouched", async () => {
    bindBucket();
    const { companyId } = await seedPlant();
    await staff().platform.backup.run({ companyId });
    const before = {
      customer: await tally(customer, companyId),
      die: await tally(die, companyId),
      bundle: await tally(bundle, companyId),
      dispatch: await tally(dispatch, companyId),
    };

    const drill = await env.caller({ platformRole: "super_admin" }).platform.backup.drill({ companyId });
    expect(drill).toMatchObject({ purpose: "drill", status: "ok", error: null });
    expect(drill.detail).toMatchObject({
      expected: { customer: 2, die: 2, bundle: 5, dispatch: 1 },
      restored: { customer: 2, die: 2, bundle: 5, dispatch: 1 },
    });
    const scratch = await env.db.select().from(company).where(eq(company.id, drill.scratchCompanyId!)).get();
    expect(scratch!.status).toBe("suspended");
    expect(scratch!.name).toMatch(/^restore-drill-\d{4}-\d{2}-\d{2}$/);
    expect(scratch!.settings).toMatchObject({ locale: "gu", priceOnSalesOrder: true });
    expect(scratch!.spoolApiKeyWrapped).toBeNull();

    // Live company unchanged; restored rows carry new ids.
    expect({
      customer: await tally(customer, companyId),
      die: await tally(die, companyId),
      bundle: await tally(bundle, companyId),
      dispatch: await tally(dispatch, companyId),
    }).toEqual(before);
    const liveIds = new Set((await env.db.select({ id: bundle.id }).from(bundle).where(eq(bundle.companyId, companyId))).map((r) => r.id));
    const restored = await env.db.select({ id: bundle.id, dieId: bundle.dieId }).from(bundle).where(eq(bundle.companyId, scratch!.id));
    for (const r of restored) expect(liveIds.has(r.id)).toBe(false);
    // Foreign keys point inside the scratch company.
    const scratchDies = new Set((await env.db.select({ id: die.id }).from(die).where(eq(die.companyId, scratch!.id))).map((r) => r.id));
    for (const r of restored) expect(scratchDies.has(r.dieId)).toBe(true);

    const audits = await env.db.select().from(auditLog).where(and(eq(auditLog.action, "backup.drill"), eq(auditLog.subjectId, drill.id)));
    expect(audits[0]!.meta).toMatchObject({ ok: true, scratchCompanyId: scratch!.id });
    expect((await env.caller({ role: "owner", companyId }).backup.status()).lastDrill).toMatchObject({ id: drill.id, status: "ok" });
  });

  test("DrillFailed: an object that lost rows in storage names the table", async () => {
    const bucket = bindBucket();
    const { companyId } = await seedPlant();
    const run = await staff().platform.backup.run({ companyId });
    const key = [...bucket.objects.keys()].find((k) => k.includes(run.id))!;
    const payload = JSON.parse(bucket.objects.get(key)!);
    // Drop the bundles nothing cites (bundle_status_event / dispatch_item rows keep the cited one).
    const bundleTable = payload.tables.bundle as { columns: string[]; rows: unknown[][] };
    const idIdx = bundleTable.columns.indexOf("id");
    const cited = new Set<string>();
    for (const [name, t] of Object.entries(payload.tables as Record<string, { columns: string[]; rows: unknown[][] }>)) {
      const col = t.columns.indexOf("bundle_id");
      if (col >= 0 && name !== "bundle") for (const r of t.rows) cited.add(String(r[col]));
    }
    const keep = bundleTable.rows.filter((r) => cited.has(String(r[idIdx])));
    expect(keep.length).toBeLessThan(bundleTable.rows.length);
    bundleTable.rows = keep;
    bucket.objects.set(key, JSON.stringify(payload));

    const drill = await staff().platform.backup.drill({ companyId, sourceRunId: run.id });
    expect(drill.status).toBe("failed");
    expect(drill.error).toBe("Counts differ: bundle");
  });

  test("DrillFailed: a restore error names the table; no export at all; object missing", async () => {
    const bucket = bindBucket();
    const { companyId } = await seedPlant();

    const none = await staff().platform.backup.drill({ companyId });
    expect(none).toMatchObject({ status: "failed", error: "No successful export to restore" });

    const run = await staff().platform.backup.run({ companyId });
    const key = [...bucket.objects.keys()].find((k) => k.includes(run.id))!;
    const payload = JSON.parse(bucket.objects.get(key)!);
    const customers = payload.tables.customer as { columns: string[]; rows: unknown[][] };
    customers.rows[0]![customers.columns.indexOf("name")] = null; // NOT NULL
    bucket.objects.set(key, JSON.stringify(payload));
    const broken = await staff().platform.backup.drill({ companyId, sourceRunId: run.id });
    expect(broken.status).toBe("failed");
    expect(broken.error).toMatch(/^Restore of customer failed/);

    bucket.objects.delete(key);
    const missing = await staff().platform.backup.drill({ companyId, sourceRunId: run.id });
    expect(missing).toMatchObject({ status: "failed", error: "The export object is missing from the bucket" });

    // The export it tried to restore is still Ok.
    expect((await env.db.select().from(backupRun).where(eq(backupRun.id, run.id)).get())!.status).toBe("succeeded");
  });
});
