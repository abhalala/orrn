/**
 * Owner's decision for the first portal release: sheets, CSV and database dumps are read. PDFs and
 * photos are uploaded and kept in the vault, marked "kept, not read yet" (`kept_unread`), with no
 * blocks and no candidates. They need file storage. Nothing sends them to putBlocks, the bot or the
 * vision read in this release.
 */
import { createHash, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";

import { workersEnv } from "./env-mock";
import { createTestEnv, type TestEnv } from "./harness";
import { plant, pump, upload, type Caller, putBlocksPicked } from "./ingest-portal-helpers";
import { runVisionAttempt } from "../src/lib/ingest/bot";

let env: TestEnv;

beforeAll(async () => {
  env = await createTestEnv();
});

afterEach(() => {
  delete workersEnv.INGEST_VAULT;
});

afterAll(async () => {
  delete workersEnv.INGEST_VAULT;
  await env.dispose();
});

/** Stand-in for R2: enough for begin, the ticket and commitRaw. */
class FakeR2 {
  objects = new Map<string, Uint8Array>();
  async head(key: string) {
    const o = this.objects.get(key);
    return o ? { key, size: o.byteLength } : null;
  }
  async put(key: string, value: Uint8Array) {
    this.objects.set(key, value);
    return { key, size: value.byteLength };
  }
  async get(key: string) {
    const o = this.objects.get(key);
    return o ? { key, size: o.byteLength, body: o, arrayBuffer: async () => o.buffer } : null;
  }
  async delete(key: string) {
    this.objects.delete(key);
  }
}

const sha = () => createHash("sha256").update(randomUUID()).digest("hex");
const NO_STORAGE = "PDFs and photos need file storage, which is not set up for this plant. Ask orrn support to turn it on.";
const NOT_READ = "PDFs and photos are kept, not read, in this release. They will be read in a later release.";

const FILES = [
  { fileName: "order.pdf", contentType: "application/pdf", kind: "pdf_text" as const },
  { fileName: "scan.pdf", contentType: "application/pdf", kind: "pdf_scan" as const },
  { fileName: "slip.jpg", contentType: "image/jpeg", kind: "image" as const },
];

async function keep(as: Caller, f: (typeof FILES)[number], digest = sha()) {
  return as.ingest.artifact.begin({ sha256: digest, fileName: f.fileName, sizeBytes: 2048, contentType: f.contentType, kind: f.kind });
}

describe("PDFs and photos are kept, not read, in this release", () => {
  for (const f of FILES) {
    test(`${f.kind}: with storage it is kept with its bytes, listed as kept_unread, with no blocks and no candidates`, async () => {
      workersEnv.INGEST_VAULT = new FakeR2() as unknown as R2Bucket;
      const p = await plant(env);
      const out = await keep(p.owner, f);
      expect(out.existing).toBe(false);
      expect(out.upload?.url).toContain("/files/ingest/upload?ticket=");
      await p.owner.ingest.artifact.complete({ artifactId: out.artifactId });
      const got = await p.owner.ingest.artifact.get({ artifactId: out.artifactId });
      expect(got).toMatchObject({ kind: f.kind, readState: "kept_unread", vaultState: "pending", blockCount: 0, rowCount: 0, blocks: [] });
      const listed = await p.owner.ingest.artifact.list({ limit: 20 });
      expect(listed.items.map((a) => [a.fileName, a.readState])).toEqual([[f.fileName, "kept_unread"]]);
      expect((await p.owner.ingest.candidate.list({ limit: 20 })).items).toEqual([]);
      const audit = await env.d1
        .prepare("select count(*) as n from audit_log where company_id = ? and action = 'ingest.artifact.upload' and subject_id = ?")
        .bind(p.companyId, out.artifactId)
        .first<{ n: number }>();
      expect(Number(audit?.n)).toBe(1);
    });

    test(`${f.kind}: with no storage the upload is refused`, async () => {
      const p = await plant(env);
      await expect(keep(p.owner, f)).rejects.toThrow(NO_STORAGE);
      expect((await p.owner.ingest.artifact.list({ limit: 20 })).items).toEqual([]);
    });
  }

  test("the same file twice is one artifact", async () => {
    workersEnv.INGEST_VAULT = new FakeR2() as unknown as R2Bucket;
    const p = await plant(env);
    const digest = sha();
    const first = await keep(p.owner, FILES[0]!, digest);
    const again = await keep(p.owner, FILES[0]!, digest);
    expect(again).toMatchObject({ artifactId: first.artifactId, existing: true });
    expect((await p.owner.ingest.artifact.get({ artifactId: first.artifactId })).readState).toBe("kept_unread");
    expect((await p.owner.ingest.artifact.list({ limit: 20 })).items).toHaveLength(1);
  });

  test("a kept file takes no tables", async () => {
    workersEnv.INGEST_VAULT = new FakeR2() as unknown as R2Bucket;
    const p = await plant(env);
    const out = await keep(p.owner, FILES[0]!);
    await expect(
      putBlocksPicked(p.owner, {
        artifactId: out.artifactId,
        blocks: [{ ordinal: 0, sheetName: null, title: null, headerRow: 0, headerRows: 1, headers: ["Name", "City"], rowCount: 1, sample: [["Acme", "Surat"]] }],
      }),
    ).rejects.toThrow(NOT_READ);
  });

  test("the bot and the vision read refuse a PDF or photo", async () => {
    const p = await plant(env);
    // A sheet nothing fits goes to the bot; the same candidate on a PDF is refused before any model call.
    const { candidates } = await upload(p.owner, [{ headers: ["Kachha maal", "Vazan"], rows: [["Om Metals", "120"]] }]);
    const c = candidates[0]!;
    await pump(p.owner, c.id).catch(() => undefined);
    await env.d1.prepare("update ingest_artifact set kind = 'pdf_text' where company_id = ?").bind(p.companyId).run();
    const seq = (await p.owner.ingest.candidate.get({ candidateId: c.id })).serverSeq;
    await expect(p.owner.ingest.shape.make({ candidateId: c.id, expectSeq: seq })).rejects.toThrow(NOT_READ);
    const store = {} as Parameters<typeof runVisionAttempt>[0]["store"];
    expect(
      await runVisionAttempt({ env: { ANTHROPIC_API_KEY: "k" }, store, companyId: p.companyId, userId: null, blockId: "b", pageKind: "image", page: { mediaType: "image/jpeg", bytes: new Uint8Array(4) }, vaultReady: true }),
    ).toEqual({ status: "skipped", reason: "kept_unread", next: "manual" });
  });
});
