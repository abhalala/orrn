/**
 * Infinity Portal merge, lane B (plan C2 row B): each target's adapter writes through the real
 * procedure via `createCaller`, records the live id on the staged row, and every audit row it
 * writes carries `meta.source` (plan A6). Orders are in ingest-merge-orders.test.ts.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { createTestEnv, type TestEnv } from "./harness";
import { apiFor, auditRows, candidateRow, contextFor, mergeAll, seedCandidate, stagedRows, wireMergeEngine } from "./ingest-merge-fixture";

let env: TestEnv;

beforeAll(async () => {
  env = await createTestEnv();
  await wireMergeEngine();
}, 60_000);

afterAll(async () => {
  await env.dispose();
});

async function adminApi(companyId: string) {
  return apiFor(await contextFor(env, companyId, "admin"));
}

function expectSource(meta: unknown, seeded: { candidateId: string; artifactId: string; blockId: string }, runId: string) {
  const source = (meta as { source?: Record<string, unknown> }).source;
  expect(source).toBeDefined();
  expect(source).toMatchObject({ candidateId: seeded.candidateId, artifactId: seeded.artifactId, blockId: seeded.blockId, mergeRunId: runId });
  expect(String(source!.chunkId)).toMatch(/^ing-[0-9a-f]{40}$/);
  expect(typeof source!.rowFrom).toBe("number");
  expect(typeof source!.rowTo).toBe("number");
}

describe("customers", () => {
  test("new customers go through customer.importCsv; the rows record the new ids", async () => {
    const { companyId } = await env.seedCompany();
    const api = await adminApi(companyId);
    const seeded = await seedCandidate(env, companyId, "customers", [
      { values: { name: "Acme Extrusions", city: "Rajkot", phone: "98250 11234", taxId: "24ABCDE1234F1Z5" } },
      { values: { name: "Bharat Profiles", email: "office@bharat.test" } },
    ]);
    const res = await mergeAll(api);
    expect(res.state).toBe("done");
    expect(res.chunksWritten).toBe(1);

    const rows = await stagedRows(env, seeded.candidateId);
    expect(rows.map((r) => [r.mergeState, r.committedType])).toEqual([
      ["written", "customer"],
      ["written", "customer"],
    ]);
    const live = await api.customer.get({ id: rows[0]!.committedId! });
    expect(live).toMatchObject({ name: "Acme Extrusions", phone: "98250 11234", taxId: "24ABCDE1234F1Z5", billingAddress: { city: "Rajkot" } });
    expect((await api.customer.get({ id: rows[1]!.committedId! })).email).toBe("office@bharat.test");

    const c = await candidateRow(env, seeded.candidateId);
    expect(c.state).toBe("merged");
    expect(c.rowsWritten).toBe(2);
    expect(c.recipeLocked).toBe(true);

    const [audit] = await auditRows(env, companyId, "customer.import");
    expectSource(audit!.meta, seeded, res.runId);
    expect((audit!.meta as { source: { rowFrom: number; rowTo: number } }).source).toMatchObject({ rowFrom: 0, rowTo: 1 });
  });

  test("a name added since the dry run is not added twice (plan D7)", async () => {
    const { companyId } = await env.seedCompany();
    const api = await adminApi(companyId);
    const made = await api.customer.create({ name: "Classic Alu" });
    const seeded = await seedCandidate(env, companyId, "customers", [{ values: { name: "CLASSIC ALU." } }, { values: { name: "Delta Metals" } }]);
    expect((await mergeAll(api)).state).toBe("done");
    const rows = await stagedRows(env, seeded.candidateId);
    expect(rows[0]!.committedId).toBe(made.id);
    const list = await api.customer.list({ limit: 100 });
    expect(list.items.map((c) => c.name).sort()).toEqual(["Classic Alu", "Delta Metals"]);
  });

  test("a fills-blanks update goes through customer.update and keeps every other field", async () => {
    const { companyId } = await env.seedCompany();
    const api = await adminApi(companyId);
    const made = await api.customer.create({ name: "Elite Windows", email: "a@elite.test", notes: "keep me" });
    const seeded = await seedCandidate(env, companyId, "customers", [
      { state: "ready_update", matchId: made.id, values: { name: "Elite Windows", phone: "12345" }, diff: { phone: { live: null, file: "12345" } } },
    ]);
    const res = await mergeAll(api);
    expect(res.state).toBe("done");
    const live = await api.customer.get({ id: made.id });
    expect(live).toMatchObject({ name: "Elite Windows", phone: "12345", email: "a@elite.test", notes: "keep me" });
    const rows = await stagedRows(env, seeded.candidateId);
    expect(rows[0]).toMatchObject({ mergeState: "written", committedType: "customer", committedId: made.id });
    const audits = await auditRows(env, companyId, "customer.update");
    expect(audits).toHaveLength(1);
    expectSource(audits[0]!.meta, seeded, res.runId);
  });
});

describe("customer_aliases", () => {
  test("other names go through customer.addAliases", async () => {
    const { companyId } = await env.seedCompany();
    const api = await adminApi(companyId);
    const made = await api.customer.create({ name: "Fortune Aluminium" });
    const seeded = await seedCandidate(env, companyId, "customer_aliases", [
      { values: { customer: "Fortune Aluminium", alias: "Fortune Alu Pvt Ltd", _ids: { customer: made.id } } },
      { values: { customer: "Fortune Aluminium", alias: "FORTUNE", _ids: { customer: made.id } } },
    ]);
    const res = await mergeAll(api);
    expect(res.state).toBe("done");
    const { customerAlias } = await import("@orrn/db/schema/customers");
    const { eq } = await import("drizzle-orm");
    const aliases = await env.db.select().from(customerAlias).where(eq(customerAlias.customerId, made.id));
    expect(aliases.map((a) => a.aliasKey).sort()).toEqual(["fortune", "fortunealupvtltd"]);
    const rows = await stagedRows(env, seeded.candidateId);
    expect(rows.map((r) => r.committedType)).toEqual(["customer_alias", "customer_alias"]);
    expect(new Set(rows.map((r) => r.committedId))).toEqual(new Set(aliases.map((a) => a.id)));
    const [audit] = await auditRows(env, companyId, "customer.aliases.add");
    expectSource(audit!.meta, seeded, res.runId);
  });
});

describe("vendors and vendor_aliases", () => {
  test("vendors go through vendor.create one per call, with their aliases", async () => {
    const { companyId } = await env.seedCompany();
    const api = await adminApi(companyId);
    const seeded = await seedCandidate(env, companyId, "vendors", [
      { values: { name: "Shree Scrap Traders", city: "Morbi", aliases: "Shree Scrap; S S Traders" } },
      { values: { name: "Ganesh Metals" } },
    ]);
    const res = await mergeAll(api);
    expect(res.state).toBe("done");
    const rows = await stagedRows(env, seeded.candidateId);
    expect(rows.every((r) => r.mergeState === "written" && r.committedType === "vendor")).toBe(true);
    const got = await api.vendor.get({ id: rows[0]!.committedId! });
    expect(got.vendor).toMatchObject({ name: "Shree Scrap Traders", city: "Morbi", status: "active" });
    expect(got.aliases.map((a) => a.alias).sort()).toEqual(["S S Traders", "Shree Scrap"]);
    const audits = await auditRows(env, companyId, "vendor.create");
    expect(audits).toHaveLength(2);
    for (const a of audits) expectSource(a.meta, seeded, res.runId);
    // One call per row: each audit row names its own row.
    expect(audits.map((a) => (a.meta as { source: { rowFrom: number } }).source.rowFrom).sort()).toEqual([0, 1]);
  });

  test("vendor aliases go through vendor.addAlias", async () => {
    const { companyId } = await env.seedCompany();
    const api = await adminApi(companyId);
    const v = await api.vendor.create({ name: "Hari Om Scrap" });
    const seeded = await seedCandidate(env, companyId, "vendor_aliases", [
      { values: { vendor: "Hari Om Scrap", alias: "HariOm", _ids: { vendor: v.id } } },
    ]);
    const res = await mergeAll(api);
    expect(res.state).toBe("done");
    const got = await api.vendor.get({ id: v.id });
    expect(got.aliases.map((a) => a.alias)).toEqual(["HariOm"]);
    const [row] = await stagedRows(env, seeded.candidateId);
    expect(row).toMatchObject({ committedType: "vendor_alias", committedId: got.aliases[0]!.id });
    const [audit] = await auditRows(env, companyId, "vendor.alias.add");
    expectSource(audit!.meta, seeded, res.runId);
  });
});

describe("dies", () => {
  test("new and updated sections go through die.processImport in one call", async () => {
    const { companyId } = await env.seedCompany();
    const api = await adminApi(companyId);
    const existing = await env.seedDie(companyId, { series: "R", sectionCode: "2200", weightMinG: 3000, weightMaxG: 3400 });
    const seeded = await seedCandidate(env, companyId, "dies", [
      { values: { series: "R", sectionCode: "2105", weightMinG: 2000, weightMaxG: 2400, widthMm: 25.4, name: "Angle" } },
      {
        state: "ready_update",
        matchId: existing,
        values: { series: "R", sectionCode: "2200", weightMinG: 9000, weightMaxG: 9900, notes: "from file" },
        diff: { notes: { live: null, file: "from file" } },
      },
    ]);
    const res = await mergeAll(api);
    expect(res.state).toBe("done");
    const rows = await stagedRows(env, seeded.candidateId);
    expect(rows.map((r) => r.committedType)).toEqual(["die", "die"]);
    expect(rows[1]!.committedId).toBe(existing);
    const made = await api.die.get({ id: rows[0]!.committedId! });
    expect(made).toMatchObject({ series: "R", sectionCode: "2105", weightMinG: 2000, weightMaxG: 2400, widthMm: 25.4, name: "Angle" });
    // Fills blanks only: the weights stay as orrn has them.
    const updated = await api.die.get({ id: existing });
    expect(updated).toMatchObject({ notes: "from file", weightMinG: 3000, weightMaxG: 3400 });
    const [audit] = await auditRows(env, companyId, "die.import");
    expectSource(audit!.meta, seeded, res.runId);
  });
});

describe("die_copies", () => {
  test("copies go through dieInstance.create one per call", async () => {
    const { companyId } = await env.seedCompany();
    const api = await adminApi(companyId);
    const dieId = await env.seedDie(companyId, { series: "R", sectionCode: "3101" });
    const seeded = await seedCandidate(env, companyId, "die_copies", [
      { values: { series: "R", sectionCode: "3101", makerDieNo: "MK-77", supplier: "Precision Dies", lifeKg: 50_000_000, _ids: { sectionCode: dieId } } },
      { values: { series: "R", sectionCode: "3101", makerDieNo: "MK-78", tierRank: 2, _ids: { sectionCode: dieId } } },
    ]);
    const res = await mergeAll(api);
    expect(res.state).toBe("done");
    const rows = await stagedRows(env, seeded.candidateId);
    expect(rows.map((r) => r.committedType)).toEqual(["die_instance", "die_instance"]);
    const { dieInstance } = await import("@orrn/db/schema/dies");
    const { eq } = await import("drizzle-orm");
    const copies = await env.db.select().from(dieInstance).where(eq(dieInstance.sectionId, dieId));
    expect(copies.map((c) => c.makerDieNo).sort()).toEqual(["MK-77", "MK-78"]);
    expect(copies.find((c) => c.makerDieNo === "MK-77")).toMatchObject({ supplier: "Precision Dies", lifeG: 50_000_000, id: rows[0]!.committedId! });
    expect(copies.find((c) => c.makerDieNo === "MK-78")!.tierRank).toBe(2);
    const audits = await auditRows(env, companyId, "die_instance.create");
    expect(audits).toHaveLength(2);
    for (const a of audits) expectSource(a.meta, seeded, res.runId);
  });
});

describe("die_copies updates", () => {
  test("a fills-blanks update goes through dieInstance.update and never moves the tier", async () => {
    const { companyId } = await env.seedCompany();
    const api = await adminApi(companyId);
    const dieId = await env.seedDie(companyId, { series: "R", sectionCode: "3300" });
    const copy = await api.dieInstance.create({ sectionId: dieId, makerDieNo: "UP-1", tierRank: 1 });
    const seeded = await seedCandidate(env, companyId, "die_copies", [
      {
        state: "ready_update",
        matchId: copy.id,
        values: { series: "R", sectionCode: "3300", makerDieNo: "UP-1", supplier: "Maker Two", tierRank: 5, _ids: { sectionCode: dieId } },
        diff: { supplier: { live: null, file: "Maker Two" }, tierRank: { live: 1, file: 5 } },
      },
    ]);
    const res = await mergeAll(api);
    expect(res.state).toBe("done");
    const { dieInstance } = await import("@orrn/db/schema/dies");
    const { eq } = await import("drizzle-orm");
    const [after] = await env.db.select().from(dieInstance).where(eq(dieInstance.id, copy.id));
    expect(after).toMatchObject({ supplier: "Maker Two", tierRank: 1 });
    expect((await stagedRows(env, seeded.candidateId))[0]).toMatchObject({ committedType: "die_instance", committedId: copy.id });
    const [audit] = await auditRows(env, companyId, "die_instance.update");
    expectSource(audit!.meta, seeded, res.runId);
  });
});

describe("bundles", () => {
  test("bundles go through bundle.bulkImport; legacy ids land in legacy_bundle_map in the same call", async () => {
    const { companyId } = await env.seedCompany();
    const api = await adminApi(companyId);
    const dieId = await env.seedDie(companyId, { series: "R", sectionCode: "4100" });
    const seeded = await seedCandidate(env, companyId, "bundles", [
      // The file says "r 4100"; the resolved section's own series and code are sent.
      { values: { legacyId: "ckold000000000000000000001", series: "r", sectionCode: "4100", quantity: 12, weightG: 24_500, lengthMm: 3658, _ids: { sectionCode: dieId } } },
      { values: { legacyId: "ckold000000000000000000002", series: "Z", sectionCode: "OLD9", quantity: 5, weightG: 9_000, lengthMm: 3658, legacyDie: true } },
    ]);
    const res = await mergeAll(api);
    expect(res.state).toBe("done");
    const rows = await stagedRows(env, seeded.candidateId);
    expect(rows.map((r) => r.committedType)).toEqual(["bundle", "bundle"]);
    const { bundle } = await import("@orrn/db/schema/inventory");
    const { legacyBundleMap } = await import("@orrn/db/schema/legacy");
    const { die } = await import("@orrn/db/schema/catalog");
    const { and, eq } = await import("drizzle-orm");
    const [first] = await env.db.select().from(bundle).where(eq(bundle.id, rows[0]!.committedId!));
    expect(first).toMatchObject({ dieId, quantity: 12, weightG: 24_500, lengthMm: 3658, status: "available" });
    const maps = await env.db.select().from(legacyBundleMap).where(eq(legacyBundleMap.companyId, companyId));
    expect(maps.map((m) => [m.legacyId, m.bundleId]).sort()).toEqual(
      [
        ["ckold000000000000000000001", rows[0]!.committedId!],
        ["ckold000000000000000000002", rows[1]!.committedId!],
      ].sort(),
    );
    const [legacy] = await env.db.select().from(die).where(and(eq(die.companyId, companyId), eq(die.sectionCode, "OLD9")));
    expect(legacy!.name).toContain("LEGACY");
    const [audit] = await auditRows(env, companyId, "bundle.import");
    expectSource(audit!.meta, seeded, res.runId);
  });
});
