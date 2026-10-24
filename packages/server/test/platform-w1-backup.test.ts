/**
 * FP-PF-12 backups and the restore drill (platform spec §3 backup_run, §4 Backups, §6 Backup):
 * export excludes secrets, a drill restores into a suspended `restore-drill-{date}` company and
 * compares customer/die/bundle/dispatch, every failure path leaves a failed run and the previous
 * Ok object untouched. R2 is a fake bucket here (`workersEnv.BACKUPS`).
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";

import { auditLog, backupRun, bundle, company, customer, die, dispatch, dispatchItem, invite, session } from "@orrn/db/schema";
import { and, count, eq } from "drizzle-orm";

import { workersEnv } from "./env-mock";
import { createTestEnv, type TestEnv } from "./harness";

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

  test("failure: R2 error or no bucket -> failed run with a note; the previous Ok run and object stay", async () => {
    const bucket = bindBucket();
    const { companyId } = await seedPlant();
    const ok = await staff().platform.backup.run({ companyId });
    const objects = bucket.objects.size;

    bucket.failPut = true;
    const failed = await staff().platform.backup.run({ companyId });
    expect(failed).toMatchObject({ status: "failed", error: "R2 put failed: 503" });
    expect(bucket.objects.size).toBe(objects);

    delete workersEnv.BACKUPS;
    const unbound = await staff().platform.backup.run({ companyId });
    expect(unbound).toMatchObject({ status: "failed" });
    expect(unbound.error).toContain("No backup bucket");

    const status = await env.caller({ role: "admin", companyId }).backup.status();
    expect(status.lastOk?.id).toBe(ok.id);
    expect(status.lastAttempt).toMatchObject({ id: unbound.id, status: "failed" });
    const okRow = await env.db.select().from(backupRun).where(eq(backupRun.id, ok.id)).get();
    expect(okRow!.status).toBe("succeeded");
  });

  test("the daily job exports each active company once per IST day", async () => {
    bindBucket();
    const { companyId } = await seedPlant();
    const { runScheduledBackups } = await import("../src/lib/backup");
    const at = new Date();
    const first = await runScheduledBackups(env.db, at);
    expect(first.find((r) => r.companyId === companyId)?.status).toBe("succeeded");
    const second = await runScheduledBackups(env.db, at);
    expect(second.find((r) => r.companyId === companyId)?.status).toBe("skipped");
    const runs = await env.db
      .select()
      .from(backupRun)
      .where(and(eq(backupRun.companyId, companyId), eq(backupRun.kind, "scheduled")));
    expect(runs).toHaveLength(1);
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
