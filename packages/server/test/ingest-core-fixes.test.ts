/**
 * Lane A review fixes (PORTAL-REVIEW-1, "Lane A (server)"). Each describe names the finding it pins.
 * Real D1 through the `ingest` router. No model and no network.
 */
import { createHash, randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";

import { workersEnv } from "./env-mock";
import { createTestEnv, type CompanyRole, type TestEnv } from "./harness";

import { BAKI_SHEET_HEADERS, EXAMPLE_BAKI_RECIPE, fingerprint, type Recipe } from "@orrn/ingest";

import { dryRunHooks } from "../src/lib/ingest/dryrun";

let env: TestEnv;

beforeAll(async () => {
  env = await createTestEnv();
});

afterEach(() => {
  delete workersEnv.INGEST_VAULT;
  delete dryRunHooks.beforeCommit;
});

afterAll(async () => {
  delete workersEnv.INGEST_VAULT;
  await env.dispose();
});

type Caller = ReturnType<TestEnv["caller"]>;
type Sheet = { headers: string[]; rows: string[][]; name?: string };

const sha = () => createHash("sha256").update(randomUUID()).digest("hex");

async function plant() {
  const { companyId, users } = await env.seedCompany();
  const as = (role: CompanyRole) => env.caller({ role, companyId });
  return { companyId, users, as, admin: as("admin"), owner: as("owner") };
}

const blockOf = (s: Sheet, ordinal: number) => ({
  ordinal,
  sheetName: s.name ?? `Sheet${ordinal + 1}`,
  title: null,
  headerRow: 0,
  headerRows: 1,
  headers: s.headers,
  rowCount: s.rows.length,
  sample: s.rows.slice(0, 200),
});

async function upload(as: Caller, sheets: Sheet[], fileName = "book.xlsx", digest = sha()) {
  const begin = await as.ingest.artifact.begin({ sha256: digest, fileName, sizeBytes: 1000, contentType: null, kind: "sheet" });
  const put = await as.ingest.artifact.putBlocks({ artifactId: begin.artifactId, blocks: sheets.map(blockOf) });
  for (const [i, s] of sheets.entries()) {
    const block = put.blocks.find((b) => b.ordinal === i)!;
    if (s.rows.length > 0) await as.ingest.artifact.putRows({ blockId: block.blockId, fromIndex: 0, expectRowsPut: 0, rows: s.rows });
  }
  await as.ingest.artifact.complete({ artifactId: begin.artifactId });
  const candidates = put.candidates.sort((a, b) => a.blockOrdinal - b.blockOrdinal);
  return { artifactId: begin.artifactId, candidates, blocks: put.blocks };
}

async function pump(as: Caller, candidateId: string) {
  let cursor = (await as.ingest.candidate.get({ candidateId })).dryCursor;
  for (let i = 0; i < 50; i += 1) {
    const out = await as.ingest.dryRun.step({ candidateId, expectCursor: cursor });
    if (out.done) return out;
    cursor = out.cursor;
  }
  throw new Error("dry run did not finish");
}

async function learnLayout(companyId: string, createdBy: string, recipe: Recipe, name = "Learned") {
  const { ingestHole, ingestHoleVersion } = await import("@orrn/db/schema/ingest");
  const holeId = `hole_${randomUUID()}`;
  const versionId = `hv_${randomUUID()}`;
  await env.db.insert(ingestHole).values({ id: holeId, companyId, target: recipe.target, name, currentVersion: 1, state: "active", createdBy });
  await env.db.insert(ingestHoleVersion).values({
    id: versionId,
    companyId,
    holeId,
    version: 1,
    headerKey: recipe.match.headerKey,
    recipe: recipe as never,
    madeBy: "person",
    state: "approved",
    createdBy,
  });
  return { holeId, versionId };
}

const CUSTOMERS: Sheet = {
  headers: ["Name", "GSTIN", "City"],
  rows: [
    ["Acme Traders", "", "Surat"],
    ["Bharat Metals", "", "Rajkot"],
  ],
};

const BAKI_ROW = ["1", "Acme Traders", "OB-1", "01/10/2025", "DOMAL 12170", "6.1", "500", "200", "300", "245.50", ""];

/** The Baki layout learned with the rate unit left open (it asks unit_unknown for rate). */
function bakiRecipe(over: Partial<Recipe> = {}): Recipe {
  const fp = fingerprint({ headers: BAKI_SHEET_HEADERS, rows: [] });
  return { ...EXAMPLE_BAKI_RECIPE, headerRow: 0, match: { headerKey: fp.headerKey, headers: fp.normalized }, ...over };
}

describe("A1: a person's change during a dry run step is not lost", () => {
  test("an answer given while a step runs makes the step re-run with the answer", async () => {
    const p = await plant();
    await learnLayout(p.companyId, p.users.owner.id, bakiRecipe(), "Baki");
    const { candidates } = await upload(p.owner, [{ headers: BAKI_SHEET_HEADERS, rows: [BAKI_ROW] }]);
    const id = candidates[0]!.id;
    expect(candidates[0]!.state).toBe("processing");

    dryRunHooks.beforeCommit = async () => {
      delete dryRunHooks.beforeCommit;
      const c = await p.owner.ingest.candidate.get({ candidateId: id });
      await p.owner.ingest.answer.set({ candidateId: id, questionCode: "unit_unknown", subject: "rate", answer: "inr/kg", expectSeq: c.serverSeq });
    };
    const first = await p.owner.ingest.dryRun.step({ candidateId: id, expectCursor: 0 });
    expect(first).toMatchObject({ done: false, cursor: 0, state: "processing" });
    await pump(p.owner, id);
    const row = (await p.owner.ingest.rows.list({ candidateId: id })).items[0]!;
    expect(row.rate).toBe(24_550);
  });

  test("a row decision made while a step runs is kept", async () => {
    const p = await plant();
    const { candidates } = await upload(p.admin, [CUSTOMERS]);
    const id = candidates[0]!.id;
    await pump(p.admin, id);
    let c = await p.admin.ingest.candidate.get({ candidateId: id });
    const rows = await p.admin.ingest.rows.list({ candidateId: id });
    // Skip row 1: the candidate re-runs from row 0. During that step, skip row 2: the cursor stays at 0.
    await p.admin.ingest.rows.decide({ candidateId: id, rowIds: [rows.items[0]!.id], decision: "skip", expectSeq: c.serverSeq });
    dryRunHooks.beforeCommit = async () => {
      delete dryRunHooks.beforeCommit;
      const now = await p.admin.ingest.candidate.get({ candidateId: id });
      await p.admin.ingest.rows.decide({ candidateId: id, rowIds: [rows.items[1]!.id], decision: "skip", expectSeq: now.serverSeq });
    };
    c = await p.admin.ingest.candidate.get({ candidateId: id });
    expect(c.dryCursor).toBe(0);
    await p.admin.ingest.dryRun.step({ candidateId: id, expectCursor: 0 });
    const done = await pump(p.admin, id);
    expect(done.counts).toMatchObject({ create: 0, skipped: 2 });
  });
});

describe("A2: answers to an old layout do not override the new layout", () => {
  test("a unit answered for one layout is dropped when a layout states the unit", async () => {
    const p = await plant();
    await learnLayout(p.companyId, p.users.owner.id, bakiRecipe(), "Baki");
    const { candidates } = await upload(p.owner, [{ headers: BAKI_SHEET_HEADERS, rows: [BAKI_ROW] }]);
    const id = candidates[0]!.id;
    await pump(p.owner, id);
    let c = await p.owner.ingest.candidate.get({ candidateId: id });
    c = await p.owner.ingest.answer.set({ candidateId: id, questionCode: "unit_unknown", subject: "rate", answer: "inr/t", expectSeq: c.serverSeq });
    await pump(p.owner, id);
    c = await p.owner.ingest.candidate.get({ candidateId: id });
    // Rs 245.50 a tonne is 24.55 paise a kg.
    expect((await p.owner.ingest.rows.list({ candidateId: id })).items[0]!.rate).toBe(25);

    const stated = bakiRecipe({
      fields: EXAMPLE_BAKI_RECIPE.fields.map((f) =>
        f.field === "rate" ? { ...f, steps: [{ op: "number" as const, kind: "price_per_mass" as const, unit: "inr/kg" }] } : f,
      ),
      unclear: [],
    });
    await p.owner.ingest.shape.save({ candidateId: id, recipe: stated, holeName: "Baki kg", expectSeq: c.serverSeq });
    await pump(p.owner, id);
    c = await p.owner.ingest.candidate.get({ candidateId: id });
    expect(c.questions.some((q) => q.code === "unit_unknown")).toBe(false);
    expect((await p.owner.ingest.rows.list({ candidateId: id })).items[0]!.rate).toBe(24_550);
  });
});

describe("A3: ignoring a sheet while its rows upload does not block the file", () => {
  test("the rest of the rows count as sent, the file completes and the other sheet gets ready", async () => {
    const p = await plant();
    const begin = await p.admin.ingest.artifact.begin({ sha256: sha(), fileName: "two.xlsx", sizeBytes: 10, contentType: null, kind: "sheet" });
    const other: Sheet = { headers: ["Foo", "Bar"], rows: [["1", "2"], ["3", "4"], ["5", "6"]] };
    const put = await p.admin.ingest.artifact.putBlocks({ artifactId: begin.artifactId, blocks: [blockOf(CUSTOMERS, 0), blockOf(other, 1)] });
    const custBlock = put.blocks.find((b) => b.ordinal === 0)!.blockId;
    const otherBlock = put.blocks.find((b) => b.ordinal === 1)!.blockId;
    const otherCand = put.candidates.find((c) => c.blockOrdinal === 1)!;
    await p.admin.ingest.artifact.putRows({ blockId: custBlock, fromIndex: 0, expectRowsPut: 0, rows: CUSTOMERS.rows });
    await p.admin.ingest.artifact.putRows({ blockId: otherBlock, fromIndex: 0, expectRowsPut: 0, rows: other.rows.slice(0, 1) });
    await p.admin.ingest.candidate.setTarget({ candidateId: otherCand.id, target: "ignore", expectSeq: otherCand.serverSeq });
    const rest = await p.admin.ingest.artifact.putRows({ blockId: otherBlock, fromIndex: 1, expectRowsPut: 1, rows: other.rows.slice(1) });
    expect(rest.rowsPut).toBe(3);
    await p.admin.ingest.artifact.complete({ artifactId: begin.artifactId });
    expect((await p.admin.ingest.artifact.get({ artifactId: begin.artifactId })).readState).toBe("read");
    const cust = put.candidates.find((c) => c.blockOrdinal === 0)!;
    expect((await pump(p.admin, cust.id)).state).toBe("ready");
  });
});

describe("A4, A10: a file whose read failed can be read again", () => {
  test("the same bytes again start a fresh read; the old sheets go, the bot cost stays counted", async () => {
    const p = await plant();
    const digest = sha();
    const begin = await p.admin.ingest.artifact.begin({ sha256: digest, fileName: "big.xlsx", sizeBytes: 10, contentType: null, kind: "sheet" });
    const first = await p.admin.ingest.artifact.putBlocks({ artifactId: begin.artifactId, blocks: [blockOf(CUSTOMERS, 0)] });
    const { ingestBotRun } = await import("@orrn/db/schema/ingest");
    await env.db.insert(ingestBotRun).values({
      id: `run_${randomUUID()}`,
      companyId: p.companyId,
      blockId: first.blocks[0]!.blockId,
      candidateId: first.candidates[0]!.id,
      purpose: "shape",
      model: "claude-haiku-5-5",
      attempt: 1,
      outcome: "invalid",
      costMicroUsd: 1234,
    });
    await p.admin.ingest.artifact.complete({ artifactId: begin.artifactId, readError: "The browser ran out of memory" });

    const again = await p.admin.ingest.artifact.begin({ sha256: digest, fileName: "big.xlsx", sizeBytes: 10, contentType: null, kind: "sheet" });
    expect(again).toMatchObject({ artifactId: begin.artifactId, existing: false });
    const detail = await p.admin.ingest.artifact.get({ artifactId: begin.artifactId });
    expect(detail).toMatchObject({ readState: "reading", readError: null, blocks: [] });

    const put = await p.admin.ingest.artifact.putBlocks({ artifactId: begin.artifactId, blocks: [blockOf(CUSTOMERS, 0)] });
    await p.admin.ingest.artifact.putRows({ blockId: put.blocks[0]!.blockId, fromIndex: 0, expectRowsPut: 0, rows: CUSTOMERS.rows });
    await p.admin.ingest.artifact.complete({ artifactId: begin.artifactId });
    expect((await pump(p.admin, put.candidates[0]!.id)).state).toBe("ready");
    expect((await p.admin.ingest.status()).botToday.costMicroUsd).toBe(1234);

    const audit = await env.d1.prepare("select action from audit_log where company_id = ? and action = 'ingest.artifact.reread'").bind(p.companyId).all();
    expect(audit.results).toHaveLength(1);
  });

  test("a file that was read well still opens as the same artifact", async () => {
    const p = await plant();
    const digest = sha();
    await upload(p.admin, [CUSTOMERS], "c.xlsx", digest);
    const again = await p.admin.ingest.artifact.begin({ sha256: digest, fileName: "c.xlsx", sizeBytes: 1000, contentType: null, kind: "sheet" });
    expect(again.existing).toBe(true);
  });
});
