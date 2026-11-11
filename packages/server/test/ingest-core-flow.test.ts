/**
 * Infinity Portal lane A through the `ingest` router on a real D1: begin and dedupe, the vault being
 * optional, putRows compare-and-set and limits, the server fit (exact, near, none) with a learned
 * layout, the plan B7 transitions, near fits never reaching approval on their own, rate masking, and
 * the two actions. No model and no network: the bot is never called here.
 */
import { createHash, randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";

import { workersEnv } from "./env-mock";
import { createTestEnv, type CompanyRole, type TestEnv } from "./harness";

import { BAKI_SHEET_HEADERS, EXAMPLE_BAKI_RECIPE, fingerprint, type Recipe } from "@orrn/ingest";

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

type Caller = ReturnType<TestEnv["caller"]>;
type Sheet = { headers: string[]; rows: string[][]; name?: string };

const sha = () => createHash("sha256").update(randomUUID()).digest("hex");

class FakeR2 {
  objects = new Map<string, Uint8Array>();
  async head(key: string) {
    const o = this.objects.get(key);
    return o ? { key, size: o.byteLength } : null;
  }
  async put(key: string, value: Uint8Array | string | ReadableStream) {
    const body = typeof value === "string" ? new TextEncoder().encode(value) : value instanceof Uint8Array ? value : new Uint8Array(await new Response(value).arrayBuffer());
    this.objects.set(key, body);
    return { key, size: body.byteLength };
  }
  async get(key: string) {
    const o = this.objects.get(key);
    return o ? { body: o, text: async () => new TextDecoder().decode(o) } : null;
  }
  async delete(key: string) {
    this.objects.delete(key);
  }
}

async function plant() {
  // The Baki sheets carry rates. With rates on sales orders off, the dry run asks everyone to leave
  // rates out (X-new-3), so these plants use rates, as a plant that imports them does.
  const { companyId, users } = await env.seedCompany({ settings: { priceOnSalesOrder: true } });
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

/** begin, putBlocks, putRows and complete, as the browser does it. */
async function upload(as: Caller, sheets: Sheet[], fileName = "book.xlsx") {
  const begin = await as.ingest.artifact.begin({ sha256: sha(), fileName, sizeBytes: 1000, contentType: null, kind: "sheet" });
  const put = await as.ingest.artifact.putBlocks({ artifactId: begin.artifactId, blocks: sheets.map(blockOf) });
  for (const [i, s] of sheets.entries()) {
    const block = put.blocks.find((b) => b.ordinal === i)!;
    if (s.rows.length > 0) await as.ingest.artifact.putRows({ blockId: block.blockId, fromIndex: 0, expectRowsPut: 0, rows: s.rows });
  }
  await as.ingest.artifact.complete({ artifactId: begin.artifactId });
  const candidates = put.candidates.sort((a, b) => a.blockOrdinal - b.blockOrdinal);
  return { artifactId: begin.artifactId, candidates, blocks: put.blocks };
}

/** Pump the dry run until it is done, like the browser loop. */
async function pump(as: Caller, candidateId: string) {
  let cursor = (await as.ingest.candidate.get({ candidateId })).dryCursor;
  for (let i = 0; i < 50; i += 1) {
    const out = await as.ingest.dryRun.step({ candidateId, expectCursor: cursor });
    if (out.done) return out;
    cursor = out.cursor;
  }
  throw new Error("dry run did not finish");
}

/** An approved learned layout of this plant, straight into the tables (as an approval would leave it). */
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

/** A customers layout on headers no built-in knows, so only the learned layout can fit. */
function khataRecipe(): Recipe {
  const headers = ["Khata", "Gaam"];
  const fp = fingerprint({ headers, rows: [["Acme", "Surat"]] });
  return {
    schemaVersion: 1,
    target: "customers",
    headerRow: 0,
    headerRows: 1,
    match: { headerKey: fp.headerKey, headers: fp.normalized },
    fields: [
      { field: "name", source: { kind: "columns", cols: [{ col: 0, header: "Khata" }] }, steps: [{ op: "trim" }] },
      { field: "city", source: { kind: "columns", cols: [{ col: 1, header: "Gaam" }] }, steps: [{ op: "trim" }] },
    ],
    filters: [],
    keys: ["name"],
    onExisting: "ask",
    unclear: [],
  };
}

const CUSTOMERS: Sheet = {
  headers: ["Name", "GSTIN", "City"],
  rows: [
    ["Acme Traders", "", "Surat"],
    ["Bharat Metals", "", "Rajkot"],
  ],
};

describe("artifact.begin", () => {
  test("no vault: the file is taken without an upload ticket; status says so", async () => {
    const p = await plant();
    const status = await p.admin.ingest.status();
    expect(status.vaultReady).toBe(false);
    expect(status.botReady).toBe(false);
    const out = await p.admin.ingest.artifact.begin({ sha256: sha(), fileName: "a.csv", sizeBytes: 10, contentType: "text/csv", kind: "csv" });
    expect(out.existing).toBe(false);
    expect(out.upload).toBeNull();
  });

  test("the same file twice opens the first artifact", async () => {
    const p = await plant();
    const digest = sha();
    const a = await p.admin.ingest.artifact.begin({ sha256: digest, fileName: "a.csv", sizeBytes: 10, contentType: "text/csv", kind: "csv" });
    const b = await p.admin.ingest.artifact.begin({ sha256: digest, fileName: "copy of a.csv", sizeBytes: 10, contentType: "text/csv", kind: "csv" });
    expect(b.existing).toBe(true);
    expect(b.artifactId).toBe(a.artifactId);
    expect(b.uploadedAt).toBe(a.uploadedAt);
    // Another plant uploading the same bytes gets its own artifact.
    const q = await plant();
    const c = await q.admin.ingest.artifact.begin({ sha256: digest, fileName: "a.csv", sizeBytes: 10, contentType: "text/csv", kind: "csv" });
    expect(c.existing).toBe(false);
    expect(c.artifactId).not.toBe(a.artifactId);
  });

  test("with a vault: a ticket for the raw bytes, and commitRaw checks the stored size", async () => {
    const bucket = new FakeR2();
    workersEnv.INGEST_VAULT = bucket;
    const p = await plant();
    const digest = sha();
    const out = await p.admin.ingest.artifact.begin({ sha256: digest, fileName: "a.csv", sizeBytes: 4, contentType: "text/csv", kind: "csv" });
    expect(out.upload?.url).toContain("/files/ingest/upload?ticket=");
    await expect(p.admin.ingest.artifact.commitRaw({ artifactId: out.artifactId })).rejects.toThrow(/has not arrived/);
    await bucket.put(`tenants/${p.companyId}/artifacts/${digest}/raw`, new Uint8Array(4));
    expect((await p.admin.ingest.artifact.commitRaw({ artifactId: out.artifactId })).vaultState).toBe("stored");
    const again = await p.admin.ingest.artifact.begin({ sha256: digest, fileName: "a.csv", sizeBytes: 4, contentType: "text/csv", kind: "csv" });
    expect(again.upload).toBeNull();
  });

  test("a file over its kind's limit is refused", async () => {
    const p = await plant();
    await expect(
      p.admin.ingest.artifact.begin({ sha256: sha(), fileName: "big.png", sizeBytes: 11 * 1024 * 1024, contentType: "image/png", kind: "image" }),
    ).rejects.toThrow(/too big/);
  });
});

describe("artifact.putRows", () => {
  test("compare-and-set on rowsPut: a stale or skipped send is a conflict, the right one lands", async () => {
    const p = await plant();
    const begin = await p.admin.ingest.artifact.begin({ sha256: sha(), fileName: "c.csv", sizeBytes: 10, contentType: "text/csv", kind: "csv" });
    const sheet: Sheet = { headers: CUSTOMERS.headers, rows: [["A", "", "X"], ["B", "", "Y"], ["C", "", "Z"]] };
    const { blocks } = await p.admin.ingest.artifact.putBlocks({ artifactId: begin.artifactId, blocks: [blockOf(sheet, 0)] });
    const blockId = blocks[0]!.blockId;
    expect((await p.admin.ingest.artifact.putRows({ blockId, fromIndex: 0, expectRowsPut: 0, rows: sheet.rows.slice(0, 2) })).rowsPut).toBe(2);
    await expect(p.admin.ingest.artifact.putRows({ blockId, fromIndex: 0, expectRowsPut: 0, rows: sheet.rows.slice(0, 2) })).rejects.toThrow(/another tab/);
    await expect(p.admin.ingest.artifact.putRows({ blockId, fromIndex: 3, expectRowsPut: 3, rows: [["D", "", "W"]] })).rejects.toThrow(/another tab/);
    // More rows than the sheet declared.
    await expect(p.admin.ingest.artifact.putRows({ blockId, fromIndex: 2, expectRowsPut: 2, rows: [["C", "", "Z"], ["D", "", "W"]] })).rejects.toThrow(
      /More rows/,
    );
    expect((await p.admin.ingest.artifact.putRows({ blockId, fromIndex: 2, expectRowsPut: 2, rows: [sheet.rows[2]!] })).rowsPut).toBe(3);
    // complete waits for every row and then closes the file to more rows.
    await p.admin.ingest.artifact.complete({ artifactId: begin.artifactId });
    await expect(p.admin.ingest.artifact.putRows({ blockId, fromIndex: 3, expectRowsPut: 3, rows: [["D", "", "W"]] })).rejects.toThrow(/already read/);
  });

  test("long cells are cut to 200 characters with a reason; the wire refuses past 2,000", async () => {
    const p = await plant();
    const long = "x".repeat(500);
    const { candidates } = await upload(p.admin, [{ headers: CUSTOMERS.headers, rows: [[long, "", "Surat"]] }]);
    const rows = await p.admin.ingest.rows.list({ candidateId: candidates[0]!.id });
    expect(rows.items[0]!.raw[0]!.length).toBe(200);
    expect(rows.items[0]!.reasons).toContain("cell_cut");

    const begin = await p.admin.ingest.artifact.begin({ sha256: sha(), fileName: "d.csv", sizeBytes: 10, contentType: "text/csv", kind: "csv" });
    const { blocks } = await p.admin.ingest.artifact.putBlocks({ artifactId: begin.artifactId, blocks: [blockOf({ headers: ["Name"], rows: [["a"]] }, 0)] });
    await expect(p.admin.ingest.artifact.putRows({ blockId: blocks[0]!.blockId, fromIndex: 0, expectRowsPut: 0, rows: [["y".repeat(2001)]] })).rejects.toThrow(/Too big|too_big/i);
  });

  test("putBlocks twice with the same sheets replays; different sheets are a conflict", async () => {
    const p = await plant();
    const begin = await p.admin.ingest.artifact.begin({ sha256: sha(), fileName: "e.csv", sizeBytes: 10, contentType: "text/csv", kind: "csv" });
    const first = await p.admin.ingest.artifact.putBlocks({ artifactId: begin.artifactId, blocks: [blockOf(CUSTOMERS, 0)] });
    const again = await p.admin.ingest.artifact.putBlocks({ artifactId: begin.artifactId, blocks: [blockOf(CUSTOMERS, 0)] });
    expect(again.blocks).toEqual(first.blocks);
    expect(again.candidates.map((c) => c.id)).toEqual(first.candidates.map((c) => c.id));
    await expect(
      p.admin.ingest.artifact.putBlocks({ artifactId: begin.artifactId, blocks: [blockOf(CUSTOMERS, 0), blockOf(CUSTOMERS, 1)] }),
    ).rejects.toThrow(/already saved/);
  });
});

describe("the server fit", () => {
  test("built-in exact: a plain customer list goes straight to checking rows", async () => {
    const p = await plant();
    const { candidates } = await upload(p.admin, [CUSTOMERS]);
    expect(candidates[0]).toMatchObject({ fit: "exact", target: "customers", state: "processing", holeRef: "builtin:customers@1" });
  });

  test("learned exact wins, a learned near asks once, and unknown headers need a layout", async () => {
    const p = await plant();
    const { versionId } = await learnLayout(p.companyId, p.users.admin.id, khataRecipe());
    const { candidates } = await upload(p.admin, [
      { headers: ["Khata", "Gaam"], rows: [["Acme", "Surat"]] },
      { headers: ["Khata", "Gaam", "Extra"], rows: [["Acme", "Surat", "x"]] },
      { headers: ["Foo", "Bar"], rows: [["1", "2"]] },
    ]);
    expect(candidates[0]).toMatchObject({ fit: "exact", state: "processing", target: "customers", holeRef: `learned:${versionId}`, holeName: "Learned" });
    expect(candidates[1]).toMatchObject({ fit: "near", state: "needs_confirm", target: "customers", holeRef: `learned:${versionId}` });
    expect(candidates[2]).toMatchObject({ fit: "none", state: "needs_shape", target: null, holeRef: null });
    const near = await p.admin.ingest.candidate.get({ candidateId: candidates[1]!.id });
    expect(near.fitDiff).toMatchObject({ extra: [{ col: 2, header: "Extra" }] });
  });

  test("another plant's learned layout never fits here", async () => {
    const other = await plant();
    await learnLayout(other.companyId, other.users.admin.id, khataRecipe());
    const p = await plant();
    const { candidates } = await upload(p.admin, [{ headers: ["Khata", "Gaam"], rows: [["Acme", "Surat"]] }]);
    expect(candidates[0]).toMatchObject({ fit: "none", state: "needs_shape" });
  });

  test("a retired layout no longer fits", async () => {
    const p = await plant();
    const { holeId } = await learnLayout(p.companyId, p.users.admin.id, khataRecipe());
    await p.admin.ingest.hole.retire({ holeId });
    const { candidates } = await upload(p.admin, [{ headers: ["Khata", "Gaam"], rows: [["Acme", "Surat"]] }]);
    expect(candidates[0]!.state).toBe("needs_shape");
  });
});

describe("plan B7 transitions", () => {
  test("processing, ready, approved, held, discarded; each step needs the current expectSeq", async () => {
    const p = await plant();
    const { candidates } = await upload(p.admin, [CUSTOMERS]);
    const id = candidates[0]!.id;
    const done = await pump(p.admin, id);
    expect(done.state).toBe("ready");
    expect(done.counts).toMatchObject({ total: 2, create: 2 });
    const ready = await p.admin.ingest.candidate.get({ candidateId: id });
    expect(ready.openQuestions).toBe(0);

    await expect(p.admin.ingest.candidate.approve({ candidateId: id, expectSeq: ready.serverSeq - 1 })).rejects.toThrow(/another tab/);
    const approved = await p.admin.ingest.candidate.approve({ candidateId: id, expectSeq: ready.serverSeq });
    expect(approved.state).toBe("approved");
    expect(approved.serverSeq).toBe(ready.serverSeq + 1);
    await expect(p.admin.ingest.candidate.approve({ candidateId: id, expectSeq: approved.serverSeq })).rejects.toThrow(/ready/);

    const held = await p.admin.ingest.candidate.hold({ candidateId: id, reason: "check GST first", expectSeq: approved.serverSeq });
    expect(held).toMatchObject({ state: "held", reasonDetail: "check GST first" });
    const discarded = await p.admin.ingest.candidate.discard({ candidateId: id, expectSeq: held.serverSeq });
    expect(discarded.state).toBe("discarded");
  });

  test("approve, hold and discard write audit rows", async () => {
    const p = await plant();
    const { candidates } = await upload(p.admin, [CUSTOMERS]);
    const id = candidates[0]!.id;
    await pump(p.admin, id);
    let c = await p.admin.ingest.candidate.get({ candidateId: id });
    c = await p.admin.ingest.candidate.approve({ candidateId: id, expectSeq: c.serverSeq });
    c = await p.admin.ingest.candidate.hold({ candidateId: id, expectSeq: c.serverSeq });
    await p.admin.ingest.candidate.discard({ candidateId: id, expectSeq: c.serverSeq });
    const rows = await env.d1
      .prepare("select action from audit_log where company_id = ? and action like 'ingest.%' order by at")
      .bind(p.companyId)
      .all<{ action: string }>();
    expect(rows.results.map((r) => r.action)).toEqual(
      expect.arrayContaining(["ingest.artifact.upload", "ingest.candidate.approve", "ingest.candidate.hold", "ingest.candidate.discard"]),
    );
  });

  test("needs_shape: setTarget with no layout stays there; ignore discards", async () => {
    const p = await plant();
    const { candidates } = await upload(p.admin, [
      { headers: ["Foo", "Bar"], rows: [["1", "2"]] },
      { headers: ["Qux"], rows: [["3"]] },
    ]);
    const [a, b] = candidates as [(typeof candidates)[0], (typeof candidates)[0]];
    const set = await p.admin.ingest.candidate.setTarget({ candidateId: a.id, target: "customers", expectSeq: a.serverSeq });
    expect(set).toMatchObject({ state: "needs_shape", target: "customers", fit: "manual" });
    const ignored = await p.admin.ingest.candidate.setTarget({ candidateId: b.id, target: "ignore", expectSeq: b.serverSeq });
    expect(ignored.state).toBe("discarded");
  });

  test("shape.save: a person's layout moves the sheet to checking rows; approval saves the layout", async () => {
    const p = await plant();
    const { candidates } = await upload(p.admin, [{ headers: ["Khata", "Gaam"], rows: [["Acme", "Surat"], ["Bharat", "Rajkot"]] }]);
    const c = candidates[0]!;
    expect(c.state).toBe("needs_shape");
    const saved = await p.admin.ingest.shape.save({ candidateId: c.id, recipe: khataRecipe(), holeName: "Khata list", expectSeq: c.serverSeq });
    expect(saved).toMatchObject({ state: "processing", target: "customers", fit: "manual" });
    expect(saved.holeRef).toMatch(/^learned:/);
    let holes = await p.admin.ingest.hole.list({});
    expect(holes).toHaveLength(1);
    expect(holes[0]!.versions[0]).toMatchObject({ state: "draft", madeBy: "person" });

    await pump(p.admin, c.id);
    const ready = await p.admin.ingest.candidate.get({ candidateId: c.id });
    await p.admin.ingest.candidate.approve({ candidateId: c.id, expectSeq: ready.serverSeq });
    holes = await p.admin.ingest.hole.list({});
    expect(holes[0]).toMatchObject({ name: "Khata list", currentVersion: 1 });
    expect(holes[0]!.versions[0]!.state).toBe("approved");

    // The next file with these headers fits exactly.
    const next = await upload(p.admin, [{ headers: ["Khata", "Gaam"], rows: [["Chetak", "Morbi"]] }]);
    expect(next.candidates[0]).toMatchObject({ fit: "exact", state: "processing" });
  });

  test("shape.save refuses a layout that does not fit the sheet", async () => {
    const p = await plant();
    const { candidates } = await upload(p.admin, [{ headers: ["Only"], rows: [["x"]] }]);
    const c = candidates[0]!;
    await expect(p.admin.ingest.shape.save({ candidateId: c.id, recipe: khataRecipe(), holeName: "x", expectSeq: c.serverSeq })).rejects.toThrow(
      /problems/,
    );
    await expect(p.admin.ingest.shape.save({ candidateId: c.id, recipe: { target: "customers" }, holeName: "x", expectSeq: c.serverSeq })).rejects.toThrow(
      /not complete/,
    );
  });

  test("shape.make with no key is skipped, makes no call, and leaves the sheet as it was", async () => {
    const p = await plant();
    const { candidates } = await upload(p.admin, [{ headers: ["Foo", "Bar"], rows: [["1", "2"]] }]);
    const c = candidates[0]!;
    const out = await p.admin.ingest.shape.make({ candidateId: c.id, expectSeq: c.serverSeq });
    expect(out).toMatchObject({ outcome: "skipped", skipReason: "no_key" });
    const after = await p.admin.ingest.candidate.get({ candidateId: c.id });
    expect(after).toMatchObject({ state: "needs_shape", serverSeq: c.serverSeq, botAttempts: 0 });
  });

  test("a failed read marks the file and its sheets failed", async () => {
    const p = await plant();
    const begin = await p.admin.ingest.artifact.begin({ sha256: sha(), fileName: "bad.xlsx", sizeBytes: 10, contentType: null, kind: "sheet" });
    await p.admin.ingest.artifact.putBlocks({ artifactId: begin.artifactId, blocks: [blockOf(CUSTOMERS, 0)] });
    await p.admin.ingest.artifact.complete({ artifactId: begin.artifactId, readError: "The file is password protected" });
    const detail = await p.admin.ingest.artifact.get({ artifactId: begin.artifactId });
    expect(detail).toMatchObject({ readState: "failed", readError: "The file is password protected" });
    expect(detail.blocks[0]!.candidates[0]!.state).toBe("failed");
  });
});

describe("a near match never merges on its own", () => {
  test("it waits in needs_confirm; approve and the dry run refuse; accept keeps the variant a draft", async () => {
    const p = await plant();
    await learnLayout(p.companyId, p.users.admin.id, khataRecipe());
    const near: Sheet = { headers: ["Khata", "Gaam", "Extra"], rows: [["Acme", "Surat", "x"]] };
    const { candidates } = await upload(p.admin, [near]);
    const c = candidates[0]!;
    expect(c.state).toBe("needs_confirm");
    await expect(p.admin.ingest.candidate.approve({ candidateId: c.id, expectSeq: c.serverSeq })).rejects.toThrow(/ready/);
    await expect(p.admin.ingest.dryRun.step({ candidateId: c.id, expectCursor: 0 })).rejects.toThrow(/not ready/);

    const accepted = await p.admin.ingest.candidate.confirmNear({ candidateId: c.id, accept: true, expectSeq: c.serverSeq });
    expect(accepted.state).toBe("processing");
    await pump(p.admin, c.id);
    expect((await p.admin.ingest.candidate.get({ candidateId: c.id })).state).toBe("ready");

    // Until a person approves, the variant is a draft and the same headers still only fit near.
    const again = await upload(p.admin, [near]);
    expect(again.candidates[0]!.state).toBe("needs_confirm");
  });

  test("reject sends the sheet to the column mapping", async () => {
    const p = await plant();
    await learnLayout(p.companyId, p.users.admin.id, khataRecipe());
    const { candidates } = await upload(p.admin, [{ headers: ["Khata", "Gaam", "Extra"], rows: [["Acme", "Surat", "x"]] }]);
    const c = candidates[0]!;
    const rejected = await p.admin.ingest.candidate.confirmNear({ candidateId: c.id, accept: false, expectSeq: c.serverSeq });
    expect(rejected).toMatchObject({ state: "needs_shape", recipe: null, holeRef: null });
  });
});

describe("rates are masked without order.price", () => {
  async function bakiPlant() {
    const p = await plant();
    const fp = fingerprint({ headers: BAKI_SHEET_HEADERS, rows: [] });
    const recipe: Recipe = {
      ...EXAMPLE_BAKI_RECIPE,
      headerRow: 0,
      match: { headerKey: fp.headerKey, headers: fp.normalized },
      fields: EXAMPLE_BAKI_RECIPE.fields.map((f) =>
        f.field === "rate" ? { ...f, steps: [{ op: "number" as const, kind: "price_per_mass" as const, unit: "inr/kg" }] } : f,
      ),
      unclear: [],
    };
    await learnLayout(p.companyId, p.users.owner.id, recipe, "Baki");
    const row = ["1", "Acme Traders", "OB-1", "01/10/2025", "DOMAL 12170", "6.1", "500", "200", "300", "245.50", ""];
    const { candidates } = await upload(p.admin, [{ headers: BAKI_SHEET_HEADERS, rows: [row] }]);
    const c = candidates[0]!;
    expect(c).toMatchObject({ target: "orders", fit: "exact", state: "processing" });
    await pump(p.admin, c.id);
    return { ...p, candidateId: c.id };
  }

  test("admin (no order.price) sees no rate in values, entered or raw; the owner sees all three", async () => {
    const p = await bakiPlant();
    const masked = (await p.admin.ingest.rows.list({ candidateId: p.candidateId })).items[0]!;
    expect(masked.rateHidden).toBe(true);
    expect(masked.rate).toBeNull();
    expect(masked.values && "rate" in masked.values).toBe(false);
    expect(masked.entered && "rate" in masked.entered).toBe(false);
    expect(masked.raw[9]).toBe("");
    expect(masked.entered?.orderedKg).toEqual({ text: "500", unit: "kg" });

    const open = (await p.owner.ingest.rows.list({ candidateId: p.candidateId })).items[0]!;
    expect(open.rateHidden).toBe(false);
    expect(open.rate).toBe(24_550);
    expect(open.entered?.rate).toEqual({ text: "245.50", unit: "inr/kg" });
    expect(open.raw[9]).toBe("245.50");
  });

  test("the admin is asked about hidden rates; the owner is not", async () => {
    const p = await bakiPlant();
    const forAdmin = await p.admin.ingest.candidate.get({ candidateId: p.candidateId });
    expect(forAdmin.questions.some((q) => q.code === "rates_hidden" && q.open)).toBe(true);
    const forOwner = await p.owner.ingest.candidate.get({ candidateId: p.candidateId });
    expect(forOwner.questions.some((q) => q.code === "rates_hidden")).toBe(false);
  });
});

describe("the two actions", () => {
  const ROLES: CompanyRole[] = ["manager", "office", "accountant", "supervisor", "packer", "viewer"];

  test("roles without ingest.upload or ingest.merge get FORBIDDEN on reads and writes", async () => {
    const p = await plant();
    for (const role of ROLES) {
      const as = p.as(role);
      await expect(as.ingest.status()).rejects.toThrow(/permission/);
      await expect(as.ingest.artifact.begin({ sha256: sha(), fileName: "a.csv", sizeBytes: 10, contentType: null, kind: "csv" })).rejects.toThrow(
        /permission/,
      );
      await expect(as.ingest.merge.start()).rejects.toThrow(/permission/);
    }
    expect((await p.owner.ingest.status()).activeRunId).toBeNull();
    expect((await p.admin.ingest.status()).activeRunId).toBeNull();
  });

  test("merge.start is wired to the merge seam (lane B stub until it lands)", async () => {
    const p = await plant();
    await expect(p.owner.ingest.merge.start()).rejects.toThrow(/Nothing is approved to merge/);
  });

  test("one plant cannot read another plant's candidate", async () => {
    const a = await plant();
    const b = await plant();
    const { candidates } = await upload(a.admin, [CUSTOMERS]);
    await expect(b.admin.ingest.candidate.get({ candidateId: candidates[0]!.id })).rejects.toThrow(/not found/);
    await expect(b.admin.ingest.rows.list({ candidateId: candidates[0]!.id })).rejects.toThrow(/not found/);
  });
});

describe("questions and row decisions", () => {
  async function bakiReady() {
    const p = await plant();
    const fp = fingerprint({ headers: BAKI_SHEET_HEADERS, rows: [] });
    // The rate column keeps no unit, so the sheet asks for it (unit_unknown).
    await learnLayout(p.companyId, p.users.owner.id, { ...EXAMPLE_BAKI_RECIPE, headerRow: 0, match: { headerKey: fp.headerKey, headers: fp.normalized } }, "Baki");
    const row = ["1", "Acme Traders", "OB-1", "01/10/2025", "DOMAL 12170", "6.1", "500", "200", "300", "245.50", ""];
    const { candidates } = await upload(p.owner, [{ headers: BAKI_SHEET_HEADERS, rows: [row] }]);
    await pump(p.owner, candidates[0]!.id);
    return { ...p, candidateId: candidates[0]!.id };
  }

  test("approve is refused while a question is open; answering re-runs the rows", async () => {
    const p = await bakiReady();
    let c = await p.owner.ingest.candidate.get({ candidateId: p.candidateId });
    expect(c.state).toBe("ready");
    const unit = c.questions.find((q) => q.code === "unit_unknown" && q.subject === "rate");
    expect(unit?.open).toBe(true);
    await expect(p.owner.ingest.candidate.approve({ candidateId: p.candidateId, expectSeq: c.serverSeq })).rejects.toThrow(/Answer every question/);

    await expect(
      p.owner.ingest.answer.set({ candidateId: p.candidateId, questionCode: "unit_unknown", subject: "rate", answer: "kg", expectSeq: c.serverSeq }),
    ).rejects.toThrow(/unit does not fit/);
    await expect(
      p.owner.ingest.answer.set({ candidateId: p.candidateId, questionCode: "unit_unknown", subject: "nothing", answer: "inr/kg", expectSeq: c.serverSeq }),
    ).rejects.toThrow(/does not ask/);
    c = await p.owner.ingest.answer.set({ candidateId: p.candidateId, questionCode: "unit_unknown", subject: "rate", answer: { unit: "inr/kg" }, expectSeq: c.serverSeq });
    expect(c).toMatchObject({ state: "processing", dryCursor: 0 });
    await pump(p.owner, p.candidateId);
    c = await p.owner.ingest.candidate.get({ candidateId: p.candidateId });
    expect(c.questions.find((q) => q.code === "unit_unknown" && q.subject === "rate")?.open).toBe(false);
    const row = (await p.owner.ingest.rows.list({ candidateId: p.candidateId })).items[0]!;
    expect(row.rate).toBe(24_550);
  });

  test("rows.decide skip re-runs from that row and counts it skipped", async () => {
    const p = await plant();
    const { candidates } = await upload(p.admin, [CUSTOMERS]);
    const id = candidates[0]!.id;
    await pump(p.admin, id);
    const c = await p.admin.ingest.candidate.get({ candidateId: id });
    const rows = await p.admin.ingest.rows.list({ candidateId: id });
    const second = rows.items[1]!;
    await expect(
      p.admin.ingest.rows.decide({ candidateId: id, rowIds: [second.id], decision: "use_match", expectSeq: c.serverSeq }),
    ).rejects.toThrow(/Pick the record/);
    await expect(
      p.admin.ingest.rows.decide({ candidateId: id, rowIds: [second.id], decision: "create_new", expectSeq: c.serverSeq }),
    ).rejects.toThrow(/need a choice/);
    await p.admin.ingest.rows.decide({ candidateId: id, rowIds: [second.id], decision: "skip", expectSeq: c.serverSeq });
    const after = await p.admin.ingest.candidate.get({ candidateId: id });
    expect(after).toMatchObject({ state: "processing", dryCursor: 1 });
    const done = await pump(p.admin, id);
    expect(done.counts).toMatchObject({ create: 1, skipped: 1 });
  });

  test("an existing customer with a different city is a conflict until a person picks", async () => {
    const p = await plant();
    await p.owner.customer.create({ name: "Acme Traders", billingAddress: { city: "Ahmedabad" } });
    const { candidates } = await upload(p.admin, [CUSTOMERS]);
    const id = candidates[0]!.id;
    const out = await pump(p.admin, id);
    expect(out.counts).toMatchObject({ conflict: 1, create: 1 });
    let c = await p.admin.ingest.candidate.get({ candidateId: id });
    expect(c.openQuestions).toBeGreaterThan(0);
    await expect(p.admin.ingest.candidate.approve({ candidateId: id, expectSeq: c.serverSeq })).rejects.toThrow(/Answer every question/);
    const conflict = (await p.admin.ingest.rows.list({ candidateId: id, state: "conflict" })).items[0]!;
    expect(conflict.diff).toMatchObject({ city: { live: "Ahmedabad", file: "Surat" } });
    await p.admin.ingest.rows.decide({ candidateId: id, rowIds: [conflict.id], decision: "keep_live", expectSeq: c.serverSeq });
    await pump(p.admin, id);
    c = await p.admin.ingest.candidate.get({ candidateId: id });
    expect(c.counts).toMatchObject({ unchanged: 1, create: 1, conflict: 0 });
    const approved = await p.admin.ingest.candidate.approve({ candidateId: id, expectSeq: c.serverSeq });
    expect(approved.state).toBe("approved");
  });
});
