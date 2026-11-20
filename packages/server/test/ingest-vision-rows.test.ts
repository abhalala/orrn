/**
 * Vision read, release 2 fix round: rows of a page (server review S2, S3, S4, S5).
 * - S3: model-read and typed rows count against the plant's rows per file and open rows.
 * - S4: a band with no table adds no rows; the page is still read.
 * - S5: a merged banded table over 500 rows is staged 500 rows a batch, and a stopped batch is finished
 *   by the next read with no model call.
 * - S2: a tables object that holds no table missing from the blocks makes the page "not read", never a
 *   rebuild loop.
 * Real D1, a Miniflare R2 bucket, the scripted `FakeShapeClient`. Synthetic pages and tables only.
 */
import { createHash, randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { Miniflare } from "miniflare";

import { workersEnv } from "./env-mock";
import { createTestEnv, type TestEnv } from "./harness";
import { plant, type Plant } from "./ingest-portal-helpers";
import { fakeResponse, FakeShapeClient, setShapeClientForTests } from "../src/lib/ingest/bot";
import { bandKey, pageKey, pageTablesKey, rawKey } from "../src/lib/ingest/vault";

let env: TestEnv;
let mf: Miniflare;
let bucket: R2Bucket;

beforeAll(async () => {
  env = await createTestEnv();
  mf = new Miniflare({ modules: true, script: "export default { fetch() { return new Response('ok'); } }", r2Buckets: ["VAULT"] });
  bucket = (await mf.getR2Bucket("VAULT")) as unknown as R2Bucket;
}, 60_000);

afterEach(() => {
  workersEnv.INGEST_VAULT = bucket;
  setShapeClientForTests(null);
});

afterAll(async () => {
  delete workersEnv.INGEST_VAULT;
  setShapeClientForTests(null);
  await mf.dispose();
  await env.dispose();
});

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 0xff, 0xd9]);
const S = "claude-sonnet-5-5";
const BH = ["Section", "Bundles", "Kg"];
const body = (from: number, n: number) => Array.from({ length: n }, (_, i) => [`S${from + i}`, String(from + i), String((from + i) * 3)]);
const sonnetTables = (...tables: { title?: string | null; headers?: string[]; rows: string[][] }[]) =>
  fakeResponse({ tables: tables.map((t) => ({ title: t.title ?? null, headers: t.headers ?? BH, rows: t.rows.map((cells) => ({ cells, confidence: 0.9 })) })) }, { modelUsed: S });

type File = { p: Plant; artifactId: string; sha: string };

async function startedPdf(opts: { pageCount?: number; kind?: "pdf_text" | "pdf_scan"; p?: Plant; pages?: boolean } = {}): Promise<File> {
  workersEnv.INGEST_VAULT = bucket;
  const p = opts.p ?? (await plant(env));
  const sha = createHash("sha256").update(randomUUID()).digest("hex");
  const bytes = new TextEncoder().encode(`synthetic ${sha}`);
  const begin = await p.owner.ingest.artifact.begin({ sha256: sha, fileName: "stock.pdf", sizeBytes: bytes.byteLength, contentType: "application/pdf", kind: opts.kind ?? "pdf_text" });
  await bucket.put(rawKey(p.companyId, sha), bytes);
  await p.owner.ingest.artifact.commitRaw({ artifactId: begin.artifactId });
  setShapeClientForTests(new FakeShapeClient([]));
  const pageCount = opts.pageCount ?? 1;
  await p.owner.ingest.vision.start({ artifactId: begin.artifactId, pageCount });
  if (opts.pages !== false) for (let n = 1; n <= pageCount; n++) await bucket.put(pageKey(p.companyId, sha, n), JPEG, { httpMetadata: { contentType: "image/jpeg" } });
  return { p, artifactId: begin.artifactId, sha };
}

const read = (f: File, page: number, band?: number) => f.p.owner.ingest.vision.readPage({ artifactId: f.artifactId, page, ...(band ? { band } : {}) });
const pageView = async (f: File, page: number) => (await f.p.owner.ingest.vision.pages({ artifactId: f.artifactId })).pages[page - 1]!;

async function inBands(f: File, total: number) {
  await f.p.owner.ingest.vision.bandTickets({ artifactId: f.artifactId, page: 1, bands: total });
  for (let k = 1; k <= total; k++) await bucket.put(bandKey(f.p.companyId, f.sha, 1, k), JPEG, { httpMetadata: { contentType: "image/jpeg" } });
}

async function stagedOf(f: File, blockOrdinalTitle?: string) {
  const got = await f.p.owner.ingest.artifact.get({ artifactId: f.artifactId });
  const block = blockOrdinalTitle ? got.blocks.find((b) => b.title === blockOrdinalTitle)! : got.blocks[0]!;
  const n = await env.d1.prepare("select count(*) as n from ingest_staged_row where company_id = ? and candidate_id = ?").bind(f.p.companyId, block.candidates[0]!.id).first<{ n: number }>();
  return { block, staged: Number(n!.n) };
}

describe("S4: a band with no table", () => {
  test("the last band holds only a footer: the page is read with the rows of the other bands", async () => {
    const f = await startedPdf({ pages: false });
    await inBands(f, 3);
    const client = new FakeShapeClient([sonnetTables({ rows: body(1, 60) }), sonnetTables({ rows: body(61, 60) }), sonnetTables()]);
    setShapeClientForTests(client);
    await read(f, 1);
    await read(f, 1);
    const v = await read(f, 1);
    expect(v).toMatchObject({ state: "read", tables: 1, bands: { total: 3, read: 3, next: null } });
    expect(client.calls).toHaveLength(3);
    const { block, staged } = await stagedOf(f);
    expect(block.rowCount).toBe(120);
    expect(staged).toBe(120);
  });
});

describe("S5: a merged banded table over 500 rows", () => {
  test("is staged 500 rows a batch; a batch that stopped is finished by the next read, with no call", async () => {
    const f = await startedPdf({ pages: false });
    await inBands(f, 4);
    const client = new FakeShapeClient([sonnetTables({ rows: body(1, 160) }), sonnetTables({ rows: body(161, 160) }), sonnetTables({ rows: body(321, 160) }), sonnetTables({ rows: body(481, 160) })]);
    setShapeClientForTests(client);
    for (let i = 0; i < 4; i++) await read(f, 1);
    expect(await pageView(f, 1)).toMatchObject({ state: "read" });
    let { block, staged } = await stagedOf(f);
    expect(block.rowCount).toBe(640);
    expect(block.rowsPut).toBe(640);
    expect(staged).toBe(640);

    // The Worker stopped after the first batch: rows 500 to 639 never landed.
    await env.d1.prepare("delete from ingest_staged_row where company_id = ? and candidate_id = ? and row_index >= 500").bind(f.p.companyId, block.candidates[0]!.id).run();
    await env.d1.prepare("update ingest_block set rows_put = 500 where id = ?").bind(block.id).run();
    expect(await pageView(f, 1)).toMatchObject({ state: "ready", next: "retry" });
    await expect(f.p.owner.ingest.artifact.complete({ artifactId: f.artifactId })).rejects.toThrow();

    expect(await read(f, 1)).toMatchObject({ state: "read" });
    expect(client.calls).toHaveLength(4);
    ({ block, staged } = await stagedOf(f));
    expect(block.rowsPut).toBe(640);
    expect(staged).toBe(640);
    const last = await env.d1
      .prepare("select raw from ingest_staged_row where company_id = ? and candidate_id = ? and row_index = 639")
      .bind(f.p.companyId, block.candidates[0]!.id)
      .first<{ raw: string }>();
    expect(JSON.parse(last!.raw)).toEqual(["S640", "640", "1920"]);
  });
});

describe("S5 with S3: a top-up at the row limit", () => {
  // Only a merged banded table passes 500 rows (one model table holds at most 500), so only a banded page
  // has a short block. Its top-up goes through the merge, which adds no row and is not refused at the limit.
  test("a file at its rows per file limit still finishes a stopped batch of a merged banded table", async () => {
    const p = await plant(env, { limits: { rawRowsPerFile: 640 } });
    const f = await startedPdf({ p, pages: false });
    await inBands(f, 4);
    const client = new FakeShapeClient([sonnetTables({ rows: body(1, 160) }), sonnetTables({ rows: body(161, 160) }), sonnetTables({ rows: body(321, 160) }), sonnetTables({ rows: body(481, 160) })]);
    setShapeClientForTests(client);
    for (let i = 0; i < 4; i++) await read(f, 1);
    const { block } = await stagedOf(f);
    await env.d1.prepare("delete from ingest_staged_row where company_id = ? and candidate_id = ? and row_index >= 500").bind(f.p.companyId, block.candidates[0]!.id).run();
    await env.d1.prepare("update ingest_block set rows_put = 500 where id = ?").bind(block.id).run();
    expect(await read(f, 1)).toMatchObject({ state: "read" });
    expect(client.calls).toHaveLength(4);
    const after = await stagedOf(f);
    expect(after.block.rowsPut).toBe(640);
    expect(after.staged).toBe(640);
  });
});

describe("S3: the plant's row limits", () => {
  test("rows per file: a page whose table passes it makes no block; a typed page too", async () => {
    const p = await plant(env, { limits: { rawRowsPerFile: 2 } });
    const f = await startedPdf({ p, pageCount: 2 });
    setShapeClientForTests(new FakeShapeClient([sonnetTables({ rows: body(1, 3) })]));
    await expect(read(f, 1)).rejects.toThrow("stock.pdf has more than 2 rows. Split it and try again.");
    expect((await f.p.owner.ingest.artifact.get({ artifactId: f.artifactId })).blocks).toHaveLength(0);
    await expect(
      f.p.owner.ingest.vision.typePage({ artifactId: f.artifactId, page: 2, title: null, headers: BH, rows: body(1, 3) }),
    ).rejects.toThrow("stock.pdf has more than 2 rows. Split it and try again.");
    expect(await f.p.owner.ingest.vision.typePage({ artifactId: f.artifactId, page: 2, title: null, headers: BH, rows: body(1, 2) })).toMatchObject({ state: "typed" });
  });

  test("open rows per plant: a plant at its limit is refused before the model is paid for the next page", async () => {
    const p = await plant(env, { limits: { openRowsPerPlant: 2 } });
    const f = await startedPdf({ p, pageCount: 2 });
    const client = new FakeShapeClient([sonnetTables({ rows: body(1, 2) }), sonnetTables({ rows: body(3, 2) })]);
    setShapeClientForTests(client);
    expect(await read(f, 1)).toMatchObject({ state: "read" });
    await expect(read(f, 2)).rejects.toThrow("Too many rows are waiting. Merge or discard older imports first.");
    expect(client.calls).toHaveLength(1);
  });

  test("open rows per plant: a page whose rows would pass it makes no block", async () => {
    const p = await plant(env, { limits: { openRowsPerPlant: 3 } });
    const f = await startedPdf({ p, pageCount: 2 });
    setShapeClientForTests(new FakeShapeClient([sonnetTables({ rows: body(1, 2) }), sonnetTables({ rows: body(3, 2) })]));
    expect(await read(f, 1)).toMatchObject({ state: "read" });
    await expect(read(f, 2)).rejects.toThrow("Too many rows are waiting. Merge or discard older imports first.");
    expect((await f.p.owner.ingest.artifact.get({ artifactId: f.artifactId })).blocks).toHaveLength(1);
  });
});

describe("S2: nothing left to rebuild", () => {
  test("a tables object that holds fewer tables than the blocks expect is not read, not a retry loop", async () => {
    const f = await startedPdf();
    setShapeClientForTests(new FakeShapeClient([sonnetTables({ title: "One", rows: body(1, 2) }, { title: "Two", rows: body(3, 2) })]));
    expect(await read(f, 1)).toMatchObject({ state: "read", tables: 2 });
    // Block "Two" is gone and the tables object now holds one table (an older overwrite).
    const got = await f.p.owner.ingest.artifact.get({ artifactId: f.artifactId });
    const two = got.blocks.find((b) => b.title === "Two")!;
    await env.d1.prepare("delete from ingest_block where id = ?").bind(two.id).run();
    const file = JSON.parse(await (await bucket.get(pageTablesKey(f.p.companyId, f.sha, 1)))!.text());
    await bucket.put(pageTablesKey(f.p.companyId, f.sha, 1), JSON.stringify({ ...file, tables: file.tables.slice(0, 1) }));
    expect(await pageView(f, 1)).toMatchObject({ state: "not_read", reason: "error", next: "manual" });
    expect(await read(f, 1)).toMatchObject({ state: "not_read", reason: "error", next: "manual" });
  });
});
