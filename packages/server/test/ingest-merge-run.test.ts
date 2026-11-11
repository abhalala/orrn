/**
 * Infinity Portal merge, lane B (plan C2 row B, A5, B7): the run itself. A replayed chunk writes
 * nothing twice; a crash between the call and the state write recovers on resume; a refused chunk
 * holds its candidate with the exact message and its dependants get `dependency_held`; a rerun skips
 * written rows; one run is active per plant; the module gate of the called procedure applies; a
 * second tab is refused; stop ends the run after the step in flight.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { createTestEnv, type TestEnv } from "./harness";
import {
  apiFor,
  auditRows,
  candidateRow,
  contextFor,
  mergeAll,
  pump,
  rewindToCrash,
  seedCandidate,
  stagedRows,
  wireMergeEngine,
} from "./ingest-merge-fixture";

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

async function count(table: "customer" | "vendor" | "bundle" | "die_instance", companyId: string): Promise<number> {
  const row = await env.d1.prepare(`select count(*) as n from ${table} where company_id = ?`).bind(companyId).first<{ n: number }>();
  return Number(row?.n ?? 0);
}

describe("crash between the call and the state write", () => {
  test("customers (one bulk call): the resume answers replayed and records the same ids", async () => {
    const { companyId } = await env.seedCompany();
    const api = await adminApi(companyId);
    const seeded = await seedCandidate(env, companyId, "customers", [{ values: { name: "Indus Alu" } }, { values: { name: "Jai Ambe Metals" } }]);
    const first = await mergeAll(api);
    expect(first.state).toBe("done");
    const before = (await stagedRows(env, seeded.candidateId)).map((r) => r.committedId);
    expect(await count("customer", companyId)).toBe(2);

    const cursor = await rewindToCrash(env, first.runId, seeded.candidateId);
    const again = await pump(api, first.runId, cursor);
    expect(again.state).toBe("done");
    expect(await count("customer", companyId)).toBe(2);
    expect((await stagedRows(env, seeded.candidateId)).map((r) => r.committedId)).toEqual(before);
    expect(await auditRows(env, companyId, "customer.import")).toHaveLength(1);
  });

  test("vendors (one call per row): every call answers replayed; nothing is created twice", async () => {
    const { companyId } = await env.seedCompany();
    const api = await adminApi(companyId);
    const seeded = await seedCandidate(env, companyId, "vendors", [{ values: { name: "Kanak Scrap" } }, { values: { name: "Laxmi Traders" } }]);
    const first = await mergeAll(api);
    const before = (await stagedRows(env, seeded.candidateId)).map((r) => r.committedId);
    const cursor = await rewindToCrash(env, first.runId, seeded.candidateId);
    expect((await pump(api, first.runId, cursor)).state).toBe("done");
    expect(await count("vendor", companyId)).toBe(2);
    expect((await stagedRows(env, seeded.candidateId)).map((r) => r.committedId)).toEqual(before);
    expect(await auditRows(env, companyId, "vendor.create")).toHaveLength(2);
  });

  test("bundles: the resend writes no second bundle and no second legacy link", async () => {
    const { companyId } = await env.seedCompany();
    const api = await adminApi(companyId);
    const dieId = await env.seedDie(companyId, { series: "R", sectionCode: "5100" });
    const seeded = await seedCandidate(env, companyId, "bundles", [
      { values: { legacyId: "ckreplay00000000000000001", series: "R", sectionCode: "5100", quantity: 3, weightG: 9000, lengthMm: 3658, _ids: { sectionCode: dieId } } },
    ]);
    const first = await mergeAll(api);
    const cursor = await rewindToCrash(env, first.runId, seeded.candidateId);
    expect((await pump(api, first.runId, cursor)).state).toBe("done");
    expect(await count("bundle", companyId)).toBe(1);
    const links = await env.d1.prepare("select count(*) as n from legacy_bundle_map where company_id = ?").bind(companyId).first<{ n: number }>();
    expect(Number(links?.n)).toBe(1);
  });

  test("an update chunk: the resend does not update twice (one audit row)", async () => {
    const { companyId } = await env.seedCompany();
    const api = await adminApi(companyId);
    const made = await api.customer.create({ name: "Mahavir Alu" });
    const seeded = await seedCandidate(env, companyId, "customers", [
      { state: "ready_update", matchId: made.id, values: { name: "Mahavir Alu", notes: "n1" }, diff: { notes: { live: null, file: "n1" } } },
    ]);
    const first = await mergeAll(api);
    const cursor = await rewindToCrash(env, first.runId, seeded.candidateId);
    expect((await pump(api, first.runId, cursor)).state).toBe("done");
    expect(await auditRows(env, companyId, "customer.update")).toHaveLength(1);
    expect((await stagedRows(env, seeded.candidateId))[0]!.committedId).toBe(made.id);
  });
});

describe("a refused chunk", () => {
  test("holds its candidate with the exact message; a dependant gets dependency_held; the rest still merge", async () => {
    const { companyId } = await env.seedCompany({ settings: { dieRequiredOnSalesOrder: false } });
    const api = await adminApi(companyId);
    const dieId = await env.seedDie(companyId, { series: "R", sectionCode: "6100" });
    // customers: the email is refused by customer.importCsv's own schema.
    const customers = await seedCandidate(env, companyId, "customers", [{ values: { name: "Nova Alu", email: "not-an-email" } }], { sheet: "New parties" });
    // orders whose customer is the new party above (a `pending:` reference to its row).
    const orders = await seedCandidate(env, companyId, "orders", [
      {
        values: {
          customer: "Nova Alu",
          orderDate: "2025-10-31",
          series: "R",
          sectionCode: "6100",
          cutLength: 3658,
          bakiKg: 500_000,
          _ids: { customer: `pending:${customers.rowKeys[0]}`, sectionCode: dieId },
        },
      },
    ]);
    // an unrelated candidate that must still merge.
    const vendors = await seedCandidate(env, companyId, "vendors", [{ values: { name: "Om Scrap" } }]);

    const res = await mergeAll(api);
    expect(res.state).toBe("done_with_holds");
    expect(res.chunksFailed).toBe(2);
    expect(res.chunksWritten).toBe(1);

    const c = await candidateRow(env, customers.candidateId);
    expect(c.state).toBe("held");
    expect(c.reasonCode).toBe("merge_failed");
    expect(c.reasonDetail).toBe("rows.0.email: Invalid email address");
    const o = await candidateRow(env, orders.candidateId);
    expect(o.state).toBe("held");
    expect(o.reasonCode).toBe("dependency_held");
    expect(o.reasonDetail).toBe("New parties");
    expect((await candidateRow(env, vendors.candidateId)).state).toBe("merged");

    // Nothing of the held candidates was written; their rows are open again for a rerun.
    expect((await stagedRows(env, customers.candidateId)).map((r) => r.mergeState)).toEqual(["open"]);
    expect((await stagedRows(env, orders.candidateId)).map((r) => r.mergeState)).toEqual(["open"]);
    expect(await count("customer", companyId)).toBe(0);

    const view = await api.ingest.merge.get({ runId: res.runId });
    expect(view.failedChunks.map((f) => [f.candidateId, f.errorCode])).toEqual([
      [customers.candidateId, "BAD_REQUEST"],
      [orders.candidateId, "DEPENDENCY_HELD"],
    ]);
    const holds = await auditRows(env, companyId, "ingest.candidate.hold");
    expect(holds.map((h) => (h.meta as { reason: string }).reason).sort()).toEqual(["dependency_held", "merge_failed"]);
  });

  test("a rerun skips rows already written and writes only the rest", async () => {
    const { companyId } = await env.seedCompany();
    const api = await adminApi(companyId);
    const dieId = await env.seedDie(companyId, { series: "R", sectionCode: "7100" });
    const archived = await env.seedDie(companyId, { series: "R", sectionCode: "7200", status: "archived" });
    const seeded = await seedCandidate(env, companyId, "die_copies", [
      { values: { series: "R", sectionCode: "7100", makerDieNo: "A-1", _ids: { sectionCode: dieId } } },
      { values: { series: "R", sectionCode: "7200", makerDieNo: "A-2", _ids: { sectionCode: archived } } },
      { values: { series: "R", sectionCode: "7100", makerDieNo: "A-3", _ids: { sectionCode: dieId } } },
    ]);
    const first = await mergeAll(api);
    expect(first.state).toBe("done_with_holds");
    let c = await candidateRow(env, seeded.candidateId);
    expect(c).toMatchObject({ state: "held", reasonCode: "merge_failed", reasonDetail: "This section is archived; no new die copies", rowsWritten: 1, recipeLocked: true });
    expect((await stagedRows(env, seeded.candidateId)).map((r) => r.mergeState)).toEqual(["written", "open", "open"]);
    expect(await count("die_instance", companyId)).toBe(1);

    // The person fixes the section and approves again; the next run writes the two open rows only.
    const { die } = await import("@orrn/db/schema/catalog");
    const { ingestCandidate } = await import("@orrn/db/schema/ingest");
    const { eq } = await import("drizzle-orm");
    await env.db.update(die).set({ status: "active" }).where(eq(die.id, archived));
    await env.db.update(ingestCandidate).set({ state: "approved" }).where(eq(ingestCandidate.id, seeded.candidateId));
    const second = await mergeAll(api);
    expect(second.state).toBe("done");
    expect(second.chunksTotal).toBe(1);
    c = await candidateRow(env, seeded.candidateId);
    expect(c).toMatchObject({ state: "merged", rowsWritten: 3 });
    expect(await count("die_instance", companyId)).toBe(3);
    expect(await auditRows(env, companyId, "die_instance.create")).toHaveLength(3);
  });
});

describe("the run", () => {
  test("one active run per plant: a second start is CONFLICT; another plant may start", async () => {
    const { companyId } = await env.seedCompany();
    const api = await adminApi(companyId);
    await seedCandidate(env, companyId, "customers", [{ values: { name: "Pooja Alu" } }]);
    await api.ingest.merge.start();
    await seedCandidate(env, companyId, "customers", [{ values: { name: "Queen Alu" } }]);
    await expect(api.ingest.merge.start()).rejects.toMatchObject({ code: "CONFLICT", message: "A merge is already running" });
    const other = await env.seedCompany();
    await seedCandidate(env, other.companyId, "customers", [{ values: { name: "Pooja Alu" } }]);
    await (await adminApi(other.companyId)).ingest.merge.start();
  });

  test("nothing approved: start is refused", async () => {
    const { companyId } = await env.seedCompany();
    await seedCandidate(env, companyId, "customers", [{ values: { name: "Ready Only" } }], { state: "ready" });
    await expect((await adminApi(companyId)).ingest.merge.start()).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  test("a second tab pumping the same cursor gets CONFLICT", async () => {
    const { companyId } = await env.seedCompany();
    const api = await adminApi(companyId);
    await seedCandidate(env, companyId, "customers", [{ values: { name: "Ravi Alu" } }]);
    const { runId } = await api.ingest.merge.start();
    const step = await api.ingest.merge.step({ runId, expectCursor: 0 });
    expect(step.cursor).toBe(1);
    await expect(api.ingest.merge.step({ runId, expectCursor: 0 })).rejects.toMatchObject({ code: "CONFLICT", message: "Running in another tab" });
    expect((await pump(api, runId, 1)).state).toBe("done");
  });

  test("the module gate of the called procedure applies: customers off holds the candidate", async () => {
    const { companyId } = await env.seedCompany({ modules: ["dies", "bundles"] });
    const api = await adminApi(companyId);
    const seeded = await seedCandidate(env, companyId, "customers", [{ values: { name: "Sagar Alu" } }]);
    const res = await mergeAll(api);
    expect(res.state).toBe("done_with_holds");
    const c = await candidateRow(env, seeded.candidateId);
    expect(c.state).toBe("held");
    expect(c.reasonCode).toBe("merge_failed");
    expect(c.reasonDetail).toBe("That module is not on for this plant");
    expect(await count("customer", companyId)).toBe(0);
  });

  test("a role without ingest.merge cannot start or pump", async () => {
    const { companyId } = await env.seedCompany();
    await seedCandidate(env, companyId, "customers", [{ values: { name: "Tara Alu" } }]);
    const manager = await apiFor(await contextFor(env, companyId, "manager"));
    await expect(manager.ingest.merge.start()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  test("owner may merge too", async () => {
    const { companyId } = await env.seedCompany();
    await seedCandidate(env, companyId, "customers", [{ values: { name: "Uma Alu" } }]);
    const owner = await apiFor(await contextFor(env, companyId, "owner"));
    expect((await mergeAll(owner)).state).toBe("done");
  });

  test("stop: the run ends, merging candidates go back to approved with their rows open", async () => {
    const { companyId } = await env.seedCompany();
    const api = await adminApi(companyId);
    const seeded = await seedCandidate(env, companyId, "customers", [{ values: { name: "Vasu Alu" } }]);
    const { runId } = await api.ingest.merge.start();
    await api.ingest.merge.step({ runId, expectCursor: 0 }); // planned
    const stopped = await api.ingest.merge.stop({ runId });
    expect(stopped).toMatchObject({ state: "stopped", chunksTotal: 0 });
    expect((await candidateRow(env, seeded.candidateId)).state).toBe("approved");
    expect((await stagedRows(env, seeded.candidateId)).map((r) => r.mergeState)).toEqual(["open"]);
    // A stopped run takes no more steps; a new run merges the candidate.
    expect((await api.ingest.merge.step({ runId, expectCursor: 1 })).state).toBe("stopped");
    expect((await mergeAll(api)).state).toBe("done");
    expect(await count("customer", companyId)).toBe(1);
  });
});
