/**
 * Lane A review fixes (PORTAL-REVIEW-1, "Lane A (server)"). Each describe names the finding it pins.
 * Real D1 through the `ingest` router. No model and no network.
 */
import { createHash, randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";

import { workersEnv } from "./env-mock";
import { createTestEnv, type CompanyRole, type TestEnv } from "./harness";

import { BAKI_SHEET_HEADERS, EXAMPLE_BAKI_RECIPE, fingerprint, type Recipe } from "@orrn/ingest";

import { setShapeClientForTests } from "../src/lib/ingest/bot/client";
import { FakeShapeClient, fakeResponse } from "../src/lib/ingest/bot/fake";
import { runShapeAttempt } from "../src/lib/ingest/bot";
import { DAY_CALL_CAP } from "../src/lib/ingest/bot/caps";
import { dryRunHooks } from "../src/lib/ingest/dryrun";
import { baseArgs, haiku, recipeAnswer } from "./ingest-bot-fixture";

let env: TestEnv;

beforeAll(async () => {
  env = await createTestEnv();
});

afterEach(() => {
  delete workersEnv.INGEST_VAULT;
  delete dryRunHooks.beforeCommit;
  setShapeClientForTests(null);
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

describe("A5: an order book matches the plant's live orders", () => {
  const ratedBaki = (poColumn = false) =>
    bakiRecipe({
      fields: EXAMPLE_BAKI_RECIPE.fields.map((f) => {
        if (f.field === "rate") return { ...f, steps: [{ op: "number" as const, kind: "price_per_mass" as const, unit: "inr/kg" }] };
        if (f.field === "oldOrderNo" && poColumn) return { ...f, field: "poNumber" };
        return f;
      }),
      unclear: [],
    });

  async function liveOrder(companyId: string, customerId: string, set: { poNumber?: string | null; note?: string | null; orderDate: string }) {
    const { salesOrder } = await import("@orrn/db/schema");
    const id = `so_${randomUUID()}`;
    await env.db.insert(salesOrder).values({
      id,
      companyId,
      period: "2025-26",
      number: `SO-${randomUUID().slice(0, 6)}`,
      customerId,
      poNumber: set.poNumber ?? null,
      orderDate: set.orderDate,
      note: set.note ?? null,
    } as never);
    return id;
  }

  async function orderSheet(poColumn: boolean, live: { poNumber?: string | null; note?: string | null; orderDate: string }) {
    const p = await plant();
    const acme = await p.owner.customer.create({ name: "Acme Traders" });
    const orderId = await liveOrder(p.companyId, acme.id, live);
    await learnLayout(p.companyId, p.users.owner.id, ratedBaki(poColumn), "Baki");
    const { candidates } = await upload(p.owner, [{ headers: BAKI_SHEET_HEADERS, rows: [BAKI_ROW] }]);
    const id = candidates[0]!.id;
    await pump(p.owner, id);
    // The section is not in orrn: say it is an old die, so the row can be created or matched.
    let c = await p.owner.ingest.candidate.get({ candidateId: id });
    c = await p.owner.ingest.answer.set({ candidateId: id, questionCode: "create_legacy_die", subject: "12170", answer: true, expectSeq: c.serverSeq });
    await pump(p.owner, id);
    const row = (await p.owner.ingest.rows.list({ candidateId: id })).items[0]!;
    return { p, orderId, row };
  }

  test("same party and PO as a live order: unchanged, matched to it", async () => {
    const { orderId, row } = await orderSheet(true, { poNumber: "ob-1", orderDate: "2025-09-01" });
    expect(row).toMatchObject({ state: "unchanged", matchId: orderId });
    expect(row.reasons).toContain("order_exists");
  });

  test("no PO: same party, date and old order number as a live order is unchanged", async () => {
    const { orderId, row } = await orderSheet(false, { note: "Old order no. OB-1", orderDate: "2025-10-01" });
    expect(row).toMatchObject({ state: "unchanged", matchId: orderId });
  });

  test("a different old order number is still a new order", async () => {
    const { row } = await orderSheet(false, { note: "Old order no. OB-2", orderDate: "2025-10-01" });
    expect(row.state).toBe("ready_create");
  });
});

describe("A6, A7, A14, A18, A22, A29: no rate reaches a viewer without order.price", () => {
  test("candidate.get and artifact.get blank the sample's rate cells for the admin; the owner sees them", async () => {
    const p = await plant();
    await learnLayout(p.companyId, p.users.owner.id, bakiRecipe(), "Baki");
    const { candidates, artifactId } = await upload(p.owner, [{ headers: BAKI_SHEET_HEADERS, rows: [BAKI_ROW] }]);
    const id = candidates[0]!.id;
    expect((await p.admin.ingest.candidate.get({ candidateId: id })).block.sample[0]![9]).toBe("");
    expect((await p.admin.ingest.artifact.get({ artifactId })).blocks[0]!.sample[0]![9]).toBe("");
    expect((await p.owner.ingest.candidate.get({ candidateId: id })).block.sample[0]![9]).toBe("245.50");
    expect((await p.owner.ingest.artifact.get({ artifactId })).blocks[0]!.sample[0]![9]).toBe("245.50");
  });

  test("rows.list masks the raw rate cell on pending and refused rows too", async () => {
    const p = await plant();
    // The rate unit is open, so every row is refused unit_unknown and holds no parsed rate.
    await learnLayout(p.companyId, p.users.owner.id, bakiRecipe(), "Baki");
    const { candidates } = await upload(p.owner, [{ headers: BAKI_SHEET_HEADERS, rows: [BAKI_ROW] }]);
    const id = candidates[0]!.id;
    const pending = (await p.admin.ingest.rows.list({ candidateId: id })).items[0]!;
    expect(pending.state).toBe("pending");
    expect(pending.raw[9]).toBe("");
    expect(pending.rateHidden).toBe(true);
    await pump(p.owner, id);
    const refused = (await p.admin.ingest.rows.list({ candidateId: id })).items[0]!;
    expect(refused.state).toBe("refused");
    expect(refused.raw[9]).toBe("");
  });

  test("a sheet with no layout yet hides a column whose header reads as a rate", async () => {
    const p = await plant();
    const { candidates } = await upload(p.owner, [{ headers: ["Khata", "Maal", "Rate Rs/kg"], rows: [["Acme", "Domal", "245.50"]] }]);
    const c = candidates[0]!;
    expect(c.state).toBe("needs_shape");
    const forAdmin = await p.admin.ingest.candidate.get({ candidateId: c.id });
    expect(forAdmin.block.sample[0]).toEqual(["Acme", "Domal", ""]);
    expect((await p.admin.ingest.rows.list({ candidateId: c.id })).items[0]!.raw).toEqual(["Acme", "Domal", ""]);
    expect((await p.owner.ingest.candidate.get({ candidateId: c.id })).block.sample[0]![2]).toBe("245.50");
  });
});

const KHATA: Sheet = { headers: ["Khata", "Gaam"], rows: [["Acme", "Surat"], ["Bharat", "Rajkot"]] };

/** What the model would answer for the Khata sheet: a customers layout. Raw headers, as models write them. */
function khataAnswer() {
  const fp = fingerprint({ headers: KHATA.headers, rows: KHATA.rows });
  const recipe: Recipe = {
    schemaVersion: 1,
    target: "customers",
    headerRow: 0,
    headerRows: 1,
    match: { headerKey: fp.headerKey, headers: ["Khata", "Gaam"] },
    fields: [
      { field: "name", source: { kind: "columns", cols: [{ col: 0, header: "Khata" }] }, steps: [{ op: "trim" }] },
      { field: "city", source: { kind: "columns", cols: [{ col: 1, header: "Gaam" }] }, steps: [{ op: "trim" }] },
    ],
    filters: [],
    keys: ["name"],
    onExisting: "ask",
    unclear: [],
  };
  return fakeResponse({ result: { kind: "recipe", recipe } });
}

describe("A8: the bot claims its place before the model call", () => {
  test("two tabs on one sheet: one call, the other gets CONFLICT before it spends", async () => {
    const p = await plant();
    const fake = new FakeShapeClient([khataAnswer(), khataAnswer()]);
    setShapeClientForTests(fake);
    const { candidates } = await upload(p.admin, [KHATA]);
    const c = candidates[0]!;
    const results = await Promise.allSettled([
      p.admin.ingest.shape.make({ candidateId: c.id, expectSeq: c.serverSeq }),
      p.admin.ingest.shape.make({ candidateId: c.id, expectSeq: c.serverSeq }),
    ]);
    expect(fake.calls).toHaveLength(1);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(String(rejected.reason)).toMatch(/another tab/);
  });

  test("a call that would pass the day cap once its claim is in is capped, not made", async () => {
    const p = await plant();
    const { ingestBotRun } = await import("@orrn/db/schema/ingest");
    const { DAY_CALL_CAP } = await import("../src/lib/ingest/bot/caps");
    const { candidates } = await upload(p.admin, [KHATA]);
    const rows = Array.from({ length: DAY_CALL_CAP - 1 }, (_, i) => ({
      id: `run_${randomUUID()}`,
      companyId: p.companyId,
      blockId: `old-${i}`,
      candidateId: null,
      purpose: "shape" as const,
      model: "claude-haiku-5-5",
      attempt: 1,
      outcome: "invalid" as const,
    }));
    for (let i = 0; i < rows.length; i += 5) await env.db.insert(ingestBotRun).values(rows.slice(i, i + 5));
    // One more call is still under the cap; a second one is not.
    const fake = new FakeShapeClient([khataAnswer(), khataAnswer()]);
    setShapeClientForTests(fake);
    const c = candidates[0]!;
    const out = await p.admin.ingest.shape.make({ candidateId: c.id, expectSeq: c.serverSeq });
    expect(out.outcome).toBe("recipe");
    expect(fake.calls).toHaveLength(1);
    const pending = await env.d1.prepare("select count(*) as n from ingest_bot_run where company_id = ? and outcome = 'pending'").bind(p.companyId).first<{ n: number }>();
    expect(pending?.n).toBe(0);
  });
});

describe("A8: parallel calls across blocks", () => {
  test("two blocks at the day cap edge: at most one model call between them", async () => {
    const args = baseArgs();
    const at = args.nowMs!();
    for (let i = 0; i < DAY_CALL_CAP - 1; i += 1) {
      await args.store.insertRun({
        companyId: "co1", blockId: `old${i}`, candidateId: null, purpose: "shape", model: "claude-haiku-5-5", attempt: 1, outcome: "invalid",
        inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costMicroUsd: 0, durationMs: 0, createdBy: null, createdAtMs: at - 1000, errorCodes: null,
      });
    }
    const fake = new FakeShapeClient([haiku(recipeAnswer()), haiku(recipeAnswer())]);
    await Promise.all([
      runShapeAttempt({ ...args, client: fake, block: { ...args.block, id: "blkA" } }),
      runShapeAttempt({ ...args, client: fake, block: { ...args.block, id: "blkB" } }),
    ]);
    expect(fake.calls.length).toBeLessThanOrEqual(1);
    expect(args.store.rows.filter((r) => r.outcome !== "capped").length).toBeLessThanOrEqual(DAY_CALL_CAP);
    expect(args.store.rows.some((r) => r.outcome === "pending")).toBe(false);
  });
});

describe("A27: the D1 bot run store", () => {
  test("shape.make with a fake client: draft layout, one run row for this plant, other plants and capped rows not counted", async () => {
    const other = await plant();
    const p = await plant();
    const { ingestBotRun } = await import("@orrn/db/schema/ingest");
    const { DAY_CALL_CAP } = await import("../src/lib/ingest/bot/caps");
    const theirs = Array.from({ length: DAY_CALL_CAP }, (_, i) => ({
      id: `run_${randomUUID()}`,
      companyId: other.companyId,
      blockId: `b-${i}`,
      candidateId: null,
      purpose: "shape" as const,
      model: "claude-haiku-5-5",
      attempt: 1,
      outcome: "invalid" as const,
    }));
    for (let i = 0; i < theirs.length; i += 5) await env.db.insert(ingestBotRun).values(theirs.slice(i, i + 5));
    const { candidates } = await upload(p.admin, [KHATA]);
    const c = candidates[0]!;
    await env.db.insert(ingestBotRun).values({
      id: `run_${randomUUID()}`,
      companyId: p.companyId,
      blockId: c.blockId,
      candidateId: c.id,
      purpose: "shape",
      model: "claude-haiku-5-5",
      attempt: 1,
      outcome: "capped",
    });
    setShapeClientForTests(new FakeShapeClient([khataAnswer()]));
    const out = await p.admin.ingest.shape.make({ candidateId: c.id, expectSeq: c.serverSeq });
    expect(out).toMatchObject({ outcome: "recipe", next: "done" });
    const after = await p.admin.ingest.candidate.get({ candidateId: c.id });
    expect(after).toMatchObject({ state: "processing", fit: "bot", botAttempts: 1 });
    const holes = await p.admin.ingest.hole.list({});
    expect(holes[0]!.versions[0]).toMatchObject({ state: "draft", madeBy: "bot" });
    const runs = await env.d1
      .prepare("select company_id as companyId, outcome from ingest_bot_run where block_id = ? order by created_at")
      .bind(c.blockId)
      .all<{ companyId: string; outcome: string }>();
    expect(runs.results).toEqual([
      { companyId: p.companyId, outcome: "capped" },
      { companyId: p.companyId, outcome: "recipe" },
    ]);
  });
});
