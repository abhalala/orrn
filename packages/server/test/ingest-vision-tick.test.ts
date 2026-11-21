/**
 * Vision read, release 2 fix round: the tick "I checked these rows against the page".
 * - Decision 5 / security L2: who set the tick and when are stored. Item 16: the tick takes ingest.check (and
 *   order.price on a table with a price column); Approve keeps ingest.merge.
 * - Decision 5 / N1 / L3: every action that changes which rows of a model-read table are written clears the
 *   tick in its own batch: rows.decide (already), rows.answerDoubts, rows.skipNoDateLines, and a fill-above
 *   change that re-runs the file's order sheets.
 * - Decision 6: a person who cannot see a rate column of the table cannot tick it.
 * - Security L5: a fixed rate cell is not written into the audit row.
 * - N3: "Fix this cell" on a failed sheet keeps it failed (its file read failed; a cell cannot fix that).
 * Real D1, a Miniflare R2 bucket and the scripted model client. Synthetic tables only.
 */
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { Miniflare } from "miniflare";

import { workersEnv } from "./env-mock";
import { createTestEnv, type TestEnv } from "./harness";
import { layout, learnLayout, plant, pump, trim, upload, type Caller, type Plant } from "./ingest-portal-helpers";
import { fakeResponse, FakeShapeClient, setShapeClientForTests } from "../src/lib/ingest/bot";
import { pageKey, rawKey } from "../src/lib/ingest/vault";

let env: TestEnv;
let mf: Miniflare;
let bucket: R2Bucket;

beforeAll(async () => {
  env = await createTestEnv();
  mf = new Miniflare({ modules: true, script: "export default { fetch() { return new Response('ok'); } }", r2Buckets: ["VAULT"] });
  bucket = (await mf.getR2Bucket("VAULT")) as unknown as R2Bucket;
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

const S = "claude-sonnet-5-5";
type T = { title: string; headers: string[]; rows: string[][] };
const PARTIES: T = { title: "Parties", headers: ["Party name", "City"], rows: [["Nova Metals", "Rajkot"], ["Om Alloys", "Surat"]] };
const RATES: T = { title: "Rates", headers: ["Party name", "Rate"], rows: [["Nova Metals", "210"], ["Om Alloys", "205"]] };

/** A started photo whose one page was read into one model block per table. */
async function modelSheets(tables: T[], p?: Plant) {
  workersEnv.INGEST_VAULT = bucket;
  const owner = p ?? (await plant(env));
  const sha = createHash("sha256").update(randomUUID()).digest("hex");
  const bytes = new TextEncoder().encode(`synthetic ${sha}`);
  const begin = await owner.owner.ingest.artifact.begin({ sha256: sha, fileName: "slip.jpg", sizeBytes: bytes.byteLength, contentType: "image/jpeg", kind: "image" });
  await bucket.put(rawKey(owner.companyId, sha), bytes);
  await owner.owner.ingest.artifact.commitRaw({ artifactId: begin.artifactId });
  const answer = { tables: tables.map((t) => ({ title: t.title, headers: t.headers, rows: t.rows.map((cells) => ({ cells, confidence: 0.9 })) })) };
  setShapeClientForTests(new FakeShapeClient([fakeResponse(answer, { modelUsed: S })]));
  await owner.owner.ingest.vision.start({ artifactId: begin.artifactId, pageCount: 1 });
  await bucket.put(pageKey(owner.companyId, sha, 1), new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), { httpMetadata: { contentType: "image/jpeg" } });
  await owner.owner.ingest.vision.readPage({ artifactId: begin.artifactId, page: 1 });
  const got = await owner.owner.ingest.artifact.get({ artifactId: begin.artifactId });
  return { p: owner, artifactId: begin.artifactId, candidates: got.blocks.map((b) => b.candidates[0]!.id) };
}

const detail = (as: Caller, candidateId: string) => as.ingest.candidate.get({ candidateId });
const tick = async (as: Caller, candidateId: string, checked = true) => as.ingest.vision.check({ candidateId, expectSeq: (await detail(as, candidateId)).serverSeq, checked });
const tickOf = async (candidateId: string) =>
  env.d1
    .prepare("select b.model_checked as checked, b.model_checked_by as by, b.model_checked_at as at from ingest_block b join ingest_candidate c on c.block_id = b.id where c.id = ?")
    .bind(candidateId)
    .first<{ checked: number; by: string | null; at: number | null }>();
const cleared = { checked: 0, by: null, at: null };

describe("who ticked and when (decision 5, security L2)", () => {
  test("the tick stores who set it and when; unticking clears both; the screen gets them", async () => {
    const { setClockForTests } = await import("../src/lib/clock");
    setClockForTests(new Date("2026-11-20T09:00:00Z"));
    const { p, candidates } = await modelSheets([PARTIES]);
    const c = await tick(p.owner, candidates[0]!);
    expect(await tickOf(candidates[0]!)).toEqual({ checked: 1, by: p.users.owner.id, at: Date.parse("2026-11-20T09:00:00Z") });
    expect(c.block).toMatchObject({ modelChecked: true, modelCheckedBy: p.users.owner.id, modelCheckedAt: Date.parse("2026-11-20T09:00:00Z") });
    const off = await tick(p.owner, candidates[0]!, false);
    expect(await tickOf(candidates[0]!)).toEqual(cleared);
    expect(off.block).toMatchObject({ modelChecked: false, modelCheckedBy: null, modelCheckedAt: null });
  });

  test("a tick cleared by a row change clears who and when too", async () => {
    const { p, candidates } = await modelSheets([PARTIES]);
    const c = await tick(p.owner, candidates[0]!);
    await p.owner.ingest.vision.fixCell({ candidateId: candidates[0]!, expectSeq: c.serverSeq, rowIndex: 0, col: 1, text: "Rajkot city" });
    expect(await tickOf(candidates[0]!)).toEqual(cleared);
  });

  // Item 16 (owner decision "Price-viewers tick, admin approves") moved the tick from ingest.merge to ingest.check;
  // the role matrix of the tick is in ingest-vision-check-role.test.ts. Approve keeps ingest.merge.
  test("the tick takes ingest.check, not upload rights alone; Approve keeps ingest.merge", async () => {
    const router = readFileSync(join(import.meta.dir, "../src/routers/ingest/index.ts"), "utf8");
    expect(router).toMatch(/\bconst K = actionProcedure\("ingest\.check"\)/);
    expect(router).toMatch(/\bcheck: K\.input\(visionCheckInput\)/);
    expect(router).toMatch(/\bapprove: M\./);
    // A role without ingest.check is refused, as before.
    const { p, candidates } = await modelSheets([PARTIES]);
    const seq = (await detail(p.owner, candidates[0]!)).serverSeq;
    await expect(p.as("supervisor").ingest.vision.check({ candidateId: candidates[0]!, expectSeq: seq, checked: true })).rejects.toThrow("You don't have permission to do that");
  });
});

describe("row actions clear the tick (decision 5, N1, L3)", () => {
  test("rows.answerDoubts, skip or right, clears the tick of a model-read table", async () => {
    for (const answer of ["skip", "right"] as const) {
      const { p, candidates } = await modelSheets([PARTIES]);
      const id = candidates[0]!;
      await env.d1.prepare("update ingest_candidate set state = 'ready' where id = ?").bind(id).run();
      await env.d1.prepare("update ingest_staged_row set doubts = ? where candidate_id = ? and row_index = 0").bind(JSON.stringify(["check_against_file"]), id).run();
      await tick(p.owner, id);
      const row = await env.d1.prepare("select id from ingest_staged_row where candidate_id = ? and row_index = 0").bind(id).first<{ id: string }>();
      await p.owner.ingest.rows.answerDoubts({ candidateId: id, answer, rowId: row!.id, expectSeq: (await detail(p.owner, id)).serverSeq });
      expect(await tickOf(id)).toEqual(cleared);
    }
  });

  test("rows.skipNoDateLines clears the tick of a model-read order sheet", async () => {
    const { p, candidates } = await modelSheets([PARTIES]);
    const id = candidates[0]!;
    await env.d1.prepare("update ingest_candidate set state = 'ready', target = 'orders' where id = ?").bind(id).run();
    await env.d1.prepare("update ingest_staged_row set state = 'refused', reasons = ? where candidate_id = ? and row_index = 1").bind(JSON.stringify(["order_no_date:orderDate"]), id).run();
    await tick(p.owner, id);
    await p.owner.ingest.rows.skipNoDate({ candidateId: id, expectSeq: (await detail(p.owner, id)).serverSeq });
    expect(await tickOf(id)).toEqual(cleared);
  });

  test("a fill-above change that re-runs the file's order sheets clears their ticks", async () => {
    const { p, artifactId, candidates } = await modelSheets([PARTIES, { ...PARTIES, title: "More parties" }]);
    const [a, b] = candidates as [string, string];
    // Sheet a is an order sheet already; the file holds a fill answer.
    await env.d1.prepare("update ingest_candidate set state = 'ready', target = 'orders' where id = ?").bind(a).run();
    await env.d1.prepare("update ingest_artifact set fill_above = ? where id = ?").bind(JSON.stringify({ answer: true, by: p.users.owner.id, at: 1 }), artifactId).run();
    await tick(p.owner, a);
    // Sheet b goes into orders: every other order sheet of the file is checked again (rule 11.3).
    await p.owner.ingest.candidate.setTarget({ candidateId: b, target: "orders", expectSeq: (await detail(p.owner, b)).serverSeq });
    expect(await tickOf(a)).toEqual(cleared);
  });

  test("a first fill-above answer leaves the tick of an approved order sheet alone (it is not re-run)", async () => {
    const BOOK = ["Party", "Order no", "PO", "Date", "Series", "Section", "Cut (mm)", "Baki (kg)"];
    const FIELDS = [
      { field: "customer", steps: [{ op: "trim" as const }, { op: "lookup" as const, resolver: "customer_by_name" as const }] },
      { field: "oldOrderNo", steps: trim },
      { field: "poNumber", steps: trim },
      { field: "orderDate", steps: [{ op: "date" as const, format: "dmy" as const }] },
      { field: "series", steps: [{ op: "trim" as const }, { op: "case" as const, to: "upper" as const }] },
      { field: "sectionCode", steps: [{ op: "trim" as const }, { op: "lookup" as const, resolver: "section_by_code" as const }] },
      { field: "cutLength", steps: [{ op: "number" as const, kind: "length" as const, unit: "mm" }] },
      { field: "bakiKg", steps: [{ op: "number" as const, kind: "mass" as const, unit: "kg" }] },
    ];
    const R = (no: string, po: string, date: string, sec: string) => ["Acme Traders", no, po, date, "R", sec, "3658", "100"];
    const TWO = (no: string) => [R(no, "PO-A", "01/05/2023", "5100"), R(no, "", "", "5101"), R(no, "PO-B", "01/06/2024", "5102"), R(no, "", "", "5103")];
    const p = await plant(env);
    await p.owner.customer.create({ name: "Acme Traders" });
    for (const code of ["5100", "5101", "5102", "5103"]) await env.seedDie(p.companyId, { series: "R", sectionCode: code });
    await learnLayout(env, p.companyId, p.users.owner.id, layout("orders", BOOK, FIELDS, ["customer", "oldOrderNo", "orderDate"]), "Book");
    const up = await upload(p.owner, [
      { name: "A", headers: BOOK, rows: TWO("41") },
      { name: "B", headers: BOOK, rows: TWO("43") },
    ]);
    const [a, b] = [up.candidates[0]!.id, up.candidates[1]!.id];
    await pump(p.owner, a);
    await pump(p.owner, b);
    // Sheet A stands for a model-read order sheet, ticked by the owner and then approved.
    await env.d1
      .prepare("update ingest_block set read_by = 'model', model_checked = 1, model_checked_by = ?, model_checked_at = 5 where id = (select block_id from ingest_candidate where id = ?)")
      .bind(p.users.owner.id, a)
      .run();
    await env.d1.prepare("update ingest_candidate set state = 'approved' where id = ?").bind(a).run();
    await p.owner.ingest.answer.set({ candidateId: b, questionCode: "order_fill_above", subject: "", answer: true, expectSeq: (await detail(p.owner, b)).serverSeq });
    expect(await tickOf(a)).toEqual({ checked: 1, by: p.users.owner.id, at: 5 });
  });
});

describe("hidden prices (decision 6)", () => {
  test("a person who cannot see a rate column of the table cannot tick it; one who can, can", async () => {
    const { p, candidates } = await modelSheets([RATES]);
    const id = candidates[0]!;
    // The admin may approve but has no order.price.
    await expect(tick(p.admin, id)).rejects.toThrow("Someone who can see prices must check this table.");
    expect(await tickOf(id)).toMatchObject({ checked: 0 });
    // A table with no rate column takes the admin's tick.
    const other = await modelSheets([PARTIES], p);
    expect((await tick(p.admin, other.candidates[0]!)).block.modelChecked).toBe(true);
    // The owner sees prices; the admin may still take a tick off.
    expect((await tick(p.owner, id)).block.modelChecked).toBe(true);
    expect((await tick(p.admin, id, false)).block.modelChecked).toBe(false);
  });
});

describe("fix cell (security L5, N3)", () => {
  test("a fixed rate cell keeps its text out of the audit row; another cell keeps it", async () => {
    const { p, candidates } = await modelSheets([RATES]);
    const id = candidates[0]!;
    let c = await detail(p.owner, id);
    c = await p.owner.ingest.vision.fixCell({ candidateId: id, expectSeq: c.serverSeq, rowIndex: 0, col: 1, text: "211" });
    await p.owner.ingest.vision.fixCell({ candidateId: id, expectSeq: c.serverSeq, rowIndex: 1, col: 0, text: "Om Alloys Pvt" });
    const audit = await env.d1.prepare("select meta from audit_log where company_id = ? and action = 'ingest.vision.fix' order by rowid").bind(p.companyId).all<{ meta: string }>();
    const metas = audit.results.map((r) => JSON.parse(r.meta));
    expect(metas[0]).toMatchObject({ rowIndex: 0, col: 1, from: null, to: null, rate: true });
    expect(JSON.stringify(metas[0])).not.toContain("211");
    expect(metas[1]).toMatchObject({ rowIndex: 1, col: 0, from: "Om Alloys", to: "Om Alloys Pvt" });
  });

  test("a failed sheet stays failed after a fix; the row and the tick still change", async () => {
    const { p, candidates } = await modelSheets([PARTIES]);
    const id = candidates[0]!;
    await tick(p.owner, id);
    await env.d1.prepare("update ingest_candidate set state = 'failed' where id = ?").bind(id).run();
    const fixed = await p.owner.ingest.vision.fixCell({ candidateId: id, expectSeq: (await detail(p.owner, id)).serverSeq, rowIndex: 0, col: 1, text: "Rajkot city" });
    expect(fixed.state).toBe("failed");
    expect(await tickOf(id)).toEqual(cleared);
  });
});
