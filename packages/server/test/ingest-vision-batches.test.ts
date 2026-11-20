/**
 * Vision read in batches, contract docs/superpowers/plans/2026-11-20-vision-read.md section 12: a file
 * with more pages than the plant's pages per batch is read batch by batch ("Read next pages"); a day cap
 * stops the read mid-file and the next plant day carries on; no page is read twice; listings stay at
 * 1,000 keys a call; a file holding `blocksPerFile` tables says so and can still finish.
 * Real D1, a Miniflare R2 bucket, the scripted `FakeShapeClient`. Synthetic pages and tables only.
 */
import { createHash, randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { Miniflare } from "miniflare";

import { workersEnv } from "./env-mock";
import { createTestEnv, type TestEnv } from "./harness";
import { plant, type Plant } from "./ingest-portal-helpers";
import { DAY_COST_CAP_MICRO, fakeResponse, FakeShapeClient, MemoryBotRunStore, runVisionAttempt, setShapeClientForTests, VISION_WORST_COST_MICRO } from "../src/lib/ingest/bot";
import { INGEST_LIMITS, VISION_FILE_FULL } from "../src/lib/ingest/types";
import { pageKey, pagesIndexKey, rawKey } from "../src/lib/ingest/vault";
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
/** One band-sized answer: 5,000 input and 6,000 output tokens at Sonnet 5.5 prices is 70,000 micro-USD (0.07 USD). */
const BAND_USAGE = { input: 5_000, output: 6_000, cacheRead: 0, cacheWrite: 0 };
const answer = (n: number) =>
  fakeResponse({ tables: [{ title: `Page ${n}`, headers: ["Party name", "City"], rows: [{ cells: [`Party ${n}`, "Rajkot"], confidence: 0.9 }] }] }, { modelUsed: S, usage: BAND_USAGE });
const answers = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => answer(from + i));

type File = { p: Plant; artifactId: string; sha: string };

async function keptPdf(p: Plant): Promise<File> {
  workersEnv.INGEST_VAULT = bucket;
  const sha = createHash("sha256").update(randomUUID()).digest("hex");
  const bytes = new TextEncoder().encode(`synthetic ${sha}`);
  const begin = await p.owner.ingest.artifact.begin({ sha256: sha, fileName: "stock.pdf", sizeBytes: bytes.byteLength, contentType: "application/pdf", kind: "pdf_scan" });
  await bucket.put(rawKey(p.companyId, sha), bytes);
  await p.owner.ingest.artifact.commitRaw({ artifactId: begin.artifactId });
  return { p, artifactId: begin.artifactId, sha };
}

const putPages = async (f: File, from: number, to: number) => {
  for (let n = from; n <= to; n++) await bucket.put(pageKey(f.p.companyId, f.sha, n), JPEG, { httpMetadata: { contentType: "image/jpeg" } });
};
const read = (f: File, page: number) => f.p.owner.ingest.vision.readPage({ artifactId: f.artifactId, page });
const pagesOf = (f: File) => f.p.owner.ingest.vision.pages({ artifactId: f.artifactId });
const nextBatch = (f: File) => f.p.owner.ingest.vision.nextBatch({ artifactId: f.artifactId });
const indexOf = async (f: File) => JSON.parse(await (await bucket.get(pagesIndexKey(f.p.companyId, f.sha)))!.text());

/** The outcomes of every run row of one page key, oldest first. */
async function outcomes(f: File, page: number): Promise<string[]> {
  const r = await env.d1
    .prepare("select outcome from ingest_bot_run where company_id = ? and block_id = ? order by created_at, attempt")
    .bind(f.p.companyId, visionPageKey(f.artifactId, page))
    .all<{ outcome: string }>();
  return r.results.map((x) => x.outcome);
}

/** Reads pages `from` to `to` in order and stops at the first day cap, as the web pump does. */
async function readUntilCap(f: File, from: number, to: number): Promise<number | null> {
  for (let page = from; page <= to; page++) {
    const v = await read(f, page);
    if (v.reason === "cap_day_calls" || v.reason === "cap_day_cost") return page;
    expect(v).toMatchObject({ page, state: "read" });
  }
  return null;
}

describe("batches: plan, tickets and finish", () => {
  test("the plant's pages per batch plans each batch; tickets cover only the new range; complete waits for the rest", async () => {
    const p = await plant(env, { limits: { visionPagesPerBatch: 4 } });
    const f = await keptPdf(p);
    const client = new FakeShapeClient(answers(1, 10));
    setShapeClientForTests(client);
    const start = await p.owner.ingest.vision.start({ artifactId: f.artifactId, pageCount: 10 });
    expect(start).toMatchObject({ pageCount: 10, planned: 4 });
    expect(start.uploads.map((u) => u.page)).toEqual([1, 2, 3, 4]);
    expect(await indexOf(f)).toMatchObject({ pageCount: 10, planned: 4, batches: [[1, 4]] });

    // While the batch has pages the model can take, Read next pages plans nothing and hands the missing tickets.
    const early = await nextBatch(f);
    expect(early).toMatchObject({ planned: 4 });
    expect(early.uploads.map((u) => u.page)).toEqual([1, 2, 3, 4]);
    await putPages(f, 1, 4);
    expect((await nextBatch(f)).planned).toBe(4);

    expect(await readUntilCap(f, 1, 4)).toBeNull();
    const after1 = await pagesOf(f);
    expect(after1).toMatchObject({ pageCount: 10, planned: 4, settled: true, full: false, restNotRead: false, canFinish: false });
    // Every planned page is settled, but pages 5 to 10 are not: complete refuses.
    await expect(p.owner.ingest.artifact.complete({ artifactId: f.artifactId })).rejects.toThrow("Some pages are not read yet. Read, type or skip each page first.");

    // Staff raise the batch size: the next batch takes the plant's value now.
    await env.d1.prepare("update company set settings = json_set(settings, '$.limits.visionPagesPerBatch', 5) where id = ?").bind(p.companyId).run();
    const second = await nextBatch(f);
    expect(second).toMatchObject({ pageCount: 10, planned: 9 });
    expect(second.uploads.map((u) => u.page)).toEqual([5, 6, 7, 8, 9]);
    expect(await indexOf(f)).toMatchObject({ planned: 9, batches: [[1, 4], [5, 9]] });
    // A second click while the batch is open plans nothing more.
    expect((await nextBatch(f)).planned).toBe(9);
    const audit = await env.d1.prepare("select meta from audit_log where company_id = ? and action = 'ingest.vision.batch'").bind(p.companyId).all<{ meta: string }>();
    expect(audit.results.map((r) => JSON.parse(r.meta))).toEqual([{ from: 5, to: 9, pageCount: 10 }]);

    await putPages(f, 5, 9);
    expect(await readUntilCap(f, 5, 9)).toBeNull();
    // The person stops here: pages 10 is left not read, and the file finishes.
    const left = await p.owner.ingest.vision.finishRest({ artifactId: f.artifactId });
    expect(left).toMatchObject({ planned: 9, settled: true, restNotRead: true, canFinish: true });
    expect(left.pages.every((v) => v.state === "read")).toBe(true);
    await p.owner.ingest.artifact.complete({ artifactId: f.artifactId });
    expect((await p.owner.ingest.artifact.get({ artifactId: f.artifactId })).readState).toBe("read");
    expect(client.calls).toHaveLength(9);
  });

  test("the last batch stops at the file's last page; a file with every page planned finishes with no mark", async () => {
    const p = await plant(env, { limits: { visionPagesPerBatch: 3 } });
    const f = await keptPdf(p);
    setShapeClientForTests(new FakeShapeClient(answers(1, 5)));
    await p.owner.ingest.vision.start({ artifactId: f.artifactId, pageCount: 5 });
    await putPages(f, 1, 3);
    await readUntilCap(f, 1, 3);
    expect((await nextBatch(f)).uploads.map((u) => u.page)).toEqual([4, 5]);
    await putPages(f, 4, 5);
    await readUntilCap(f, 4, 5);
    // Every page planned: nothing more to plan.
    expect(await nextBatch(f)).toMatchObject({ planned: 5, uploads: [] });
    expect(await pagesOf(f)).toMatchObject({ planned: 5, settled: true, canFinish: true, restNotRead: false });
    await p.owner.ingest.artifact.complete({ artifactId: f.artifactId });
  });

  test("Read next pages after Finish with the rest clears the mark; pages past the plan are refused by number, not by zod", async () => {
    const p = await plant(env, { limits: { visionPagesPerBatch: 2 } });
    const f = await keptPdf(p);
    setShapeClientForTests(new FakeShapeClient(answers(1, 2)));
    await p.owner.ingest.vision.start({ artifactId: f.artifactId, pageCount: 500 });
    await putPages(f, 1, 2);
    await readUntilCap(f, 1, 2);
    expect((await p.owner.ingest.vision.finishRest({ artifactId: f.artifactId })).restNotRead).toBe(true);
    expect((await nextBatch(f)).planned).toBe(4);
    expect(await pagesOf(f)).toMatchObject({ restNotRead: false, canFinish: false });
    // Page numbers go past the batch ceiling (80) up to the file maximum; the plan decides.
    await expect(read(f, 400)).rejects.toThrow("This page is past the pages read for this file");
    await expect(read(f, 10_001)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(p.owner.ingest.vision.start({ artifactId: f.artifactId, pageCount: 10_001 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  test("a viewer cannot plan the next batch or finish with the rest", async () => {
    const p = await plant(env, { limits: { visionPagesPerBatch: 2 } });
    const f = await keptPdf(p);
    setShapeClientForTests(new FakeShapeClient([]));
    await p.owner.ingest.vision.start({ artifactId: f.artifactId, pageCount: 6 });
    await expect(p.as("viewer").ingest.vision.nextBatch({ artifactId: f.artifactId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(p.as("viewer").ingest.vision.finishRest({ artifactId: f.artifactId })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("batches: day caps and the next plant day", () => {
  test("the day cost cap stops the read mid-file; the next plant day carries on from that page; no page is read twice", async () => {
    // 35 cents a day at 7 cents a page, each call claimed at its worst case (17.5 cents) first: three pages
    // go (the third claim books 14 + 17.5 = 31.5 cents), the fourth would book 21 + 17.5 = 38.5 cents.
    const p = await plant(env, { limits: { visionPagesPerBatch: 4, dayModelCostCents: 35 } });
    const f = await keptPdf(p);
    const { setClockForTests } = await import("../src/lib/clock");
    // N15: one minute before midnight in Kolkata (18:29 UTC); the next plant day starts two minutes later on
    // the same UTC day, so a cap counted by UTC day would still be spent.
    setClockForTests(new Date("2026-11-20T18:29:00Z"));
    const client = new FakeShapeClient(answers(1, 8));
    setShapeClientForTests(client);
    await p.owner.ingest.vision.start({ artifactId: f.artifactId, pageCount: 8 });
    await putPages(f, 1, 4);

    expect(await readUntilCap(f, 1, 4)).toBe(4);
    expect(client.calls).toHaveLength(3);
    const day1 = await pagesOf(f);
    expect(day1.pages.map((v) => [v.page, v.state, v.reason])).toEqual([
      [1, "read", null],
      [2, "read", null],
      [3, "read", null],
      [4, "not_read", "cap_day_cost"],
    ]);
    expect(day1.pages[3]).toMatchObject({ canRetry: true });
    // Same day: Read next pages plans nothing (page 4 is still the model's) and the page stays capped.
    expect((await nextBatch(f)).planned).toBe(4);
    expect(await read(f, 4)).toMatchObject({ state: "not_read", reason: "cap_day_cost" });
    expect(client.calls).toHaveLength(3);

    // The next plant day (IST midnight passed at 18:30 UTC): page 4 reads, then the next batch.
    setClockForTests(new Date("2026-11-20T18:31:00Z"));
    expect(await readUntilCap(f, 4, 4)).toBeNull();
    const second = await nextBatch(f);
    expect(second.uploads.map((u) => u.page)).toEqual([5, 6, 7, 8]);
    await putPages(f, 5, 8);
    // Day 2 has paid for page 4 already: pages 5 and 6 read, page 7 is capped.
    expect(await readUntilCap(f, 5, 8)).toBe(7);

    setClockForTests(new Date("2026-11-21T18:31:00Z"));
    expect(await readUntilCap(f, 7, 8)).toBeNull();
    expect((await pagesOf(f)).pages.every((v) => v.state === "read")).toBe(true);

    // No page was read twice: one recipe run per page key; a capped page has its capped rows first.
    expect(await outcomes(f, 1)).toEqual(["recipe"]);
    expect(await outcomes(f, 4)).toEqual(["capped", "capped", "recipe"]);
    expect(await outcomes(f, 7)).toEqual(["capped", "recipe"]);
    for (const page of [2, 3, 5, 6, 8]) expect(await outcomes(f, page)).toEqual(["recipe"]);
    expect(client.calls).toHaveLength(8);
    expect((await p.owner.ingest.artifact.get({ artifactId: f.artifactId })).blockCount).toBe(8);
    await p.owner.ingest.artifact.complete({ artifactId: f.artifactId });
  });

  test("the day call cap stops the read the same way", async () => {
    const p = await plant(env, { limits: { visionPagesPerBatch: 5, dayModelCalls: 2 } });
    const f = await keptPdf(p);
    const { setClockForTests } = await import("../src/lib/clock");
    setClockForTests(new Date("2026-11-20T06:00:00Z"));
    const client = new FakeShapeClient(answers(1, 5));
    setShapeClientForTests(client);
    await p.owner.ingest.vision.start({ artifactId: f.artifactId, pageCount: 5 });
    await putPages(f, 1, 5);
    expect(await readUntilCap(f, 1, 5)).toBe(3);
    expect((await pagesOf(f)).pages.map((v) => v.reason)).toEqual([null, null, "cap_day_calls", null, null]);
    setClockForTests(new Date("2026-11-21T06:00:00Z"));
    expect(await readUntilCap(f, 3, 4)).toBeNull();
    expect(await outcomes(f, 3)).toEqual(["capped", "recipe"]);
    expect(client.calls).toHaveLength(4);
  });
});

describe("batches: listings stay within 1,000 keys a call", () => {
  test("a plan past 1,000 pages lists with the cursor; one page lists only its own keys", async () => {
    const p = await plant(env);
    const f = await keptPdf(p);
    setShapeClientForTests(new FakeShapeClient([]));
    await p.owner.ingest.vision.start({ artifactId: f.artifactId, pageCount: 1_200 });
    // A file read batch by batch up to page 1,100: the plan is written as the batches would leave it.
    const index = await indexOf(f);
    await bucket.put(pagesIndexKey(p.companyId, f.sha), JSON.stringify({ ...index, planned: 1_100, batches: [[1, 1_100]] }));
    for (let n = 1; n <= 1_100; n += 100) {
      await Promise.all(Array.from({ length: 100 }, (_, i) => bucket.put(pageKey(p.companyId, f.sha, n + i), JPEG, { httpMetadata: { contentType: "image/jpeg" } })));
    }

    const lists: { prefix?: string; limit?: number; returned: number }[] = [];
    const spy = new Proxy(bucket, {
      get(target, prop) {
        if (prop === "list") {
          return async (opts: R2ListOptions) => {
            const out = await target.list(opts);
            lists.push({ prefix: opts.prefix, limit: opts.limit, returned: out.objects.length });
            return out;
          };
        }
        const v = Reflect.get(target, prop);
        return typeof v === "function" ? v.bind(target) : v;
      },
    });
    workersEnv.INGEST_VAULT = spy as R2Bucket;

    const pages = await pagesOf(f);
    expect(pages.pages).toHaveLength(1_100);
    expect(pages.pages[0]).toMatchObject({ page: 1, state: "ready" });
    expect(pages.pages[1_099]).toMatchObject({ page: 1_100, state: "ready" });
    expect(pages.pages.every((v) => v.state === "ready")).toBe(true);
    expect(lists.length).toBeGreaterThanOrEqual(2);
    expect(lists.every((l) => l.limit === 1_000 && l.returned <= 1_000)).toBe(true);

    // One page: two small listings, `pages/1100.` and `pages/1100/`, never the whole folder.
    lists.length = 0;
    setShapeClientForTests(new FakeShapeClient([answer(1_100)]));
    expect(await read(f, 1_100)).toMatchObject({ page: 1_100, state: "read" });
    expect(lists.length).toBeGreaterThan(0);
    expect(lists.every((l) => l.prefix?.endsWith("/pages/1100.") || l.prefix?.endsWith("/pages/1100/"))).toBe(true);

    // The whole-file runs query finds that page's run by its key range.
    expect((await pagesOf(f)).pages[1_099]).toMatchObject({ state: "read", attempts: 1 });
    // start on a resumed long plan lists with the cursor too and asks for no page it holds.
    lists.length = 0;
    const again = await p.owner.ingest.vision.start({ artifactId: f.artifactId, pageCount: 1_200 });
    expect(again).toMatchObject({ planned: 1_100, uploads: [] });
    expect(lists.every((l) => l.limit === 1_000 && l.returned <= 1_000)).toBe(true);
  }, 60_000);
});

/**
 * Contract section 12, calls and cost, through the real `runVisionAttempt` and caps (N14: this test used to
 * add up numbers written into it). Each call is claimed at its worst case (`VISION_WORST_COST_MICRO`) before
 * it is made, so a call goes only while the day's spend plus that claim stays within the cap.
 */
describe("batches: day cost of contract section 12", () => {
  test("at 0.07 USD a band call, 69 calls go under the 5 USD day cap and call 70 is capped", async () => {
    const store = new MemoryBotRunStore();
    const at = Date.UTC(2026, 10, 20, 6, 0, 0);
    let calls = 0;
    let capReason: string | undefined;
    for (let page = 1; page <= 100 && !capReason; page++) {
      const r = await runVisionAttempt({
        env: { ANTHROPIC_API_KEY: "sk-test" },
        store,
        companyId: "co1",
        userId: "u1",
        blockId: `a:p${page}`,
        pageKind: "pdf_scan",
        page: { mediaType: "image/jpeg", bytes: JPEG },
        vaultReady: true,
        visualReads: true,
        client: new FakeShapeClient([answer(page)]),
        nowMs: () => at,
      });
      if (r.status === "ran" && r.outcome === "capped") capReason = r.capReason;
      else calls += 1;
    }
    expect(capReason).toBe("day_cost");
    expect(VISION_WORST_COST_MICRO).toBe(175_000);
    expect(calls).toBe(Math.floor((DAY_COST_CAP_MICRO - VISION_WORST_COST_MICRO) / 70_000) + 1);
    expect(calls).toBe(69);
    expect((await store.dayTotals({ companyId: "co1", sinceMs: 0 })).costMicroUsd).toBe(69 * 70_000);
  });
});

describe("batches: a file full of tables", () => {
  test("the sentence names the limit in code; decision 1: 200 tables a file for every plant", () => {
    expect(INGEST_LIMITS.blocksPerFile).toBe(200);
    expect(VISION_FILE_FULL).toBe("This file already holds 200 tables, the most one file can hold. Finish it to use the tables read so far.");
  });

  test("a full file says so, plans no more pages, keeps the tables read, and finishes with the rest skipped", async () => {
    // Pages of five tables each fill the file (decision 1: `blocksPerFile` is 200, so 40 pages).
    const fill = INGEST_LIMITS.blocksPerFile / 5;
    expect(fill).toBe(40);
    const p = await plant(env, { limits: { visionPagesPerBatch: fill + 2 } });
    const f = await keptPdf(p);
    const five = (n: number) =>
      fakeResponse(
        { tables: Array.from({ length: 5 }, (_, t) => ({ title: `Page ${n} table ${t + 1}`, headers: ["Party name", "City"], rows: [{ cells: [`Party ${n}.${t}`, "Rajkot"], confidence: 0.9 }] })) },
        { modelUsed: S, usage: BAND_USAGE },
      );
    const client = new FakeShapeClient(Array.from({ length: fill }, (_, i) => five(i + 1)));
    setShapeClientForTests(client);
    await p.owner.ingest.vision.start({ artifactId: f.artifactId, pageCount: fill + 10 });
    await putPages(f, 1, fill + 2);
    expect(await readUntilCap(f, 1, fill)).toBeNull();
    expect((await p.owner.ingest.artifact.get({ artifactId: f.artifactId })).blockCount).toBe(INGEST_LIMITS.blocksPerFile);
    expect(await read(f, fill + 1)).toMatchObject({ state: "not_read", reason: "too_many_tables", canRetry: false });
    const full = await pagesOf(f);
    expect(full).toMatchObject({ full: true, settled: false, canFinish: false });
    expect(full.pages.slice(fill).map((v) => [v.state, v.reason])).toEqual([
      ["not_read", "too_many_tables"],
      ["not_read", "too_many_tables"],
    ]);
    // The two pages past the full mark only a person can settle now, so they do not hold the next batch: the file being full does.
    await expect(nextBatch(f)).rejects.toThrow(VISION_FILE_FULL);
    expect(client.calls).toHaveLength(fill);

    const done = await p.owner.ingest.vision.finishRest({ artifactId: f.artifactId });
    expect(done).toMatchObject({ settled: true, restNotRead: true, canFinish: true });
    expect(done.pages.map((v): string => v.state)).toEqual([...Array<string>(fill).fill("read"), "skipped", "skipped"]);
    await p.owner.ingest.artifact.complete({ artifactId: f.artifactId });
    const got = await p.owner.ingest.artifact.get({ artifactId: f.artifactId });
    expect(got.readState).toBe("read");
    expect(got.blocks).toHaveLength(INGEST_LIMITS.blocksPerFile);
    expect(got.blocks.every((b) => b.readBy === "model")).toBe(true);
    const audit = await env.d1.prepare("select meta from audit_log where company_id = ? and action = 'ingest.vision.rest'").bind(p.companyId).first<{ meta: string }>();
    expect(JSON.parse(audit!.meta)).toEqual({ skipped: [fill + 1, fill + 2], notRead: [fill + 3, fill + 10] });
  }, 120_000);
});
