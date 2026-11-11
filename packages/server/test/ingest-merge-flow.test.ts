/**
 * Infinity Portal merge, lane B: end to end on rows the real lane A flow staged. A sheet of sections
 * and a sheet of customers go through begin, putBlocks, putRows, complete, the dry run and approve;
 * one merge writes both through their procedures; a second upload of the same rows finds them
 * already in orrn and the merge writes nothing new.
 */
import { createHash, randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { createTestEnv, type TestEnv } from "./harness";
import { auditRows, mergeAll, stagedRows } from "./ingest-merge-fixture";

let env: TestEnv;

beforeAll(async () => {
  env = await createTestEnv();
}, 60_000);

afterAll(async () => {
  await env.dispose();
});

type Caller = ReturnType<TestEnv["caller"]>;
type Sheet = { headers: string[]; rows: string[][]; name: string };

const DIES: Sheet = {
  name: "Sections",
  headers: ["Series", "Section code", "Min weight (kg/12ft)", "Max weight (kg/12ft)", "Name", "Width (mm)"],
  rows: [
    ["R", "9101", "2.1", "2.4", "Angle 25", "25.4"],
    ["R", "9102", "3.0", "3.3", "Channel", "40"],
  ],
};
const CUSTOMERS: Sheet = {
  name: "Parties",
  headers: ["Party Name", "City", "Phone"],
  rows: [
    ["Wadhwa Windows", "Ahmedabad", "9825000001"],
    ["Xcel Facades", "Surat", "9825000002"],
  ],
};

async function upload(as: Caller, sheets: Sheet[]) {
  const sha256 = createHash("sha256").update(randomUUID()).digest("hex");
  const begin = await as.ingest.artifact.begin({ sha256, fileName: "masters.xlsx", sizeBytes: 1000, contentType: null, kind: "sheet" });
  const put = await as.ingest.artifact.putBlocks({
    artifactId: begin.artifactId,
    blocks: sheets.map((s, ordinal) => ({ ordinal, sheetName: s.name, title: null, headerRow: 0, headerRows: 1, headers: s.headers, rowCount: s.rows.length, sample: s.rows })),
  });
  for (const [i, s] of sheets.entries()) {
    const block = put.blocks.find((b) => b.ordinal === i)!;
    await as.ingest.artifact.putRows({ blockId: block.blockId, fromIndex: 0, expectRowsPut: 0, rows: s.rows });
  }
  await as.ingest.artifact.complete({ artifactId: begin.artifactId });
  return put.candidates.sort((a, b) => a.blockOrdinal - b.blockOrdinal);
}

async function dryRunAndApprove(as: Caller, candidateId: string) {
  let cursor = (await as.ingest.candidate.get({ candidateId })).dryCursor;
  for (let i = 0; i < 20; i += 1) {
    const out = await as.ingest.dryRun.step({ candidateId, expectCursor: cursor });
    if (out.done) break;
    cursor = out.cursor;
  }
  const c = await as.ingest.candidate.get({ candidateId });
  expect(c.state).toBe("ready");
  return as.ingest.candidate.approve({ candidateId, expectSeq: c.serverSeq });
}

describe("end to end on staged rows from the real flow", () => {
  test("sections and customers merge in one run; the same rows again write nothing", async () => {
    const { companyId } = await env.seedCompany();
    const admin = env.caller({ role: "admin", companyId });
    const [dies, customers] = await upload(admin, [DIES, CUSTOMERS]);
    expect([dies!.target, customers!.target]).toEqual(["dies", "customers"]);
    await dryRunAndApprove(admin, dies!.id);
    await dryRunAndApprove(admin, customers!.id);

    const res = await mergeAll(admin);
    expect(res.state).toBe("done");
    expect(res.chunksWritten).toBe(2);

    const list = await admin.die.list({ limit: 50 });
    const made = list.items.filter((d) => d.sectionCode === "9101" || d.sectionCode === "9102");
    expect(made.map((d) => [d.sectionCode, d.weightMinG, d.weightMaxG]).sort()).toEqual([
      ["9101", 2100, 2400],
      ["9102", 3000, 3300],
    ]);
    const parties = await admin.customer.list({ limit: 50 });
    expect(parties.items.map((c) => c.name).sort()).toEqual(["Wadhwa Windows", "Xcel Facades"]);

    // Provenance: the record leads back to its file row.
    const dieRows = await stagedRows(env, dies!.id);
    const prov = await admin.ingest.provenance.forRecord({ type: "die", id: dieRows[0]!.committedId! });
    expect(prov).toMatchObject({ sheet: "Sections", rowIndex: 0 });
    // Customers merge before sections (target order 10 before 30).
    const [ci] = await auditRows(env, companyId, "customer.import");
    const [di] = await auditRows(env, companyId, "die.import");
    expect(ci!.at.getTime()).toBeLessThanOrEqual(di!.at.getTime());

    // The same rows in another file: all already in orrn, nothing to write.
    const again = await upload(admin, [{ ...DIES, rows: [...DIES.rows] }]);
    await dryRunAndApprove(admin, again[0]!.id);
    const c = await admin.ingest.candidate.get({ candidateId: again[0]!.id });
    expect(c.counts.unchanged).toBe(2);
    const second = await mergeAll(admin);
    expect(second).toMatchObject({ state: "done", chunksTotal: 0 });
    expect((await admin.ingest.candidate.get({ candidateId: again[0]!.id })).state).toBe("merged");
    expect(await auditRows(env, companyId, "die.import")).toHaveLength(1);
  });
});
