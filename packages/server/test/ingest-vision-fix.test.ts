/**
 * Vision read, contract section 7: "Fix this cell" (`vision.fixCell`). A person corrects one cell of a
 * model-read table against its page: the row goes back to pending, the tick is cleared in the same
 * batch, a checked sheet goes back to processing from row 0, and nothing changes once a row is written.
 * Real D1, a Miniflare R2 bucket and the scripted model client. Synthetic tables only.
 */
import { createHash, randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { Miniflare } from "miniflare";

import { workersEnv } from "./env-mock";
import { createTestEnv, type TestEnv } from "./harness";
import { layout, learnLayout, plant, pump, trim, upload, type Caller } from "./ingest-portal-helpers";
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

const S = "claude-sonnet-5-5";
const HEADERS = ["Party name", "City", "Rate"];
const page = { title: "Parties", headers: HEADERS, rows: [{ cells: ["Nova Metals", "Rajkt", "210"], confidence: 0.5 }, { cells: ["Om Alloys", "Surat", "205"], confidence: 0.95 }] };

/** A started photo whose one page was read into a model block; with `layout`, its sheet is dry run to ready. */
async function modelSheet(opts: { layout?: boolean } = {}) {
  workersEnv.INGEST_VAULT = bucket;
  const p = await plant(env);
  if (opts.layout) {
    await learnLayout(env, p.companyId, p.users.owner.id, layout("customers", HEADERS, [{ field: "name", steps: trim }, { field: "city", steps: trim }, { field: "rate", steps: trim }], ["name"]), "Parties");
  }
  const sha = createHash("sha256").update(randomUUID()).digest("hex");
  const bytes = new TextEncoder().encode(`synthetic ${sha}`);
  const begin = await p.owner.ingest.artifact.begin({ sha256: sha, fileName: "slip.jpg", sizeBytes: bytes.byteLength, contentType: "image/jpeg", kind: "image" });
  await bucket.put(rawKey(p.companyId, sha), bytes);
  await p.owner.ingest.artifact.commitRaw({ artifactId: begin.artifactId });
  setShapeClientForTests(new FakeShapeClient([fakeResponse({ tables: [page] }, { modelUsed: S })]));
  await p.owner.ingest.vision.start({ artifactId: begin.artifactId, pageCount: 1 });
  await bucket.put(pageKey(p.companyId, sha, 1), new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), { httpMetadata: { contentType: "image/jpeg" } });
  await p.owner.ingest.vision.readPage({ artifactId: begin.artifactId, page: 1 });
  const got = await p.owner.ingest.artifact.get({ artifactId: begin.artifactId });
  const candidateId = got.blocks[0]!.candidates[0]!.id;
  if (opts.layout) {
    await p.owner.ingest.artifact.complete({ artifactId: begin.artifactId });
    await pump(p.owner, candidateId);
  }
  return { p, artifactId: begin.artifactId, candidateId };
}

const detail = (as: Caller, candidateId: string) => as.ingest.candidate.get({ candidateId });
const rows = async (as: Caller, candidateId: string) => (await as.ingest.rows.list({ candidateId, limit: 10 })).items.sort((a, b) => a.rowIndex - b.rowIndex);

describe("vision.fixCell", () => {
  test("a fix sets the cell, sends the row back to pending and the sheet back to processing, clears the tick, and is audited", async () => {
    const { p, candidateId } = await modelSheet({ layout: true });
    let c = await detail(p.owner, candidateId);
    expect(c.state).toBe("ready");
    c = await p.owner.ingest.vision.check({ candidateId, expectSeq: c.serverSeq, checked: true });
    expect(c.block.modelChecked).toBe(true);

    const fixed = await p.owner.ingest.vision.fixCell({ candidateId, expectSeq: c.serverSeq, rowIndex: 0, col: 1, text: "Rajkot" });
    expect(fixed).toMatchObject({ state: "processing", dryCursor: 0, serverSeq: c.serverSeq + 1 });
    expect(fixed.block.modelChecked).toBe(false);
    expect(fixed.block.sample[0]).toEqual(["Nova Metals", "Rajkot", "210"]);
    const [r0, r1] = await rows(p.owner, candidateId);
    expect(r0!.raw).toEqual(["Nova Metals", "Rajkot", "210"]);
    expect(r0!.state).toBe("pending");
    expect(r1!.state).not.toBe("pending");
    const audit = await env.d1.prepare("select meta from audit_log where company_id = ? and action = 'ingest.vision.fix'").bind(p.companyId).first<{ meta: string }>();
    expect(JSON.parse(audit!.meta)).toMatchObject({ rowIndex: 0, col: 1, from: "Rajkt", to: "Rajkot" });

    // The dry run reads the fixed row again; the sheet is ready, and approval waits for a new tick.
    await pump(p.owner, candidateId);
    c = await detail(p.owner, candidateId);
    expect(c.state).toBe("ready");
    expect((await rows(p.owner, candidateId))[0]!.state).not.toBe("pending");
    await expect(p.owner.ingest.candidate.approve({ candidateId, expectSeq: c.serverSeq })).rejects.toThrow("Check these rows against the page first");
  });

  test("a sheet still waiting for its layout keeps its state; the row and the tick still change", async () => {
    const { p, candidateId } = await modelSheet();
    let c = await detail(p.owner, candidateId);
    const before = c.state;
    expect(["needs_shape", "needs_confirm"]).toContain(before);
    c = await p.owner.ingest.vision.check({ candidateId, expectSeq: c.serverSeq, checked: true });
    const fixed = await p.owner.ingest.vision.fixCell({ candidateId, expectSeq: c.serverSeq, rowIndex: 1, col: 2, text: "206" });
    expect(fixed).toMatchObject({ state: before, serverSeq: c.serverSeq + 1 });
    expect(fixed.block.modelChecked).toBe(false);
    expect((await rows(p.owner, candidateId))[1]!.raw).toEqual(["Om Alloys", "Surat", "206"]);
  });

  test("refusals: a stale seq, a sheet read by code, a cell outside the table, a rate cell for a viewer without rates, a written row", async () => {
    const { p, candidateId } = await modelSheet();
    const c = await detail(p.owner, candidateId);
    await expect(p.owner.ingest.vision.fixCell({ candidateId, expectSeq: c.serverSeq + 5, rowIndex: 0, col: 0, text: "x" })).rejects.toThrow("This import changed in another tab");
    await expect(p.owner.ingest.vision.fixCell({ candidateId, expectSeq: c.serverSeq, rowIndex: 9, col: 0, text: "x" })).rejects.toThrow("Row not found");
    await expect(p.owner.ingest.vision.fixCell({ candidateId, expectSeq: c.serverSeq, rowIndex: 0, col: 3, text: "x" })).rejects.toThrow("Row not found");

    // The admin may upload but does not see rates (no order.price): the Rate column is refused, other cells are not.
    await expect(p.admin.ingest.vision.fixCell({ candidateId, expectSeq: c.serverSeq, rowIndex: 0, col: 2, text: "1" })).rejects.toThrow("Rates are hidden from you");

    const sheet = await upload(p.owner, [{ headers: ["Kachha maal", "Vazan"], rows: [["Om Metals", "120"]] }]);
    const sc = await detail(p.owner, sheet.candidates[0]!.id);
    await expect(p.owner.ingest.vision.fixCell({ candidateId: sc.id, expectSeq: sc.serverSeq, rowIndex: 0, col: 0, text: "x" })).rejects.toThrow("Only a table read from a page is checked against it");

    await env.d1.prepare("update ingest_staged_row set merge_state = 'written' where candidate_id = ? and row_index = 1").bind(candidateId).run();
    await expect(p.owner.ingest.vision.fixCell({ candidateId, expectSeq: c.serverSeq, rowIndex: 0, col: 0, text: "x" })).rejects.toThrow("Rows of this sheet are already written. Its rows cannot change now.");
  });
});
