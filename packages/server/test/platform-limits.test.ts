/**
 * Per-plant limits set by orrn staff in Godseye (limits brief, section A): the platform write, the
 * tenant guard, the resolve (defaults, clamp) and every handler that checks a settable limit, with one
 * plant changed and another left at the defaults. Real D1 and a Miniflare R2 bucket; the model is the
 * scripted `FakeShapeClient`. Synthetic files only.
 */
import { createHash, randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import { Miniflare } from "miniflare";

import { auditLog, company } from "@orrn/db/schema";
import { fakeResponse, FakeShapeClient, setShapeClientForTests } from "../src/lib/ingest/bot";
import { bandKey, pageKey, rawKey } from "../src/lib/ingest/vault";
import { visionPageKey } from "@orrn/ingest";

import { workersEnv } from "./env-mock";
import { createTestEnv, type TestEnv } from "./harness";
import { plant, putBlocksPicked, upload, type Plant } from "./ingest-portal-helpers";

let env: TestEnv;
let mf: Miniflare;
let bucket: R2Bucket;
let L: typeof import("../src/lib/plantLimits");
let effectiveLimits: typeof import("../src/lib/effectiveLimits").effectiveLimits;
let settingsPatchSql: typeof import("../src/lib/companySettings").settingsPatchSql;

beforeAll(async () => {
  env = await createTestEnv();
  mf = new Miniflare({ modules: true, script: "export default { fetch() { return new Response('ok'); } }", r2Buckets: ["VAULT"] });
  bucket = (await mf.getR2Bucket("VAULT")) as unknown as R2Bucket;
  L = await import("../src/lib/plantLimits");
  effectiveLimits = (await import("../src/lib/effectiveLimits")).effectiveLimits;
  settingsPatchSql = (await import("../src/lib/companySettings")).settingsPatchSql;
}, 60_000);

afterEach(async () => {
  workersEnv.INGEST_VAULT = bucket;
  setShapeClientForTests(null);
  const { setClockForTests } = await import("../src/lib/clock");
  setClockForTests(null);
});

afterAll(async () => {
  delete workersEnv.INGEST_VAULT;
  setShapeClientForTests(null);
  await mf.dispose();
  await env.dispose();
});

const staff = () => env.caller({ platformRole: "support" });
const setLimits = (companyId: string, limits: Record<string, number | null>) => staff().platform.companiesSetLimits({ companyId, limits });
const storedLimits = async (companyId: string): Promise<Record<string, unknown> | undefined> =>
  ((await env.db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).get())?.settings ?? {}).limits as Record<string, unknown> | undefined;

async function failure(p: Promise<unknown>): Promise<{ code?: string; message: string } | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return e as { code?: string; message: string };
  }
}

describe("platform.companiesSetLimits", () => {
  test("sets, raises, lowers and removes a limit; other limits and settings stay", async () => {
    const { companyId } = await env.seedCompany({ settings: { timezone: "Asia/Kolkata" } });
    expect((await setLimits(companyId, { dayModelCostCents: 200, filesPerUpload: 5 })).limits).toEqual({ dayModelCostCents: 200, filesPerUpload: 5 });
    expect((await setLimits(companyId, { dayModelCostCents: 1500 })).limits).toEqual({ dayModelCostCents: 1500, filesPerUpload: 5 });
    // "Use default" removes the key; the plant reads the default again.
    expect((await setLimits(companyId, { filesPerUpload: null })).limits).toEqual({ dayModelCostCents: 1500 });
    expect(await storedLimits(companyId)).toEqual({ dayModelCostCents: 1500 });
    const row = await env.db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).get();
    expect(row!.settings.timezone).toBe("Asia/Kolkata");
    expect((await effectiveLimits({ db: env.db, companyId })).filesPerUpload).toBe(L.PLANT_LIMITS.filesPerUpload.default);
  });

  test("every key accepts its min and its ceiling, and refuses one under the min, 0, a fraction and one above the ceiling", async () => {
    const { companyId } = await env.seedCompany();
    for (const key of L.PLANT_LIMIT_KEYS) {
      const ceiling = L.PLANT_LIMITS[key].ceiling;
      const min = L.limitMin(key);
      expect((await setLimits(companyId, { [key]: min })).limits[key]).toBe(min);
      expect((await setLimits(companyId, { [key]: ceiling })).limits[key]).toBe(ceiling);
      for (const bad of [min - 1, 0, -3, 1.5, ceiling + 1]) {
        const e = await failure(setLimits(companyId, { [key]: bad }));
        expect({ key, bad, code: e?.code }).toEqual({ key, bad, code: "BAD_REQUEST" });
      }
      expect((await storedLimits(companyId))?.[key]).toBe(ceiling);
    }
    await expect(setLimits(companyId, { dayModelCalls: 3001 })).rejects.toThrow("dayModelCalls can be at most 3000");
  });

  test("fix round: the day cost cap cannot go under one vision call's worst case (18 cents)", async () => {
    const { VISION_WORST_COST_MICRO } = await import("../src/lib/ingest/bot");
    expect(L.limitMin("dayModelCostCents")).toBe(Math.ceil(VISION_WORST_COST_MICRO / L.MICRO_PER_CENT));
    expect(L.limitMin("dayModelCostCents")).toBe(18);
    const { companyId } = await env.seedCompany();
    await expect(setLimits(companyId, { dayModelCostCents: 17 })).rejects.toThrow("dayModelCostCents must be a whole number of at least 18");
    expect(await storedLimits(companyId)).toBeUndefined();
    expect((await setLimits(companyId, { dayModelCostCents: 18 })).limits.dayModelCostCents).toBe(18);
    await expect(setLimits(companyId, { dayModelCalls: 0 })).rejects.toThrow("dayModelCalls must be a whole number of at least 1");
    // A value stored under the min before this rule reads as the min, so vision still gets one call.
    expect(L.resolveLimits({ limits: { dayModelCostCents: 5 } }).dayModelCostCents).toBe(18);
    const old = await env.seedCompany({ settings: { limits: { dayModelCostCents: 1 } } });
    expect((await effectiveLimits({ db: env.db, companyId: old.companyId })).dayModelCostCents).toBe(18);
  });

  test("unknown keys are refused and nothing is written", async () => {
    const { companyId } = await env.seedCompany();
    await expect(setLimits(companyId, { dayModelCalls: 50, blocksPerFile: 80 })).rejects.toMatchObject({ code: "BAD_REQUEST", message: "Unknown limit: blocksPerFile" });
    await expect(setLimits(companyId, { maxPageBytes: 5 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await storedLimits(companyId)).toBeUndefined();
  });

  test("writes one audit row with the old and new values; a call that changes nothing writes none", async () => {
    const { companyId } = await env.seedCompany();
    await setLimits(companyId, { dayModelCalls: 120 });
    await setLimits(companyId, { dayModelCalls: 600, rawRowsPerFile: 5000 });
    await setLimits(companyId, { dayModelCalls: 600 });
    await setLimits(companyId, { rawRowsPerFile: null });
    const rows = await env.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.companyId, companyId), eq(auditLog.action, "platform.company.limits.update")))
      .orderBy(auditLog.at);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.meta)).toEqual(
      expect.arrayContaining([
        { from: { dayModelCalls: null }, to: { dayModelCalls: 120 } },
        { from: { dayModelCalls: 120, rawRowsPerFile: null }, to: { dayModelCalls: 600, rawRowsPerFile: 5000 } },
        { from: { rawRowsPerFile: 5000 }, to: { rawRowsPerFile: null } },
      ]),
    );
    expect(rows.every((r) => r.actorId && r.subjectId === companyId)).toBe(true);
  });

  test("N2: the write lands only while the row holds the values the audit names as `from`", async () => {
    const { limitsUnchangedSql, LIMITS_MOVED } = await import("../src/routers/platform/companies");
    const { companyId } = await env.seedCompany({ settings: { limits: { dayModelCalls: 120, filesPerUpload: "lots" } } });
    const matches = async (from: Record<string, number | null>) =>
      (await env.db.select({ id: company.id }).from(company).where(and(eq(company.id, companyId), limitsUnchangedSql(from))).all()).length;
    expect(await matches({ dayModelCalls: 120 })).toBe(1);
    expect(await matches({ dayModelCalls: null })).toBe(0);
    expect(await matches({ dayModelCalls: 600 })).toBe(0);
    // A stored value `setLimits` reads as not set matches null, as the audit records it.
    expect(await matches({ filesPerUpload: null })).toBe(1);
    // Two staff saving one key at once: never two audit rows with the same old value.
    const both = await Promise.allSettled([setLimits(companyId, { dayModelCalls: 200 }), setLimits(companyId, { dayModelCalls: 300 })]);
    for (const r of both) if (r.status === "rejected") expect((r.reason as Error).message).toBe(LIMITS_MOVED);
    const rows = await env.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.companyId, companyId), eq(auditLog.action, "platform.company.limits.update")));
    const froms = rows.map((r) => (r.meta as { from: { dayModelCalls: number | null } }).from.dayModelCalls);
    expect(new Set(froms).size).toBe(froms.length);
  });

  test("plant roles cannot set limits, even the owner of that plant; an unknown plant is Not found", async () => {
    const { companyId } = await env.seedCompany();
    for (const role of ["owner", "admin", "manager"] as const) {
      const e = await failure(env.caller({ role, companyId }).platform.companiesSetLimits({ companyId, limits: { dayModelCalls: 1000 } }));
      expect(e?.code).toBe("FORBIDDEN");
    }
    expect(await storedLimits(companyId)).toBeUndefined();
    await expect(setLimits("no-such-plant", { dayModelCalls: 10 })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("companiesGet returns only the limits the plant has set, not the rest of its settings", async () => {
    const { companyId } = await env.seedCompany({ settings: { letterhead: { legalName: "Synthetic Metals" } } });
    await setLimits(companyId, { visionPagesPerBatch: 12 });
    const got = await staff().platform.companiesGet({ id: companyId });
    expect(got.company.limits).toEqual({ visionPagesPerBatch: 12 });
    expect("settings" in got.company).toBe(false);
  });
});

describe("tenant procedures cannot write settings.limits", () => {
  test("company.updateSettings drops a limits key, for the owner and for staff impersonating the plant", async () => {
    const { companyId } = await env.seedCompany();
    await setLimits(companyId, { dayModelCalls: 50 });
    const owner = env.caller({ role: "owner", companyId });
    await owner.company.updateSettings({ orderLeadDays: 3, limits: { dayModelCalls: 3000, filesPerUpload: 100 } } as never);
    expect(await storedLimits(companyId)).toEqual({ dayModelCalls: 50 });

    const { user, platformAdmin, impersonationGrant } = await import("@orrn/db/schema");
    const staffId = randomUUID();
    await env.db.insert(user).values({ id: staffId, name: "Staff", email: `staff.${staffId}@test.orrn` });
    await env.db.insert(platformAdmin).values({ userId: staffId, role: "admin" });
    await env.db.insert(impersonationGrant).values({ id: randomUUID(), platformAdminId: staffId, companyId, expiresAt: new Date(Date.now() + 10 * 60_000) });
    const acting = env.callerForUser(staffId, { impersonate: companyId });
    const out = await acting.company.updateSettings({ orderLeadDays: 4, limits: { dayModelCalls: 3000 } } as never);
    expect(out.settings.orderLeadDays).toBe(4);
    expect(await storedLimits(companyId)).toEqual({ dayModelCalls: 50 });
  });

  test("settingsPatchSql refuses limits and limits.* keys", () => {
    expect(() => settingsPatchSql({ limits: { dayModelCalls: 9 } })).toThrow("written only by orrn staff");
    expect(() => settingsPatchSql({ "limits.dayModelCalls": 9 })).toThrow("written only by orrn staff");
    expect(() => settingsPatchSql({ limitsNote: 1 })).not.toThrow();
  });
});

describe("resolve: defaults, clamp, bad stored values", () => {
  test("a stored value above the ceiling is clamped; zero, text and unknown keys read as the default", async () => {
    const { companyId } = await env.seedCompany({
      settings: { limits: { dayModelCalls: 999_999, filesPerUpload: 0, rawRowsPerFile: "lots", openRowsPerPlant: 2.5, bogus: 4, blockModelCalls: 6 } },
    });
    const got = await effectiveLimits({ db: env.db, companyId });
    expect(got).toEqual({
      dayModelCalls: L.PLANT_LIMITS.dayModelCalls.ceiling,
      dayModelCostCents: 500,
      blockModelCalls: 6,
      visionPagesPerBatch: 30,
      filesPerUpload: 20,
      rawRowsPerFile: 200_000,
      openRowsPerPlant: 300_000,
      uploadFileMiB: 2_048,
      vaultQuotaGiB: 50,
    });
    expect(L.resolveLimits({})).toEqual({ ...got, dayModelCalls: 300, blockModelCalls: 4 });
    expect(L.resolveLimits(null)).toEqual(L.resolveLimits({ limits: [] }));
  });

  test("the defaults are today's constants", () => {
    expect(L.modelCaps(L.resolveLimits({}))).toEqual({ blockCalls: 4, dayCalls: 300, dayCostMicro: 5_000_000 });
    expect(L.bandReadsFor(500)).toBe(70);
    expect(L.bandReadsFor(100)).toBe(14);
  });
});

// ---------------------------------------------------------------------------
// Handlers read the plant's own values
// ---------------------------------------------------------------------------

const S = "claude-sonnet-5-5";
const HAIKU = "claude-haiku-5-5";
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 0xff, 0xd9]);
const oneTable = () => ({ tables: [{ title: "Party list", headers: ["Party name", "City"], rows: [{ cells: ["Nova Metals", "Rajkot"], confidence: 0.95 }] }] });

async function keptPdf(p: Plant) {
  workersEnv.INGEST_VAULT = bucket;
  const sha = createHash("sha256").update(randomUUID()).digest("hex");
  const bytes = new TextEncoder().encode(`synthetic ${sha}`);
  const begin = await p.owner.ingest.artifact.begin({ sha256: sha, fileName: "stock.pdf", sizeBytes: bytes.byteLength, contentType: "application/pdf", kind: "pdf_scan" });
  await bucket.put(rawKey(p.companyId, sha), bytes);
  await p.owner.ingest.artifact.commitRaw({ artifactId: begin.artifactId });
  return { artifactId: begin.artifactId, sha };
}

async function startedPage(p: Plant, pageCount = 2) {
  const f = await keptPdf(p);
  setShapeClientForTests(new FakeShapeClient([]));
  await p.owner.ingest.vision.start({ artifactId: f.artifactId, pageCount });
  for (let n = 1; n <= pageCount; n++) await bucket.put(pageKey(p.companyId, f.sha, n), JPEG, { httpMetadata: { contentType: "image/jpeg" } });
  return f;
}

const RUN_INSERT =
  "insert into ingest_bot_run (id, company_id, block_id, purpose, model, attempt, outcome, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_micro_usd, duration_ms, created_at) values (?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, ?, 0, ?)";

/** `n` finished shape calls of other blocks today, costing `costEach` micro-USD each. */
async function spentToday(companyId: string, n: number, costEach: number, at: number) {
  const ins = env.d1.prepare(RUN_INSERT);
  await env.d1.batch(Array.from({ length: n }, (_, i) => ins.bind(`run_${randomUUID()}`, companyId, `other_${i}`, "shape", S, 1, "recipe", costEach, at)));
}

async function pinDay() {
  const { setClockForTests } = await import("../src/lib/clock");
  setClockForTests(new Date("2026-11-20T06:00:00Z"));
  return new Date("2026-11-20T05:00:00Z").getTime();
}

describe("model caps per plant (vision.readPage)", () => {
  test("day calls: lowered caps a plant early, raised lets it past 300, another plant keeps 300", async () => {
    const at = await pinDay();
    const low = await plant(env);
    const high = await plant(env);
    const other = await plant(env);
    await setLimits(low.companyId, { dayModelCalls: 5 });
    await setLimits(high.companyId, { dayModelCalls: 400 });
    await spentToday(low.companyId, 5, 0, at);
    await spentToday(high.companyId, 300, 0, at);
    await spentToday(other.companyId, 300, 0, at);

    const fl = await startedPage(low);
    const fh = await startedPage(high);
    const fo = await startedPage(other);
    setShapeClientForTests(new FakeShapeClient([fakeResponse(oneTable(), { modelUsed: S })]));
    expect(await low.owner.ingest.vision.readPage({ artifactId: fl.artifactId, page: 1 })).toMatchObject({ state: "not_read", reason: "cap_day_calls" });
    expect(await other.owner.ingest.vision.readPage({ artifactId: fo.artifactId, page: 1 })).toMatchObject({ state: "not_read", reason: "cap_day_calls" });
    expect(await high.owner.ingest.vision.readPage({ artifactId: fh.artifactId, page: 1 })).toMatchObject({ state: "read" });
  });

  test("day cost: lowered to 1 USD caps after 1 USD, raised to 15 USD reads past 5 USD, another plant keeps 5 USD", async () => {
    const at = await pinDay();
    const low = await plant(env);
    const high = await plant(env);
    const other = await plant(env);
    await setLimits(low.companyId, { dayModelCostCents: 100 });
    await setLimits(high.companyId, { dayModelCostCents: 1500 });
    await spentToday(low.companyId, 1, 1_000_000, at);
    await spentToday(high.companyId, 1, 5_000_000, at);
    await spentToday(other.companyId, 1, 5_000_000, at);

    const fl = await startedPage(low);
    const fh = await startedPage(high);
    const fo = await startedPage(other);
    setShapeClientForTests(new FakeShapeClient([fakeResponse(oneTable(), { modelUsed: S })]));
    expect(await low.owner.ingest.vision.readPage({ artifactId: fl.artifactId, page: 1 })).toMatchObject({ state: "not_read", reason: "cap_day_cost" });
    expect(await other.owner.ingest.vision.readPage({ artifactId: fo.artifactId, page: 1 })).toMatchObject({ state: "not_read", reason: "cap_day_cost" });
    expect(await high.owner.ingest.vision.readPage({ artifactId: fh.artifactId, page: 1 })).toMatchObject({ state: "read" });
  });

  test("calls per block: a page with four calls the ladder would still escalate is capped at 4, read at 5", async () => {
    const at = await pinDay();
    const raised = await plant(env);
    const other = await plant(env);
    await setLimits(raised.companyId, { blockModelCalls: 5 });
    const seedPage = async (p: Plant, artifactId: string) => {
      const ins = env.d1.prepare(RUN_INSERT);
      const outcomes = ["error", "invalid", "error", "invalid"];
      await env.d1.batch(outcomes.map((o, i) => ins.bind(`run_${randomUUID()}`, p.companyId, visionPageKey(artifactId, 1), "vision", HAIKU, i + 1, o, 0, at + i)));
    };
    const fr = await startedPage(raised);
    const fo = await startedPage(other);
    await seedPage(raised, fr.artifactId);
    await seedPage(other, fo.artifactId);
    const client = new FakeShapeClient([fakeResponse(oneTable(), { modelUsed: S })]);
    setShapeClientForTests(client);
    expect(await other.owner.ingest.vision.readPage({ artifactId: fo.artifactId, page: 1 })).toMatchObject({ state: "not_read", reason: "cap_page" });
    expect(client.calls).toHaveLength(0);
    expect(await raised.owner.ingest.vision.readPage({ artifactId: fr.artifactId, page: 1 })).toMatchObject({ state: "read" });
    expect(client.calls).toHaveLength(1);
  });
});

describe("model caps per plant: the other call sites", () => {
  test("calls per block lowered to 1: a page with one call the ladder would escalate is capped; another plant reads it", async () => {
    const at = await pinDay();
    const low = await plant(env);
    const other = await plant(env);
    await setLimits(low.companyId, { blockModelCalls: 1 });
    const fl = await startedPage(low);
    const fo = await startedPage(other);
    const ins = env.d1.prepare(RUN_INSERT);
    for (const [p, f] of [[low, fl], [other, fo]] as const) {
      await ins.bind(`run_${randomUUID()}`, p.companyId, visionPageKey(f.artifactId, 1), "vision", HAIKU, 1, "invalid", 0, at).run();
    }
    const client = new FakeShapeClient([fakeResponse(oneTable(), { modelUsed: S })]);
    setShapeClientForTests(client);
    expect(await low.owner.ingest.vision.readPage({ artifactId: fl.artifactId, page: 1 })).toMatchObject({ state: "not_read", reason: "cap_page" });
    expect(client.calls).toHaveLength(0);
    expect(await other.owner.ingest.vision.readPage({ artifactId: fo.artifactId, page: 1 })).toMatchObject({ state: "read" });
    expect(client.calls).toHaveLength(1);
  });

  test("a band read follows the plant's day calls", async () => {
    const at = await pinDay();
    const low = await plant(env);
    const other = await plant(env);
    await setLimits(low.companyId, { dayModelCalls: 2 });
    await spentToday(low.companyId, 2, 0, at);
    await spentToday(other.companyId, 2, 0, at);
    const banded = async (p: Plant) => {
      const f = await keptPdf(p);
      setShapeClientForTests(new FakeShapeClient([]));
      await p.owner.ingest.vision.start({ artifactId: f.artifactId, pageCount: 1 });
      await p.owner.ingest.vision.bandTickets({ artifactId: f.artifactId, page: 1, bands: 2 });
      for (const k of [1, 2]) await bucket.put(bandKey(p.companyId, f.sha, 1, k), JPEG, { httpMetadata: { contentType: "image/jpeg" } });
      return f;
    };
    const fl = await banded(low);
    const fo = await banded(other);
    const client = new FakeShapeClient([fakeResponse(oneTable(), { modelUsed: S })]);
    setShapeClientForTests(client);
    await low.owner.ingest.vision.readPage({ artifactId: fl.artifactId, page: 1, band: 1 });
    expect(client.calls).toHaveLength(0);
    const capped = await env.d1
      .prepare("select outcome, error_codes from ingest_bot_run where company_id = ? and purpose = 'vision'")
      .bind(low.companyId)
      .all<{ outcome: string; error_codes: string | null }>();
    expect(capped.results).toEqual([{ outcome: "capped", error_codes: JSON.stringify(["cap:day_calls"]) }]);
    await other.owner.ingest.vision.readPage({ artifactId: fo.artifactId, page: 1, band: 1 });
    expect(client.calls).toHaveLength(1);
  });

  test("shape.make (the sheet layout call) follows the plant's day calls, claim included", async () => {
    // The shape call counts the day on the real clock (it passes no clock of its own).
    const at = Date.now() - 1_000;
    const low = await plant(env);
    const other = await plant(env);
    await setLimits(low.companyId, { dayModelCalls: 3 });
    await spentToday(low.companyId, 3, 0, at);
    await spentToday(other.companyId, 3, 0, at);
    const sheet = { headers: ["Khata", "Gaam"], rows: [["Acme", "Surat"], ["Bharat", "Rajkot"]] };
    const client = new FakeShapeClient([fakeResponse({ result: { kind: "no_target", reason: "none" } }), fakeResponse({ result: { kind: "no_target", reason: "none" } })]);
    setShapeClientForTests(client);
    const make = async (p: Plant) => {
      const { candidates } = await upload(p.admin, [sheet]);
      const c = candidates[0]!;
      return failure(p.admin.ingest.shape.make({ candidateId: c.id, expectSeq: c.serverSeq }));
    };
    await make(low);
    expect(client.calls).toHaveLength(0);
    const lowRuns = await env.d1.prepare("select outcome from ingest_bot_run where company_id = ? and purpose = 'shape' and outcome = 'capped'").bind(low.companyId).all();
    expect(lowRuns.results).toHaveLength(1);
    await make(other);
    expect(client.calls).toHaveLength(1);

    // Raised past what is spent, the same plant makes the call.
    await setLimits(low.companyId, { dayModelCalls: 10 });
    await make(low);
    expect(client.calls).toHaveLength(2);
  });
});

describe("pages per batch (vision.start and the page calls)", () => {
  test("lowered and raised plans; the page past the plan is refused; zod stops at the ceiling; another plant plans 30", async () => {
    const low = await plant(env);
    const high = await plant(env);
    const other = await plant(env);
    await setLimits(low.companyId, { visionPagesPerBatch: 5 });
    await setLimits(high.companyId, { visionPagesPerBatch: 40 });
    setShapeClientForTests(new FakeShapeClient([]));
    const fl = await keptPdf(low);
    const fh = await keptPdf(high);
    const fo = await keptPdf(other);
    expect((await low.owner.ingest.vision.start({ artifactId: fl.artifactId, pageCount: 45 })).planned).toBe(5);
    expect((await high.owner.ingest.vision.start({ artifactId: fh.artifactId, pageCount: 45 })).planned).toBe(40);
    expect((await other.owner.ingest.vision.start({ artifactId: fo.artifactId, pageCount: 45 })).planned).toBe(30);
    expect((await high.owner.ingest.vision.pages({ artifactId: fh.artifactId })).pages).toHaveLength(40);

    await expect(low.owner.ingest.vision.readPage({ artifactId: fl.artifactId, page: 6 })).rejects.toThrow("This page is past the pages read for this file");
    await expect(high.owner.ingest.vision.skipPage({ artifactId: fh.artifactId, page: 40 })).resolves.toBeTruthy();
    const e = await failure(high.owner.ingest.vision.skipPage({ artifactId: fh.artifactId, page: L.VISION_PAGES_CEILING + 1 }));
    expect(e?.code).toBe("BAD_REQUEST");

    // A plan already written keeps its own size when staff change the limit later.
    await setLimits(low.companyId, { visionPagesPerBatch: 20 });
    expect((await low.owner.ingest.vision.start({ artifactId: fl.artifactId, pageCount: 45 })).planned).toBe(5);
  });
});

describe("rows per file (artifact.putBlocks)", () => {
  const blocks = (n: number, rowCount: number) =>
    Array.from({ length: n }, (_, ordinal) => ({
      ordinal,
      sheetName: `Sheet${ordinal + 1}`,
      title: null,
      headerRow: 0,
      headerRows: 1,
      headers: ["Party name", "City"],
      rowCount,
      sample: [["Nova Metals", "Rajkot"]],
    }));
  const begin = (p: Plant) =>
    p.owner.ingest.artifact.begin({ sha256: createHash("sha256").update(randomUUID()).digest("hex"), fileName: "book.xlsx", sizeBytes: 1000, contentType: null, kind: "sheet" });

  test("lowered refuses a small file with the plant's number; raised takes 210,000 rows; another plant keeps 200,000", async () => {
    const low = await plant(env);
    const high = await plant(env);
    const other = await plant(env);
    await setLimits(low.companyId, { rawRowsPerFile: 2 });
    await setLimits(high.companyId, { rawRowsPerFile: 250_000 });

    await expect(upload(low.owner, [{ headers: ["Party name", "City"], rows: [["A", "B"], ["C", "D"], ["E", "F"]] }])).rejects.toThrow("has more than 2 rows");
    await expect(upload(low.owner, [{ headers: ["Party name", "City"], rows: [["A", "B"], ["C", "D"]] }])).resolves.toBeTruthy();

    const a = await begin(other);
    await expect(putBlocksPicked(other.owner, { artifactId: a.artifactId, blocks: blocks(5, 42_000) })).rejects.toThrow("has more than 200,000 rows");
    const b = await begin(high);
    await expect(putBlocksPicked(high.owner, { artifactId: b.artifactId, blocks: blocks(5, 42_000) })).resolves.toBeTruthy();
  });
});

describe("open rows per plant (artifact.begin)", () => {
  const begin = (p: Plant) =>
    p.owner.ingest.artifact.begin({ sha256: createHash("sha256").update(randomUUID()).digest("hex"), fileName: "book.xlsx", sizeBytes: 1000, contentType: null, kind: "sheet" });
  const WAITING = "Too many rows are waiting. Merge or discard older imports first.";

  test("lowered refuses at the plant's number; raised past 300,000 takes the file; another plant keeps 300,000", async () => {
    const low = await plant(env);
    await setLimits(low.companyId, { openRowsPerPlant: 3 });
    await upload(low.owner, [{ headers: ["Party name", "City"], rows: [["A", "B"], ["C", "D"], ["E", "F"]] }]);
    await expect(begin(low)).rejects.toThrow(WAITING);
    await setLimits(low.companyId, { openRowsPerPlant: 10 });
    await expect(begin(low)).resolves.toBeTruthy();

    // 300,000 rows waiting: refused at the default, taken when staff raise the limit.
    const { ingestCandidate } = await import("@orrn/db/schema/ingest");
    const high = await plant(env);
    const other = await plant(env);
    for (const p of [high, other]) {
      const { candidates } = await upload(p.owner, [{ headers: ["Party name", "City"], rows: [["A", "B"]] }]);
      await env.db.update(ingestCandidate).set({ rowsTotal: 300_000 }).where(eq(ingestCandidate.id, candidates[0]!.id));
    }
    await setLimits(high.companyId, { openRowsPerPlant: 400_000 });
    await expect(begin(other)).rejects.toThrow(WAITING);
    await expect(begin(high)).resolves.toBeTruthy();
  });
});

describe("ingest.status sends the plant's own values", () => {
  test("files per upload, rows, open rows and pages per batch; another plant reads the defaults", async () => {
    const a = await plant(env);
    const b = await plant(env);
    await setLimits(a.companyId, { filesPerUpload: 3, rawRowsPerFile: 9000, openRowsPerPlant: 50_000, visionPagesPerBatch: 12 });
    const sa = await a.owner.ingest.status();
    expect(sa.limits).toMatchObject({ filesPerUpload: 3, rawRowsPerFile: 9000, openRowsPerPlant: 50_000, cellChars: 200, blocksPerFile: 200 });
    expect(sa.visionPagesPerBatch).toBe(12);
    const sb = await b.owner.ingest.status();
    expect(sb.limits).toMatchObject({ filesPerUpload: 20, rawRowsPerFile: 200_000, openRowsPerPlant: 300_000 });
    expect(sb.visionPagesPerBatch).toBe(30);
    await setLimits(a.companyId, { filesPerUpload: 60 });
    expect((await a.owner.ingest.status()).limits.filesPerUpload).toBe(60);
  });
});
