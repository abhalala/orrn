/**
 * Vision read, release 2 fix round (server review S1, S2, N10; lead decision 8): the claim before each
 * vision call. Two tabs that read the same page, or two pages near the day cost cap, pay for at most one
 * call; the tables object is written once; a rebuild that finds nothing throws instead of looping.
 * Real D1, a Miniflare R2 bucket, a fake model client that holds its answer until the test lets it go.
 * Synthetic pages and tables only.
 */
import { createHash, randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { Miniflare } from "miniflare";

import { workersEnv } from "./env-mock";
import { createTestEnv, type TestEnv } from "./harness";
import { plant, type Plant } from "./ingest-portal-helpers";
import { fakeResponse, FakeShapeClient, setShapeClientForTests, VISION_WORST_COST_MICRO, type ShapeModelClient, type ShapeResponse } from "../src/lib/ingest/bot";
import { pageKey, pagesIndexKey, pageTablesKey, rawKey } from "../src/lib/ingest/vault";
import { visionPageKey } from "@orrn/ingest";

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

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 0xff, 0xd9]);
const S = "claude-sonnet-5-5";
const answer = (title: string, rows = 1) =>
  fakeResponse(
    { tables: [{ title, headers: ["Party name", "City"], rows: Array.from({ length: rows }, (_, i) => ({ cells: [`Party ${i + 1}`, "Rajkot"], confidence: 0.9 })) }] },
    { modelUsed: S, usage: { input: 5_000, output: 2_000, cacheRead: 0, cacheWrite: 0 } },
  );

/** Answers each call with the next response, but only once the test opens the gate. */
class GateClient implements ShapeModelClient {
  calls = 0;
  private open!: () => void;
  private readonly gate = new Promise<void>((r) => (this.open = r));
  constructor(private readonly answers: ShapeResponse[]) {}
  release() {
    this.open();
  }
  async call(): Promise<ShapeResponse> {
    const res = this.answers[this.calls++];
    await this.gate;
    if (!res) throw new Error("no scripted answer");
    return res;
  }
}

async function until(check: () => boolean) {
  for (let i = 0; i < 400 && !check(); i++) await new Promise((r) => setTimeout(r, 5));
  expect(check()).toBe(true);
}

type File = { p: Plant; artifactId: string; sha: string };

async function startedPdf(pageCount: number, p?: Plant): Promise<File> {
  workersEnv.INGEST_VAULT = bucket;
  const owner = p ?? (await plant(env));
  const sha = createHash("sha256").update(randomUUID()).digest("hex");
  const bytes = new TextEncoder().encode(`synthetic ${sha}`);
  const begin = await owner.owner.ingest.artifact.begin({ sha256: sha, fileName: "stock.pdf", sizeBytes: bytes.byteLength, contentType: "application/pdf", kind: "pdf_scan" });
  await bucket.put(rawKey(owner.companyId, sha), bytes);
  await owner.owner.ingest.artifact.commitRaw({ artifactId: begin.artifactId });
  setShapeClientForTests(new FakeShapeClient([]));
  await owner.owner.ingest.vision.start({ artifactId: begin.artifactId, pageCount });
  for (let n = 1; n <= pageCount; n++) await bucket.put(pageKey(owner.companyId, sha, n), JPEG, { httpMetadata: { contentType: "image/jpeg" } });
  return { p: owner, artifactId: begin.artifactId, sha };
}

const read = (f: File, page: number) => f.p.owner.ingest.vision.readPage({ artifactId: f.artifactId, page });

async function outcomes(f: File, page: number): Promise<string[]> {
  const r = await env.d1
    .prepare("select outcome from ingest_bot_run where company_id = ? and block_id = ? order by created_at, attempt")
    .bind(f.p.companyId, visionPageKey(f.artifactId, page))
    .all<{ outcome: string }>();
  return r.results.map((x) => x.outcome);
}

describe("the claim before each vision call", () => {
  test("two tabs read one page at once: one call is paid, the other tab waits with no call, one set of blocks", async () => {
    const f = await startedPdf(1);
    const client = new GateClient([answer("First"), answer("Second", 3)]);
    setShapeClientForTests(client);
    const tabA = read(f, 1);
    await until(() => client.calls === 1);
    // Tab B while A's call is in flight: the page answers that it is being read, with nothing to do now.
    const tabB = await read(f, 1);
    expect(tabB).toMatchObject({ page: 1, state: "ready", next: null });
    expect(client.calls).toBe(1);
    expect(await outcomes(f, 1)).toEqual(["pending"]);
    client.release();
    expect(await tabA).toMatchObject({ state: "read", tables: 1 });
    // B reads again: the page is read, with A's table; no second call.
    expect(await read(f, 1)).toMatchObject({ state: "read", tables: 1 });
    expect(client.calls).toBe(1);
    expect(await outcomes(f, 1)).toEqual(["recipe"]);
    const stored = JSON.parse(await (await bucket.get(pageTablesKey(f.p.companyId, f.sha, 1)))!.text());
    expect(stored.tables.map((t: { title: string }) => t.title)).toEqual(["First"]);
    expect((await f.p.owner.ingest.artifact.get({ artifactId: f.artifactId })).blockCount).toBe(1);
  });

  test("near the day cost cap, a second page read while the first is in flight is capped, not paid", async () => {
    // The first claim books the worst case; the second one would take the day past the cap.
    const cents = Math.ceil((VISION_WORST_COST_MICRO * 1.5) / 10_000);
    const p = await plant(env, { limits: { dayModelCostCents: cents } });
    const f = await startedPdf(2, p);
    const client = new GateClient([answer("Page 1"), answer("Page 2")]);
    setShapeClientForTests(client);
    const first = read(f, 1);
    await until(() => client.calls === 1);
    expect(await read(f, 2)).toMatchObject({ page: 2, state: "not_read", reason: "cap_day_cost" });
    client.release();
    expect(await first).toMatchObject({ state: "read" });
    expect(client.calls).toBe(1);
    expect(await outcomes(f, 2)).toEqual(["capped"]);
  });

  test("a claim whose Worker stopped holds the page only for the stale window", async () => {
    const { setClockForTests } = await import("../src/lib/clock");
    setClockForTests(new Date("2026-11-20T06:00:00Z"));
    const f = await startedPdf(1);
    // A pending row from a call that never finished, five minutes ago.
    await env.d1
      .prepare(
        "insert into ingest_bot_run (id, company_id, block_id, candidate_id, purpose, model, attempt, outcome, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_micro_usd, duration_ms, error_codes, created_by, created_at) values (?, ?, ?, null, 'vision', ?, 1, 'pending', 0, 0, 0, 0, 0, 0, null, null, ?)",
      )
      .bind(randomUUID(), f.p.companyId, visionPageKey(f.artifactId, 1), S, Date.parse("2026-11-20T05:55:00Z"))
      .run();
    const client = new FakeShapeClient([answer("Late")]);
    setShapeClientForTests(client);
    expect(await read(f, 1)).toMatchObject({ state: "ready", next: null });
    expect(client.calls).toHaveLength(0);
    // Past the window the stopped call counts as one failed call, and the page is read.
    setClockForTests(new Date("2026-11-20T06:06:00Z"));
    expect(await read(f, 1)).toMatchObject({ state: "read" });
    expect(client.calls).toHaveLength(1);
    expect(await outcomes(f, 1)).toEqual(["pending", "recipe"]);
  });
});

describe("tables object and plan written once (S1, N10)", () => {
  test("a tables object already in the vault is kept: the blocks come from it, not from the later answer", async () => {
    const f = await startedPdf(1);
    // An earlier answer reached the vault, but its run never finished (its Worker stopped).
    const earlier = { v: 1, runId: "old", model: S, tables: [{ title: "Earlier", headers: ["Party name", "City"], rows: [["Nova Metals", "Rajkot"]], rowConfidence: [0.9], lowConfidenceRows: [] }] };
    await bucket.put(pageTablesKey(f.p.companyId, f.sha, 1), JSON.stringify(earlier));
    setShapeClientForTests(new FakeShapeClient([answer("Later", 2)]));
    expect(await read(f, 1)).toMatchObject({ state: "read", tables: 1 });
    const stored = JSON.parse(await (await bucket.get(pageTablesKey(f.p.companyId, f.sha, 1)))!.text());
    expect(stored.runId).toBe("old");
    const got = await f.p.owner.ingest.artifact.get({ artifactId: f.artifactId });
    expect(got.blocks.map((b) => b.title)).toEqual(["Earlier"]);
  });

  test("two first starts at once write one plan, and both answer it", async () => {
    workersEnv.INGEST_VAULT = bucket;
    const p = await plant(env);
    const sha = createHash("sha256").update(randomUUID()).digest("hex");
    const bytes = new TextEncoder().encode(`synthetic ${sha}`);
    const begin = await p.owner.ingest.artifact.begin({ sha256: sha, fileName: "stock.pdf", sizeBytes: bytes.byteLength, contentType: "application/pdf", kind: "pdf_scan" });
    await bucket.put(rawKey(p.companyId, sha), bytes);
    await p.owner.ingest.artifact.commitRaw({ artifactId: begin.artifactId });
    setShapeClientForTests(new FakeShapeClient([]));
    const [a, b] = await Promise.all([
      p.owner.ingest.vision.start({ artifactId: begin.artifactId, pageCount: 3 }),
      p.owner.ingest.vision.start({ artifactId: begin.artifactId, pageCount: 5 }),
    ]);
    const index = JSON.parse(await (await bucket.get(pagesIndexKey(p.companyId, sha)))!.text());
    expect(a.pageCount).toBe(index.pageCount);
    expect(b.pageCount).toBe(index.pageCount);
    expect(a.planned).toBe(index.planned);
    expect(b.planned).toBe(index.planned);
  });
});
