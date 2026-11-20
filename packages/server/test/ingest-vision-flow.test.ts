/**
 * Vision read, contract docs/superpowers/plans/2026-11-20-vision-read.md: a PDF or photo read page by page.
 * Real D1 and a real Miniflare R2 bucket (etag conditions behave as on Cloudflare), the scripted
 * `FakeShapeClient` for the model. Synthetic pages and tables only.
 */
import { createHash, randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { Miniflare } from "miniflare";

import { workersEnv } from "./env-mock";
import { createTestEnv, type TestEnv } from "./harness";
import { layout, learnLayout, plant, pump, trim, upload, type Caller, type Plant } from "./ingest-portal-helpers";
import { fakeRefusal, fakeResponse, FakeShapeClient, setShapeClientForTests } from "../src/lib/ingest/bot";
import { handleIngestRead, handleIngestUpload, pageKey, pagesIndexKey, pageTablesKey, rawKey } from "../src/lib/ingest/vault";
import { VISION_PARAMS, visionOrdinal, visionPageKey } from "@orrn/ingest";

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

const NO_STORAGE = "PDFs and photos need file storage, which is not set up for this plant. Ask orrn support to turn it on.";
const NOT_READ = "PDFs and photos are kept, not read, in this release. They will be read in a later release.";
const NOT_STORED = "The original file is not saved yet. Upload the same file again, then approve.";
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 0xff, 0xd9]);

const S = "claude-sonnet-5-5";
const sonnet = (json: unknown, over = {}) => fakeResponse(json, { modelUsed: S, ...over });
const table = (over: Record<string, unknown> = {}) => ({
  title: "Party list",
  headers: ["Party name", "City"],
  rows: [["Nova Metals", "Rajkot"], ["Om Alloys", "Surat"], ["Sai Traders", ""]],
  rowConfidence: [0.95, 0.4, 0.6],
  ...over,
});
const tables = (...t: unknown[]) => ({ tables: t });

type File = { p: Plant; artifactId: string; sha: string };

/**
 * The Miniflare bucket lives in another process: a stream crossing into it needs a known length, and an
 * object body cannot cross back into a Response. These wrappers buffer at that boundary (the Worker's own
 * R2 binding takes the request stream and returns a body directly).
 */
const routeBucket = () =>
  ({
    head: (k: string) => bucket.head(k),
    put: async (k: string, v: ReadableStream | Uint8Array, o?: R2PutOptions) => bucket.put(k, v instanceof Uint8Array ? v : new Uint8Array(await new Response(v).arrayBuffer()), o),
    get: async (k: string) => {
      const o = await bucket.get(k);
      return o && { size: o.size, body: new Uint8Array(await o.arrayBuffer()) };
    },
  }) as unknown as R2Bucket;

/** A kept PDF or photo with its raw bytes stored. */
async function keptFile(opts: { kind?: "pdf_text" | "pdf_scan" | "image"; store?: boolean; p?: Plant } = {}): Promise<File> {
  workersEnv.INGEST_VAULT = bucket;
  const p = opts.p ?? (await plant(env));
  const kind = opts.kind ?? "pdf_scan";
  const sha = createHash("sha256").update(randomUUID()).digest("hex");
  const bytes = new TextEncoder().encode(`synthetic ${sha}`);
  const fileName = kind === "image" ? "slip.jpg" : "stock.pdf";
  const begin = await p.owner.ingest.artifact.begin({ sha256: sha, fileName, sizeBytes: bytes.byteLength, contentType: kind === "image" ? "image/jpeg" : "application/pdf", kind });
  if (opts.store !== false) {
    await bucket.put(rawKey(p.companyId, sha), bytes);
    await p.owner.ingest.artifact.commitRaw({ artifactId: begin.artifactId });
  }
  return { p, artifactId: begin.artifactId, sha };
}

async function putPage(f: File, n: number) {
  await bucket.put(pageKey(f.p.companyId, f.sha, n), JPEG, { httpMetadata: { contentType: "image/jpeg" } });
}

/** Started, with pages 1..uploaded stored. */
async function started(pageCount: number, uploaded = pageCount, opts: Parameters<typeof keptFile>[0] = {}) {
  const f = await keptFile(opts);
  setShapeClientForTests(new FakeShapeClient([]));
  const out = await f.p.owner.ingest.vision.start({ artifactId: f.artifactId, pageCount });
  for (let n = 1; n <= uploaded; n++) await putPage(f, n);
  return { ...f, out };
}

const read = (as: Caller, artifactId: string, page: number) => as.ingest.vision.readPage({ artifactId, page });
const pagesOf = (f: File) => f.p.owner.ingest.vision.pages({ artifactId: f.artifactId });

async function runRows(f: File, page: number) {
  const r = await env.d1
    .prepare("select block_id, candidate_id, purpose, model, outcome, error_codes from ingest_bot_run where company_id = ? and block_id = ? order by created_at, attempt")
    .bind(f.p.companyId, visionPageKey(f.artifactId, page))
    .all<{ block_id: string; candidate_id: string | null; purpose: string; model: string; outcome: string; error_codes: string | null }>();
  return r.results;
}

describe("vision.start", () => {
  test("refusals keep today's words: no vault, no model route, bytes not stored, a sheet, a read file", async () => {
    const f = await keptFile();
    setShapeClientForTests(new FakeShapeClient([]));
    delete workersEnv.INGEST_VAULT;
    await expect(f.p.owner.ingest.vision.start({ artifactId: f.artifactId, pageCount: 2 })).rejects.toThrow(NO_STORAGE);
    expect((await f.p.owner.ingest.status()).visionReady).toBe(false);
    workersEnv.INGEST_VAULT = bucket;
    expect((await f.p.owner.ingest.status()).visionReady).toBe(true);

    setShapeClientForTests(null);
    expect((await f.p.owner.ingest.status()).visionReady).toBe(false);
    await expect(f.p.owner.ingest.vision.start({ artifactId: f.artifactId, pageCount: 2 })).rejects.toThrow(NOT_READ);
    expect((await f.p.owner.ingest.artifact.get({ artifactId: f.artifactId })).readState).toBe("kept_unread");

    setShapeClientForTests(new FakeShapeClient([]));
    const unstored = await keptFile({ store: false, p: f.p });
    await expect(f.p.owner.ingest.vision.start({ artifactId: unstored.artifactId, pageCount: 2 })).rejects.toThrow(NOT_STORED);

    const { artifactId: sheetId } = await upload(f.p.owner, [{ headers: ["Party name", "City"], rows: [["Nova Metals", "Rajkot"]] }]);
    await expect(f.p.owner.ingest.vision.start({ artifactId: sheetId, pageCount: 1 })).rejects.toThrow("Only PDFs and photos are read page by page");

    await f.p.owner.ingest.vision.start({ artifactId: f.artifactId, pageCount: 1 });
    await f.p.owner.ingest.vision.skipPage({ artifactId: f.artifactId, page: 1 });
    await f.p.owner.ingest.artifact.complete({ artifactId: f.artifactId });
    await expect(f.p.owner.ingest.vision.start({ artifactId: f.artifactId, pageCount: 1 })).rejects.toThrow("This file is already read");
  });

  test("start moves kept_unread to reading, writes the page plan once, and hands page tickets for pages with no image", async () => {
    const f = await keptFile({ kind: "pdf_text" });
    setShapeClientForTests(new FakeShapeClient([]));
    const out = await f.p.owner.ingest.vision.start({ artifactId: f.artifactId, pageCount: 45 });
    expect(out.pageCount).toBe(45);
    expect(out.planned).toBe(VISION_PARAMS.maxPagesPerFile);
    expect(out.uploads.map((u) => u.page)).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
    expect(out.uploads[0]!.url).toContain("/files/ingest/upload?ticket=");
    expect((await f.p.owner.ingest.artifact.get({ artifactId: f.artifactId })).readState).toBe("reading");
    const index = JSON.parse(await (await bucket.get(pagesIndexKey(f.p.companyId, f.sha)))!.text());
    expect(index).toMatchObject({ v: 1, pageCount: 45, planned: 30, skipped: [], startedBy: f.p.users.owner.id });
    const audit = await env.d1.prepare("select count(*) as n from audit_log where company_id = ? and action = 'ingest.vision.start'").bind(f.p.companyId).first<{ n: number }>();
    expect(Number(audit?.n)).toBe(1);

    // The page goes up by its ticket, through the real upload route, with the page limits.
    const res = await handleIngestUpload(new Request(out.uploads[1]!.url, { method: "PUT", body: JPEG, headers: { "content-length": String(JPEG.byteLength) } }), { bucket: routeBucket() });
    expect(res.status).toBe(200);
    const big = await handleIngestUpload(new Request(out.uploads[2]!.url, { method: "PUT", body: JPEG, headers: { "content-length": String(VISION_PARAMS.maxPageBytes + 1) } }), { bucket: routeBucket() });
    expect(big.status).toBe(413);

    // A second start (reload, another tab) resumes the same plan and asks only for the missing pages.
    const again = await f.p.owner.ingest.vision.start({ artifactId: f.artifactId, pageCount: 12 });
    expect(again).toMatchObject({ pageCount: 45, planned: 30 });
    expect(again.uploads.map((u) => u.page)).not.toContain(2);
    expect(again.uploads).toHaveLength(29);
  });
});

describe("vision.readPage", () => {
  test("page states before a read: waiting, upload first, past the plan, ready", async () => {
    const f = await started(3, 1);
    const pages = await pagesOf(f);
    expect(pages).toMatchObject({ pageCount: 3, planned: 3, settled: false });
    expect(pages.pages.map((p) => [p.page, p.state, p.next])).toEqual([
      [1, "ready", null],
      [2, "waiting", null],
      [3, "waiting", null],
    ]);
    await expect(read(f.p.owner, f.artifactId, 2)).rejects.toThrow("Upload this page first");
    await expect(read(f.p.owner, f.artifactId, 4)).rejects.toThrow("This page is past the pages read for this file");
  });

  test("a read page becomes blocks: ordinals, model facts, candidates, staged rows, the run row keyed to the page", async () => {
    const f = await started(2);
    const client = new FakeShapeClient([sonnet(tables(table(), table({ title: null, headers: ["Item", "Qty"], rows: [["Bolt", "12"]], rowConfidence: [0.9] })))]);
    setShapeClientForTests(client);
    const view = await read(f.p.owner, f.artifactId, 1);
    expect(view).toMatchObject({ page: 1, state: "read", reason: null, next: "done", attempts: 1, tables: 2 });
    expect(view.blockIds).toHaveLength(2);
    expect(client.calls[0]).toMatchObject({ model: S, purpose: "vision" });

    const runs = await runRows(f, 1);
    expect(runs).toEqual([{ block_id: `${f.artifactId}:p1`, candidate_id: null, purpose: "vision", model: S, outcome: "recipe", error_codes: null }]);

    const got = await f.p.owner.ingest.artifact.get({ artifactId: f.artifactId });
    expect(got).toMatchObject({ readState: "reading", blockCount: 2, rowCount: 4 });
    const [b0, b1] = got.blocks;
    expect(b0).toMatchObject({ ordinal: visionOrdinal(1, 0), sheetName: null, title: "Party list", headerRow: 0, headerRows: 1, readBy: "model", modelChecked: false, rowCount: 3, rowsPut: 3, headers: ["Party name", "City"] });
    expect(b0!.vision).toEqual({ page: 1, table: 0, pageCount: 2, rowConfidence: [0.95, 0.4, 0.6], lowRows: [1, 2] });
    expect(b1).toMatchObject({ ordinal: visionOrdinal(1, 1), readBy: "model", rowCount: 1 });
    expect(b0!.candidates).toHaveLength(1);
    expect(b0!.candidates[0]!.counts.total).toBe(3);
    const stored = await env.d1
      .prepare("select reader_facts from ingest_block where id = ?")
      .bind(b0!.id)
      .first<{ reader_facts: string }>();
    expect(JSON.parse(stored!.reader_facts).vision).toEqual({ page: 1, table: 0, pageCount: 2, rowConfidence: [0.95, 0.4, 0.6], tables: 2 });
    const staged = await env.d1.prepare("select count(*) as n from ingest_staged_row where candidate_id = ? and state = 'pending'").bind(b0!.candidates[0]!.id).first<{ n: number }>();
    expect(Number(staged?.n)).toBe(3);
    const tablesFile = JSON.parse(await (await bucket.get(pageTablesKey(f.p.companyId, f.sha, 1)))!.text());
    expect(tablesFile).toMatchObject({ v: 1, model: S, tables: [{ title: "Party list" }, { title: null }] });
    const audit = await env.d1.prepare("select count(*) as n from audit_log where company_id = ? and action = 'ingest.vision.page'").bind(f.p.companyId).first<{ n: number }>();
    expect(Number(audit?.n)).toBe(2);

    // A read page answers with no call.
    expect(await read(f.p.owner, f.artifactId, 1)).toMatchObject({ state: "read" });
    expect(client.calls).toHaveLength(1);
    // Its model block takes the helper (no longer refused) and refuses a header pick.
    const c = b0!.candidates[0]!;
    await expect(f.p.owner.ingest.candidate.repickHeader({ candidateId: c.id, expectSeq: c.serverSeq })).rejects.toThrow("This table was read from a page. Fix a cell or discard it.");
  });

  test("a model block with no known layout takes the column helper (no longer refused for a PDF)", async () => {
    const f = await started(1);
    const answers = [tables(table({ headers: ["Kachha maal", "Vazan"], rows: [["Om Metals", "120"]], rowConfidence: [0.9] })), { result: { kind: "no_target", reason: "not_a_table" } }];
    const seen: string[] = [];
    setShapeClientForTests({
      async call(req) {
        seen.push(req.purpose);
        return fakeResponse(answers.shift(), { modelUsed: req.model });
      },
    });
    await read(f.p.owner, f.artifactId, 1);
    const c = (await f.p.owner.ingest.artifact.get({ artifactId: f.artifactId })).blocks[0]!.candidates[0]!;
    expect(c.state).toBe("needs_shape");
    const out = await f.p.owner.ingest.shape.make({ candidateId: c.id, expectSeq: c.serverSeq });
    expect(out.outcome).toBe("no_target");
    expect(seen).toEqual(["vision", "shape"]);
  });

  test("an invalid answer is retried once on Sonnet with its codes, a second invalid answer is manual", async () => {
    const f = await started(1);
    const bad = tables(table({ rowConfidence: [0.9] }));
    const client = new FakeShapeClient([sonnet(bad), sonnet(bad)]);
    setShapeClientForTests(client);
    expect(await read(f.p.owner, f.artifactId, 1)).toMatchObject({ state: "ready", next: "retry", attempts: 1 });
    expect(await read(f.p.owner, f.artifactId, 1)).toMatchObject({ state: "not_read", reason: "invalid", canRetry: false, next: "manual", attempts: 2 });
    const text = (client.calls[1]!.messages[0]!.content as { text?: string }[]).map((p) => p.text ?? "").join("\n");
    expect(text).toContain("vision:confidence_count:0");
    expect(client.calls.map((c) => c.model)).toEqual([S, S]);
    // Manual: no third call.
    expect(await read(f.p.owner, f.artifactId, 1)).toMatchObject({ state: "not_read", reason: "invalid" });
    expect(client.calls).toHaveLength(2);
  });

  test("a truncated answer twice is too_long; a refusal is manual at once; a page with no table is no_table", async () => {
    const f = await started(3);
    setShapeClientForTests(new FakeShapeClient([sonnet(null, { stopReason: "max_tokens" }), sonnet(null, { stopReason: "max_tokens" }), fakeRefusal({ modelUsed: S }), sonnet(tables())]));
    await read(f.p.owner, f.artifactId, 1);
    expect(await read(f.p.owner, f.artifactId, 1)).toMatchObject({ state: "not_read", reason: "too_long", next: "manual" });
    expect(await read(f.p.owner, f.artifactId, 2)).toMatchObject({ state: "not_read", reason: "refused", canRetry: false, attempts: 1 });
    expect(await read(f.p.owner, f.artifactId, 3)).toMatchObject({ state: "not_read", reason: "no_table", canRetry: false, attempts: 1 });
  });

  test("two transport errors in a row are manual", async () => {
    const f = await started(1);
    const { ShapeClientError } = await import("../src/lib/ingest/bot");
    setShapeClientForTests(new FakeShapeClient([new ShapeClientError("network", "down"), new ShapeClientError("network", "down")]));
    expect(await read(f.p.owner, f.artifactId, 1)).toMatchObject({ state: "ready", next: "retry" });
    expect(await read(f.p.owner, f.artifactId, 1)).toMatchObject({ state: "not_read", reason: "error", canRetry: false });
  });

  test("day caps: a capped page is not read with its reason, may be read again, and the capped row is not a call", async () => {
    const f = await started(2);
    const { setClockForTests } = await import("../src/lib/clock");
    setClockForTests(new Date("2026-11-20T06:00:00Z"));
    const at = new Date("2026-11-20T05:00:00Z").getTime();
    const ins = env.d1.prepare(
      "insert into ingest_bot_run (id, company_id, block_id, purpose, model, attempt, outcome, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_micro_usd, duration_ms, created_at) values (?, ?, ?, 'shape', ?, 1, 'recipe', 0, 0, 0, 0, ?, 0, ?)",
    );
    await env.d1.batch(Array.from({ length: 300 }, (_, i) => ins.bind(`seed_${f.artifactId}_${i}`, f.p.companyId, `other_${i}`, S, 0, at)));
    const client = new FakeShapeClient([sonnet(tables(table()))]);
    setShapeClientForTests(client);
    expect(await read(f.p.owner, f.artifactId, 1)).toMatchObject({ state: "not_read", reason: "cap_day_calls", canRetry: true, attempts: 0 });
    expect(client.calls).toHaveLength(0);
    expect((await runRows(f, 1)).map((r) => r.outcome)).toEqual(["capped"]);

    // The next plant day the page reads.
    setClockForTests(new Date("2026-11-21T06:00:00Z"));
    expect(await read(f.p.owner, f.artifactId, 1)).toMatchObject({ state: "read", attempts: 1 });

    // Cost: one run of 5 USD today caps page 2.
    await env.d1.prepare("insert into ingest_bot_run (id, company_id, block_id, purpose, model, attempt, outcome, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_micro_usd, duration_ms, created_at) values (?, ?, 'x', 'shape', ?, 1, 'recipe', 0, 0, 0, 0, 5000000, 0, ?)")
      .bind(`cost_${f.artifactId}`, f.p.companyId, S, new Date("2026-11-21T05:30:00Z").getTime())
      .run();
    expect(await read(f.p.owner, f.artifactId, 2)).toMatchObject({ state: "not_read", reason: "cap_day_cost", canRetry: true });
  });

  test("a batch that stops after table 0 leaves the page not read; complete refuses; the next read rebuilds it with no model call", async () => {
    const f = await started(1);
    const client = new FakeShapeClient([sonnet(tables(table(), table({ title: "Second", headers: ["Item", "Qty"], rows: [["Bolt", "12"]], rowConfidence: [0.9] })))]);
    setShapeClientForTests(client);
    let blockInserts = 0;
    const stopSecond = () =>
      env.beforeStatement(/insert into "ingest_block"/, async () => {
        blockInserts += 1;
        if (blockInserts === 1) stopSecond();
        else throw new Error("Worker stopped");
      });
    stopSecond();
    await expect(read(f.p.owner, f.artifactId, 1)).rejects.toThrow("Worker stopped");
    const pages = await pagesOf(f);
    expect(pages.pages[0]).toMatchObject({ state: "ready", next: "retry", tables: 2 });
    expect(pages.pages[0]!.blockIds).toHaveLength(1);
    expect(pages.settled).toBe(false);
    await expect(f.p.owner.ingest.artifact.complete({ artifactId: f.artifactId })).rejects.toThrow("Some pages are not read yet. Read, type or skip each page first.");
    expect(await read(f.p.owner, f.artifactId, 1)).toMatchObject({ state: "read", tables: 2, attempts: 1 });
    expect(client.calls).toHaveLength(1);
    expect((await f.p.owner.ingest.artifact.get({ artifactId: f.artifactId })).blockCount).toBe(2);
  });

  test("a recipe run whose tables never reached the vault is not read (error) and may be read again", async () => {
    const f = await started(1);
    const client = new FakeShapeClient([sonnet(tables(table())), sonnet(tables(table()))]);
    setShapeClientForTests(client);
    env.beforeStatement(/insert into "ingest_block"/, async () => {
      throw new Error("Worker stopped");
    });
    await expect(read(f.p.owner, f.artifactId, 1)).rejects.toThrow("Worker stopped");
    await bucket.delete(pageTablesKey(f.p.companyId, f.sha, 1));
    expect((await pagesOf(f)).pages[0]).toMatchObject({ state: "not_read", reason: "error", canRetry: true, next: "manual" });
    expect(await read(f.p.owner, f.artifactId, 1)).toMatchObject({ state: "read", attempts: 2 });
  });

  test("a file with no room for another table: the page is not read with too_many_tables and the model is not asked", async () => {
    const f = await started(1);
    await env.d1.prepare("update ingest_artifact set block_count = 50 where id = ?").bind(f.artifactId).run();
    const client = new FakeShapeClient([sonnet(tables(table()))]);
    setShapeClientForTests(client);
    expect(await read(f.p.owner, f.artifactId, 1)).toMatchObject({ state: "not_read", reason: "too_many_tables", canRetry: false, next: "manual" });
    expect(client.calls).toHaveLength(0);
  });
});

describe("skip, type and complete", () => {
  test("skip and type settle a page; complete waits for every planned page, then reads the file with no canonical uploads", async () => {
    const f = await started(3);
    setShapeClientForTests(new FakeShapeClient([sonnet(tables(table())), sonnet(tables())]));
    await read(f.p.owner, f.artifactId, 1);
    expect(await read(f.p.owner, f.artifactId, 2)).toMatchObject({ state: "not_read", reason: "no_table" });
    await expect(f.p.owner.ingest.artifact.complete({ artifactId: f.artifactId })).rejects.toThrow("Some pages are not read yet. Read, type or skip each page first.");

    const typed = await f.p.owner.ingest.vision.typePage({ artifactId: f.artifactId, page: 2, title: " Typed ", headers: ["Party name", "City"], rows: [["Lakshmi Ind", "Vapi"]] });
    expect(typed).toMatchObject({ state: "typed", next: "done", tables: 1 });
    await expect(f.p.owner.ingest.vision.typePage({ artifactId: f.artifactId, page: 2, title: null, headers: ["A"], rows: [["1"]] })).rejects.toThrow("This page is already read");
    await expect(f.p.owner.ingest.vision.skipPage({ artifactId: f.artifactId, page: 1 })).rejects.toThrow("This page is already read");
    expect(await f.p.owner.ingest.vision.skipPage({ artifactId: f.artifactId, page: 3 })).toMatchObject({ state: "skipped", next: "done" });
    expect(await f.p.owner.ingest.vision.skipPage({ artifactId: f.artifactId, page: 3 })).toMatchObject({ state: "skipped" });

    const pages = await pagesOf(f);
    expect(pages.settled).toBe(true);
    expect(pages.pages.map((p) => p.state)).toEqual(["read", "typed", "skipped"]);
    const got = await f.p.owner.ingest.artifact.get({ artifactId: f.artifactId });
    const typedBlock = got.blocks.find((b) => b.ordinal === visionOrdinal(2, 0))!;
    expect(typedBlock).toMatchObject({ readBy: "parser", title: "Typed", rowCount: 1, modelChecked: false });
    expect(typedBlock.vision).toEqual({ page: 2, table: 0, pageCount: 3, rowConfidence: [], lowRows: [], typed: true });

    expect(await f.p.owner.ingest.artifact.complete({ artifactId: f.artifactId })).toEqual({ canonicalUploads: [] });
    expect(await f.p.owner.ingest.artifact.complete({ artifactId: f.artifactId })).toEqual({ canonicalUploads: [] });
    const done = await f.p.owner.ingest.artifact.get({ artifactId: f.artifactId });
    expect(done).toMatchObject({ readState: "read", blockCount: 2, rowCount: 4 });
    expect(await bucket.head(`tenants/${f.p.companyId}/artifacts/${f.sha}/digest.json`)).not.toBeNull();
    await expect(read(f.p.owner, f.artifactId, 3)).rejects.toThrow("This file is not being read page by page");
  });

  test("a skip that loses a race on the page plan is CONFLICT (R2 etag condition)", async () => {
    const f = await started(2);
    const key = pagesIndexKey(f.p.companyId, f.sha);
    let raced = false;
    workersEnv.INGEST_VAULT = new Proxy(bucket, {
      get(target, prop) {
        if (prop === "put")
          return async (k: string, v: unknown, o?: R2PutOptions) => {
            if (k === key && o?.onlyIf && !raced) {
              raced = true;
              const cur = JSON.parse(await (await target.get(key))!.text());
              await target.put(key, JSON.stringify({ ...cur, skipped: [2] }));
            }
            return target.put(k, v as string, o);
          };
        const val = Reflect.get(target, prop);
        return typeof val === "function" ? val.bind(target) : val;
      },
    });
    await expect(f.p.owner.ingest.vision.skipPage({ artifactId: f.artifactId, page: 1 })).rejects.toThrow("This import changed in another tab. Reload and try again.");
    workersEnv.INGEST_VAULT = bucket;
    expect((await pagesOf(f)).pages.map((p) => p.state)).toEqual(["ready", "skipped"]);
  });
});

describe("the tick", () => {
  async function readyModelSheet() {
    const f = await started(1);
    await learnLayout(env, f.p.companyId, f.p.users.owner.id, layout("customers", ["Party name", "City"], [{ field: "name", steps: trim }, { field: "city", steps: trim }], ["name"]), "Parties");
    setShapeClientForTests(new FakeShapeClient([sonnet(tables(table({ rowConfidence: [0.9, 0.9, 0.9] })))]));
    await read(f.p.owner, f.artifactId, 1);
    await f.p.owner.ingest.artifact.complete({ artifactId: f.artifactId });
    const got = await f.p.owner.ingest.artifact.get({ artifactId: f.artifactId });
    const c = got.blocks[0]!.candidates[0]!;
    await pump(f.p.owner, c.id);
    return { f, candidateId: c.id };
  }
  const detail = (as: Caller, candidateId: string) => as.ingest.candidate.get({ candidateId });

  test("approve is refused without the tick; check sets it (seq moves, audited); approve then lands", async () => {
    const { f, candidateId } = await readyModelSheet();
    let c = await detail(f.p.owner, candidateId);
    expect(c.state).toBe("ready");
    await expect(f.p.owner.ingest.candidate.approve({ candidateId, expectSeq: c.serverSeq })).rejects.toThrow("Check these rows against the page first");
    const ticked = await f.p.owner.ingest.vision.check({ candidateId, expectSeq: c.serverSeq, checked: true });
    expect(ticked.serverSeq).toBe(c.serverSeq + 1);
    expect(ticked.block.modelChecked).toBe(true);
    const audit = await env.d1.prepare("select meta from audit_log where company_id = ? and action = 'ingest.vision.check'").bind(f.p.companyId).first<{ meta: string }>();
    expect(JSON.parse(audit!.meta)).toMatchObject({ checked: true });
    c = await detail(f.p.owner, candidateId);
    expect((await f.p.owner.ingest.candidate.approve({ candidateId, expectSeq: c.serverSeq })).state).toBe("approved");
    // Approved is not editable: the tick no longer changes.
    c = await detail(f.p.owner, candidateId);
    await expect(f.p.owner.ingest.vision.check({ candidateId, expectSeq: c.serverSeq, checked: false })).rejects.toThrow("Rows of this import can no longer change");
  });

  test("a tick cleared between the approve's read and its write fails the approve", async () => {
    const { f, candidateId } = await readyModelSheet();
    let c = await detail(f.p.owner, candidateId);
    await f.p.owner.ingest.vision.check({ candidateId, expectSeq: c.serverSeq, checked: true });
    c = await detail(f.p.owner, candidateId);
    env.beforeNextBatch(async () => {
      await env.d1.prepare("update ingest_block set model_checked = 0 where id = ?").bind(c.blockId).run();
    });
    await expect(f.p.owner.ingest.candidate.approve({ candidateId, expectSeq: c.serverSeq })).rejects.toThrow("Check these rows against the page first");
    expect((await detail(f.p.owner, candidateId)).state).toBe("ready");
  });

  test("rows.decide on a model block clears the tick in the same batch", async () => {
    const { f, candidateId } = await readyModelSheet();
    let c = await detail(f.p.owner, candidateId);
    await f.p.owner.ingest.vision.check({ candidateId, expectSeq: c.serverSeq, checked: true });
    c = await detail(f.p.owner, candidateId);
    const rows = await f.p.owner.ingest.rows.list({ candidateId, limit: 10 });
    await f.p.owner.ingest.rows.decide({ candidateId, rowIds: [rows.items[0]!.id], decision: "skip", expectSeq: c.serverSeq });
    expect((await detail(f.p.owner, candidateId)).block.modelChecked).toBe(false);
  });

  test("check refuses a sheet read by code; a typed page needs no tick", async () => {
    const p = await plant(env);
    const { candidates } = await upload(p.owner, [{ headers: ["Kachha maal", "Vazan"], rows: [["Om Metals", "120"]] }]);
    const c = await detail(p.owner, candidates[0]!.id);
    await expect(p.owner.ingest.vision.check({ candidateId: c.id, expectSeq: c.serverSeq, checked: true })).rejects.toThrow("Only a table read from a page is checked against it");
  });
});

describe("vision.readUrl", () => {
  test("signs a read of the caller's own file only; a missing object is not found; the page reads back inline", async () => {
    const f = await started(1);
    const raw = await f.p.owner.ingest.vision.readUrl({ artifactId: f.artifactId, what: "raw" });
    expect(raw.url).toContain("/files/ingest/read?ticket=");
    const res = await handleIngestRead(new Request(raw.url), { bucket: routeBucket() });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe("attachment");
    const page = await f.p.owner.ingest.vision.readUrl({ artifactId: f.artifactId, what: "page", page: 1 });
    const pr = await handleIngestRead(new Request(page.url), { bucket: routeBucket() });
    expect(pr.headers.get("content-type")).toBe("image/jpeg");
    expect(new Uint8Array(await pr.arrayBuffer())).toEqual(JPEG);
    await expect(f.p.owner.ingest.vision.readUrl({ artifactId: f.artifactId, what: "page", page: 2 })).rejects.toThrow("Import file not found");

    // Another plant's caller cannot name this artifact.
    const other = await plant(env);
    await expect(other.owner.ingest.vision.readUrl({ artifactId: f.artifactId, what: "raw" })).rejects.toThrow("Import file not found");
    // A viewer of the file page (merge) may read it.
    expect((await f.p.as("admin").ingest.vision.readUrl({ artifactId: f.artifactId, what: "raw" })).url).toContain("ticket=");
  });
});
