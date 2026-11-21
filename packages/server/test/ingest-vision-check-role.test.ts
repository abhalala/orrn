/**
 * Vision read, item 16 (owner decision "Price-viewers tick, admin approves"): the action `ingest.check`.
 * - admin, office, manager and accountant hold it (the owner holds every action).
 * - It opens, read only, the review of a model-read table: `candidate.get`, `rows.list`, the signed page image
 *   (`vision.readUrl`, page only), the tick (`vision.check`) and the list of tables waiting for a check
 *   (`vision.waiting`). Nothing else: no upload, answers, mapping, Approve or discard.
 * - The tick on a table with a price column takes `ingest.check` and `order.price`; without one, `ingest.check`.
 * - Approve still takes `ingest.merge`, and the admin who approves sees who ticked.
 * Real D1, a Miniflare R2 bucket and the scripted model client. Synthetic tables only.
 */
import { createHash, randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { TRPCError } from "@trpc/server";
import { Miniflare } from "miniflare";

import { workersEnv } from "./env-mock";
import { createTestEnv, type CompanyRole, type TestEnv } from "./harness";
import { layout, learnLayout, plant, pump, trim, upload, type Caller, type Plant } from "./ingest-portal-helpers";
import { fakeResponse, FakeShapeClient, setShapeClientForTests } from "../src/lib/ingest/bot";
import { pageKey, rawKey } from "../src/lib/ingest/vault";
import { ingestRouter } from "../src/routers/ingest";

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
const NO_RIGHT = "You don't have permission to do that";
const NEEDS_PRICES = "Someone who can see prices must check this table.";
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

const seqOf = async (candidateId: string) =>
  (await env.d1.prepare("select server_seq as seq from ingest_candidate where id = ?").bind(candidateId).first<{ seq: number }>())!.seq;
const tick = async (as: Caller, candidateId: string, checked = true) => as.ingest.vision.check({ candidateId, expectSeq: await seqOf(candidateId), checked });
const tickedBy = async (candidateId: string) =>
  (await env.d1.prepare("select b.model_checked_by as by from ingest_block b join ingest_candidate c on c.block_id = b.id where c.id = ?").bind(candidateId).first<{ by: string | null }>())!.by;

/** The outcome of one call: "ok", or the error words. */
async function outcome(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
    return "ok";
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

describe("who may tick (item 16)", () => {
  const ROLES: CompanyRole[] = ["owner", "admin", "office", "manager", "accountant", "supervisor", "packer", "viewer"];
  const NO_PRICE: Record<string, string> = { owner: "ok", admin: "ok", office: "ok", manager: "ok", accountant: "ok", supervisor: NO_RIGHT, packer: NO_RIGHT, viewer: NO_RIGHT };
  // A price column also takes order.price: the admin holds ingest.check but not order.price.
  const PRICED: Record<string, string> = { ...NO_PRICE, admin: NEEDS_PRICES };

  for (const [name, table, expected] of [["no price column", PARTIES, NO_PRICE], ["a price column", RATES, PRICED]] as const) {
    test(`a table with ${name}: each role's tick is allowed or refused`, async () => {
      const p = await plant(env);
      const got: Record<string, string> = {};
      for (const role of ROLES) {
        const { candidates } = await modelSheets([table], p);
        got[role] = await outcome(() => tick(p.as(role), candidates[0]!));
        if (got[role] === "ok") expect(await tickedBy(candidates[0]!)).toBe(p.users[role].id);
      }
      expect(got).toEqual(expected);
    });
  }

  test("a price viewer can take the tick off again", async () => {
    const { p, candidates } = await modelSheets([RATES]);
    await tick(p.as("office"), candidates[0]!);
    await tick(p.as("accountant"), candidates[0]!, false);
    expect(await tickedBy(candidates[0]!)).toBeNull();
  });
});

describe("a price viewer does nothing else (item 16)", () => {
  test("office, manager and accountant cannot Approve, upload, discard, answer, map or fix a cell", async () => {
    const { p, artifactId, candidates } = await modelSheets([PARTIES]);
    const id = candidates[0]!;
    await tick(p.as("office"), id);
    for (const role of ["office", "manager", "accountant"] as const) {
      const as = p.as(role);
      const seq = await seqOf(id);
      const calls: Record<string, () => Promise<unknown>> = {
        approve: () => as.ingest.candidate.approve({ candidateId: id, expectSeq: seq }),
        discard: () => as.ingest.candidate.discard({ candidateId: id, expectSeq: seq }),
        hold: () => as.ingest.candidate.hold({ candidateId: id, expectSeq: seq, reason: "x" } as never),
        release: () => as.ingest.candidate.release({ candidateId: id, expectSeq: seq }),
        setTarget: () => as.ingest.candidate.setTarget({ candidateId: id, target: "customers", expectSeq: seq }),
        upload: () => as.ingest.artifact.begin({ sha256: "a".repeat(64), fileName: "x.csv", sizeBytes: 10, contentType: null, kind: "sheet" }),
        fixCell: () => as.ingest.vision.fixCell({ candidateId: id, expectSeq: seq, rowIndex: 0, col: 1, text: "x" }),
        readPage: () => as.ingest.vision.readPage({ artifactId, page: 1 }),
        mergeStart: () => as.ingest.merge.start(),
      };
      for (const [name, run] of Object.entries(calls)) {
        expect({ role, name, got: await outcome(run) }).toEqual({ role, name, got: NO_RIGHT });
      }
    }
  });

  test("a check-only caller is refused every ingest procedure but the review reads, the tick and the waiting list", async () => {
    const p = await plant(env);
    const allowed = ["candidate.get", "rows.list", "vision.readUrl", "vision.check", "vision.waiting"];
    const paths = Object.keys((ingestRouter as unknown as { _def: { procedures: Record<string, unknown> } })._def.procedures).sort();
    expect(paths).toEqual(expect.arrayContaining(allowed));
    const refusedOf = async (as: Caller, path: string) => {
      let node: unknown = as.ingest;
      for (const part of path.split(".")) node = (node as Record<string, unknown>)[part];
      try {
        await (node as (input: unknown) => Promise<unknown>)({});
        return false;
      } catch (error) {
        return error instanceof TRPCError && error.code === "FORBIDDEN" && error.message === NO_RIGHT;
      }
    };
    for (const role of ["office", "manager", "accountant"] as const) {
      for (const path of paths) {
        expect({ role, path, refused: await refusedOf(p.as(role), path) }).toEqual({ role, path, refused: !allowed.includes(path) });
      }
    }
  });
});

describe("what a check-only caller may open (item 16)", () => {
  test("the review and rows of a model-read table, and its page image; never a table read from a sheet or the raw file", async () => {
    const { p, artifactId, candidates } = await modelSheets([RATES]);
    const office = p.as("office");
    const detail = await office.ingest.candidate.get({ candidateId: candidates[0]! });
    expect(detail.block.readBy).toBe("model");
    const rows = await office.ingest.rows.list({ candidateId: candidates[0]! });
    expect(rows.items.length).toBe(2);
    const page = await office.ingest.vision.readUrl({ artifactId, what: "page", page: 1 });
    expect(page.url).toContain("ticket=");
    // The raw file holds every page, so every table of it.
    expect(await outcome(() => office.ingest.vision.readUrl({ artifactId, what: "raw" }))).toBe("Import file not found");
    // A page no model-read table came from.
    expect(await outcome(() => office.ingest.vision.readUrl({ artifactId, what: "page", page: 2 }))).toBe("Import file not found");

    const sheet = await upload(p.owner, [{ headers: ["Party name", "City"], rows: [["Nova Metals", "Rajkot"]] }]);
    const sheetId = sheet.candidates[0]!.id;
    expect(await outcome(() => office.ingest.candidate.get({ candidateId: sheetId }))).toBe("Import not found");
    expect(await outcome(() => office.ingest.rows.list({ candidateId: sheetId }))).toBe("Import not found");
    expect(await outcome(() => office.ingest.vision.readUrl({ artifactId: sheet.artifactId, what: "page", page: 1 }))).toBe("Import file not found");
    // The admin, who uploads, still opens both.
    expect((await p.admin.ingest.candidate.get({ candidateId: sheetId })).id).toBe(sheetId);
  });

  test("the rate cells stay hidden from the admin; the tick of the office shows to the admin who approves", async () => {
    const { p, candidates } = await modelSheets([RATES]);
    const rows = await p.admin.ingest.rows.list({ candidateId: candidates[0]! });
    expect(rows.items.map((r) => r.raw[1])).toEqual(["", ""]);
    await tick(p.as("office"), candidates[0]!);
    const seen = await p.admin.ingest.candidate.get({ candidateId: candidates[0]! });
    expect(seen.block).toMatchObject({ modelChecked: true, modelCheckedBy: p.users.office.id });
  });
});

describe("the owner's path: a price viewer ticks, the admin approves (item 16)", () => {
  test("a table with a price column: the admin cannot tick it, the office ticks it, the admin sees who and approves it", async () => {
    const p = await plant(env);
    const PRICED: T = { title: "Parties", headers: ["Party name", "City", "Rate"], rows: [["Nova Metals", "Rajkot", "210"], ["Om Alloys", "Surat", "205"]] };
    await learnLayout(env, p.companyId, p.users.owner.id, layout("customers", PRICED.headers, [{ field: "name", steps: trim }, { field: "city", steps: trim }], ["name"]), "Parties");
    const { artifactId, candidates } = await modelSheets([PRICED], p);
    const id = candidates[0]!;
    await p.owner.ingest.artifact.complete({ artifactId });
    await pump(p.admin, id);
    expect((await p.admin.ingest.candidate.get({ candidateId: id })).state).toBe("ready");
    // Approve still waits for the tick, and the admin cannot give it on a table with a price column.
    await expect(p.admin.ingest.candidate.approve({ candidateId: id, expectSeq: await seqOf(id) })).rejects.toThrow("Check these rows against the page first");
    expect(await outcome(() => tick(p.admin, id))).toBe(NEEDS_PRICES);
    await tick(p.as("office"), id);
    const seen = await p.admin.ingest.candidate.get({ candidateId: id });
    expect(seen.block).toMatchObject({ modelChecked: true, modelCheckedBy: p.users.office.id });
    expect((await p.admin.ingest.candidate.approve({ candidateId: id, expectSeq: seen.serverSeq })).state).toBe("approved");
  });
});

describe("tables waiting for a check (item 16)", () => {
  test("lists model-read tables not ticked, with whether the viewer needs someone who sees prices", async () => {
    const { p, artifactId, candidates } = await modelSheets([PARTIES, RATES]);
    await upload(p.owner, [{ headers: ["Party name", "City"], rows: [["Nova Metals", "Rajkot"]] }]);
    // The dry run (driven by an uploader's screen) has finished: the review offers the tick from here.
    await env.d1.prepare("update ingest_candidate set state = 'ready' where id in (?, ?)").bind(candidates[0]!, candidates[1]!).run();
    const forOffice = await p.as("office").ingest.vision.waiting();
    expect(forOffice.map((w) => ({ id: w.candidateId, needsPrices: w.needsPrices }))).toEqual([
      { id: candidates[0]!, needsPrices: false },
      { id: candidates[1]!, needsPrices: false },
    ]);
    expect(forOffice[0]).toMatchObject({ artifactId, fileName: "slip.jpg", page: 1, pageCount: 1, rows: 2 });
    const forAdmin = await p.admin.ingest.vision.waiting();
    expect(forAdmin.map((w) => w.needsPrices)).toEqual([false, true]);

    await tick(p.as("manager"), candidates[0]!);
    expect((await p.as("accountant").ingest.vision.waiting()).map((w) => w.candidateId)).toEqual([candidates[1]!]);
    expect(await outcome(() => p.as("supervisor").ingest.vision.waiting())).toBe(NO_RIGHT);
  });
});
