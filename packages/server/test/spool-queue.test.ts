/**
 * T24: `spool.queue`, the read-only print queue behind /printing. Rows are
 * seeded straight into the tables; no spool node is contacted.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { labelTemplate, printLog, printerProfile } from "@orrn/db/schema";

import { createTestEnv, D1_MAX_PARAMS, type CompanyRole, type TestEnv } from "./harness";

let env: TestEnv;

beforeAll(async () => {
  env = await createTestEnv();
});

afterAll(async () => {
  await env.dispose();
});

const uid = () => crypto.randomUUID();
const ROLES: CompanyRole[] = [
  "owner", "admin", "manager", "office", "accountant", "supervisor", "packer",
  "foundry", "press", "storekeeper", "die_room", "operator", "viewer",
];

async function seedPrinter(companyId: string, name = "Packing bay") {
  const templateId = uid();
  const profileId = uid();
  await env.db.insert(labelTemplate).values({ id: templateId, companyId, name: `T ${name}`, schema: {} });
  await env.db.insert(printerProfile).values({ id: profileId, companyId, name, spoolPrinterId: "sp1", templateId });
  return { templateId, profileId };
}

type Status = "queued" | "accepted" | "sent" | "success" | "failed" | "outcome_unknown" | "cancelled";
const job = (
  companyId: string,
  refs: { templateId: string; profileId: string },
  status: Status,
  at: number,
  extra: Partial<typeof printLog.$inferInsert> = {},
) => ({ id: uid(), companyId, ...refs, status, createdAt: new Date(at), ...extra });

describe("spool.queue", () => {
  test("lists newest first with printer and bundle, counts every status, filters by status", async () => {
    const { companyId } = await env.seedCompany();
    const dieId = await env.seedDie(companyId);
    const [bundleRow] = await env.seedBundles(companyId, dieId, 1);
    const refs = await seedPrinter(companyId);
    const base = Date.parse("2026-10-20T10:00:00Z");
    await env.db.insert(printLog).values([
      job(companyId, refs, "success", base),
      job(companyId, refs, "failed", base + 1000, { responseText: "Printer offline", bundleId: bundleRow!.id, attempt: 2 }),
      job(companyId, refs, "queued", base + 2000),
      job(companyId, refs, "sent", base + 3000),
      job(companyId, refs, "failed", base + 4000),
      job(companyId, refs, "accepted", base + 5000),
      job(companyId, refs, "outcome_unknown", base + 6000),
      job(companyId, refs, "cancelled", base + 7000),
    ]);

    const viewer = env.caller({ role: "viewer", companyId });
    const all = await viewer.spool.queue({});
    expect(all.total).toBe(8);
    expect(all.counts).toEqual({ queued: 1, accepted: 1, sent: 1, success: 1, failed: 2, outcome_unknown: 1, cancelled: 1 });
    expect(all.rows.map((r) => r.status)).toEqual(["cancelled", "outcome_unknown", "accepted", "failed", "sent", "queued", "failed", "success"]);
    expect(all.rows.every((r) => r.profileName === "Packing bay")).toBe(true);

    const failed = await viewer.spool.queue({ status: "failed" });
    expect(failed.total).toBe(2);
    expect(failed.rows.length).toBe(2);
    const withBundle = failed.rows.find((r) => r.bundleSerial !== null);
    expect(withBundle?.responseText).toBe("Printer offline");
    expect(withBundle?.attempt).toBe(2);
    // The label variables and the spool job id stay on the server.
    expect(Object.keys(failed.rows[0]!)).not.toContain("variables");
    expect(Object.keys(failed.rows[0]!)).not.toContain("spoolJobId");

    const unknown = await viewer.spool.queue({ status: "outcome_unknown" });
    expect(unknown.total).toBe(1);
    expect(unknown.rows.map((row) => row.status)).toEqual(["outcome_unknown"]);
    expect(unknown.counts.outcome_unknown).toBe(1);

    const page = await viewer.spool.queue({ limit: 2, offset: 6 });
    expect(page.rows.length).toBe(2);
    expect(page.total).toBe(8);
  });

  test("an empty plant returns an empty queue with zero counts", async () => {
    const { companyId } = await env.seedCompany();
    const res = await env.caller({ role: "owner", companyId }).spool.queue({});
    expect(res).toEqual({ rows: [], total: 0, counts: { queued: 0, accepted: 0, sent: 0, success: 0, failed: 0, outcome_unknown: 0, cancelled: 0 } });
  });

  test("another plant's jobs are never listed or counted", async () => {
    const a = await env.seedCompany();
    const b = await env.seedCompany();
    const refsA = await seedPrinter(a.companyId, "A printer");
    const refsB = await seedPrinter(b.companyId, "B printer");
    await env.db.insert(printLog).values([
      job(a.companyId, refsA, "failed", Date.now()),
      job(b.companyId, refsB, "failed", Date.now()),
      job(b.companyId, refsB, "queued", Date.now()),
    ]);
    const res = await env.caller({ role: "manager", companyId: a.companyId }).spool.queue({});
    expect(res.total).toBe(1);
    expect(res.counts.failed).toBe(1);
    expect(res.rows.map((r) => r.profileName)).toEqual(["A printer"]);
  });

  test("every company role holds spool.view_queue; a signed-out caller does not", async () => {
    const { companyId } = await env.seedCompany();
    for (const role of ROLES) {
      await expect(env.caller({ role, companyId }).spool.queue({})).resolves.toMatchObject({ total: 0 });
    }
    await expect(env.caller(null).spool.queue({})).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  test("a full page of 100 jobs stays within the bound-parameter limit", async () => {
    const { companyId } = await env.seedCompany();
    const refs = await seedPrinter(companyId);
    const at = Date.now();
    // 12 columns per row: seed in chunks that respect the bound-parameter limit too.
    for (let from = 0; from < 120; from += 5) {
      await env.db
        .insert(printLog)
        .values(Array.from({ length: 5 }, (_, i) => job(companyId, refs, "success", at + from + i)));
    }
    env.resetPeakParams();
    const res = await env.caller({ role: "operator", companyId }).spool.queue({ limit: 100 });
    expect(res.rows.length).toBe(100);
    expect(res.total).toBe(120);
    expect(env.peakParams()).toBeLessThanOrEqual(D1_MAX_PARAMS);
  });
});
