/**
 * Wave 2 die room, bulk attach by file name (FP-DR-19, backlog 38), board filters / sort / tiles
 * (backlog 39) and an import of 3,000 rows in two calls (the web sends 2,000 per call).
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";

import { auditLog, die, dieFile, dieInstance } from "@orrn/db/schema";
import { and, eq } from "drizzle-orm";

import { workersEnv } from "./env-mock";
import { createTestEnv, type CompanyRole, type TestEnv } from "./harness";

let env: TestEnv;
let files: typeof import("../src/lib/dieFiles");

class FakeR2 {
  objects = new Map<string, { body: Uint8Array; httpMetadata?: Record<string, string> }>();
  async put(key: string, value: Uint8Array | ReadableStream, opts?: { httpMetadata?: Record<string, string> }) {
    const body = value instanceof Uint8Array ? value : new Uint8Array(await new Response(value).arrayBuffer());
    this.objects.set(key, { body, httpMetadata: opts?.httpMetadata });
    return { key, size: body.byteLength };
  }
  async head(key: string) {
    const o = this.objects.get(key);
    return o ? { key, size: o.body.byteLength, httpMetadata: o.httpMetadata } : null;
  }
  async get(key: string) {
    return this.objects.get(key) ?? null;
  }
  async delete(key: string) {
    this.objects.delete(key);
  }
}
let r2: FakeR2;

beforeAll(async () => {
  env = await createTestEnv();
  files = await import("../src/lib/dieFiles");
});
afterEach(() => {
  r2 = new FakeR2();
  workersEnv.DIE_FILES = r2;
});
afterAll(async () => {
  delete workersEnv.DIE_FILES;
  await env.dispose();
});

async function plant() {
  r2 ??= new FakeR2();
  workersEnv.DIE_FILES = r2;
  const { companyId } = await env.seedCompany({ settings: { dieRoom: { newCopyOnTrial: false } } });
  const s12170 = await env.seedDie(companyId, { series: "Domal", sectionCode: "12170", weightMinG: 5_900, weightMaxG: 6_200 });
  const s13090 = await env.seedDie(companyId, { series: "Domal", sectionCode: "13090", weightMinG: 2_700, weightMaxG: 2_900 });
  const as = (role: CompanyRole) => env.caller({ role, companyId });
  const dieRoom = as("die_room");
  const c1 = await dieRoom.dieInstance.create({ sectionId: s12170 });
  const c2 = await dieRoom.dieInstance.create({ sectionId: s12170 });
  return { companyId, s12170, s13090, c1, c2, as, dieRoom };
}
type Plant = Awaited<ReturnType<typeof plant>>;

async function put(url: string, bytes: number) {
  const headers = new Headers({ "content-type": "application/octet-stream", "content-length": String(bytes) });
  return files.handleDieFileUpload(new Request(new URL(url, "https://api.test"), { method: "PUT", body: new Uint8Array(bytes).fill(7), headers }), { bucket: r2 as never });
}

/** What the web does for one matched file: begin, PUT, commit. */
async function attach(p: Plant, m: { name: string; kind: "image" | "pdf" | "cdr" | "dwg"; sectionId: string | null; dieInstanceId: string | null; pressDrawing: boolean }, bytes = 2048) {
  const begun = await p.dieRoom.dieInstance.files.beginUpload({
    ...(m.dieInstanceId ? { copyId: m.dieInstanceId } : { sectionId: m.sectionId! }),
    kind: m.kind,
    name: m.name,
    size: bytes,
    mime: m.kind === "pdf" ? "application/pdf" : "",
    ...(m.pressDrawing ? { pressDrawingIfNone: true } : {}),
  });
  expect((await put(begun.uploadUrl, bytes)).status).toBe(200);
  return p.dieRoom.dieInstance.files.commit({ uploadId: begun.uploadId });
}

describe("matchNames: file names to sections and copies", () => {
  test("12170.pdf is the section, 12170-1.cdr the copy, 12170/2.dwg reads as the copy, the rest is listed", async () => {
    const p = await plant();
    const out = await p.dieRoom.dieInstance.files.matchNames({
      names: ["12170.pdf", "12170-1.cdr", "12170/2.dwg", "99999.pdf", "12170-9.cdr", "notes.txt", "13090.JPG", "12170.PDF.pdf"],
    });
    const by = Object.fromEntries(out.map((o) => [o.name, o]));
    expect(by["12170.pdf"]).toMatchObject({ status: "section", kind: "pdf", sectionId: p.s12170, dieInstanceId: null, target: "Domal 12170", pressDrawing: true });
    expect(by["12170-1.cdr"]).toMatchObject({ status: "copy", kind: "cdr", sectionId: p.s12170, dieInstanceId: p.c1.id, target: "12170-1", pressDrawing: false });
    expect(by["12170/2.dwg"]).toMatchObject({ status: "copy", kind: "dwg", dieInstanceId: p.c2.id });
    expect(by["99999.pdf"]).toMatchObject({ status: "unmatched", sectionId: null });
    expect(by["12170-9.cdr"]).toMatchObject({ status: "unmatched" });
    expect(by["notes.txt"]).toMatchObject({ status: "unsupported", kind: null });
    expect(by["13090.JPG"]).toMatchObject({ status: "section", kind: "image", sectionId: p.s13090, pressDrawing: false });
    expect(by["12170.PDF.pdf"]).toMatchObject({ status: "unmatched" });
  });

  test("only the first PDF of a section in one pick is marked as the press drawing", async () => {
    const p = await plant();
    const out = await p.dieRoom.dieInstance.files.matchNames({ names: ["12170.pdf", "12170.PDF", "12170-1.pdf"] });
    expect(out.map((o) => o.pressDrawing)).toEqual([true, false, false]);
    // A PDF for a copy never becomes the press drawing (the drawing belongs to the section).
    expect(out[2]).toMatchObject({ status: "copy", dieInstanceId: p.c1.id });
  });

  test("a section code held by two series is ambiguous, never guessed", async () => {
    const p = await plant();
    await env.seedDie(p.companyId, { series: "Other", sectionCode: "12170", weightMinG: 1_000, weightMaxG: 1_100 });
    const out = await p.dieRoom.dieInstance.files.matchNames({ names: ["12170.pdf"] });
    expect(out[0]).toMatchObject({ status: "ambiguous", sectionId: null });
  });

  test("a deleted section does not match; another plant's sections are invisible", async () => {
    const p = await plant();
    const q = await plant();
    await env.db.update(die).set({ deletedAt: new Date() }).where(eq(die.id, q.s13090));
    expect((await q.dieRoom.dieInstance.files.matchNames({ names: ["13090.pdf"] }))[0]!.status).toBe("unmatched");
    expect((await p.dieRoom.dieInstance.files.matchNames({ names: ["13090.pdf"] }))[0]).toMatchObject({ status: "section", sectionId: p.s13090 });
  });

  test("a file already on that section with the same name is flagged alreadyThere (a second run adds nothing twice)", async () => {
    const p = await plant();
    const first = await p.dieRoom.dieInstance.files.matchNames({ names: ["12170.pdf", "12170-1.cdr"] });
    for (const m of first) await attach(p, m as never);
    const again = await p.dieRoom.dieInstance.files.matchNames({ names: ["12170.pdf", "12170-1.cdr", "12170-2.cdr"] });
    expect(again.map((a) => [a.name, a.alreadyThere])).toEqual([
      ["12170.pdf", true],
      ["12170-1.cdr", true],
      ["12170-2.cdr", false],
    ]);
    // The section already has its press drawing, so a new PDF would not take it.
    expect(again[0]!.pressDrawing).toBe(false);
  });

  test("who may: the die room and masters; the viewer, office and packer are refused", async () => {
    const p = await plant();
    for (const role of ["owner", "admin", "manager", "die_room"] as const) {
      await expect(p.as(role).dieInstance.files.matchNames({ names: ["12170.pdf"] }), role).resolves.toHaveLength(1);
    }
    for (const role of ["viewer", "office", "packer", "supervisor", "press"] as const) {
      await expect(p.as(role).dieInstance.files.matchNames({ names: ["12170.pdf"] }), role).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    await expect(p.dieRoom.dieInstance.files.matchNames({ names: [] })).rejects.toBeDefined();
    await expect(p.dieRoom.dieInstance.files.matchNames({ names: Array.from({ length: 201 }, (_, i) => `${i}.pdf`) })).rejects.toBeDefined();
  });
});

describe("bulk attach end to end: three files, one unmatched", () => {
  test("12170.pdf (section drawing), 12170-1.cdr (copy), 77777.pdf (unmatched, never uploaded)", async () => {
    const p = await plant();
    const matched = await p.dieRoom.dieInstance.files.matchNames({ names: ["12170.pdf", "12170-1.cdr", "77777.pdf"] });
    const usable = matched.filter((m) => m.status === "section" || m.status === "copy");
    expect(usable).toHaveLength(2);
    const saved = [];
    for (const m of usable) saved.push(await attach(p, m as never));
    expect(saved.map((s) => s.pressDrawing)).toEqual([true, false]);

    const rows = await env.db.select().from(dieFile).where(eq(dieFile.companyId, p.companyId));
    expect(rows.map((r) => r.filename).sort()).toEqual(["12170-1.cdr", "12170.pdf"]);
    const pdf = rows.find((r) => r.filename === "12170.pdf")!;
    const cdr = rows.find((r) => r.filename === "12170-1.cdr")!;
    expect(pdf).toMatchObject({ kind: "pdf", sectionId: p.s12170, dieInstanceId: null, pressDrawing: true });
    expect(cdr).toMatchObject({ kind: "cdr", sectionId: p.s12170, dieInstanceId: p.c1.id, pressDrawing: false });
    const [section] = await env.db.select().from(die).where(eq(die.id, p.s12170));
    expect(section!.drawingKey).toBe(pdf.r2Key);
    expect(r2.objects.size).toBe(2);
    const adds = await env.db.select().from(auditLog).where(and(eq(auditLog.companyId, p.companyId), eq(auditLog.action, "die_file.add")));
    expect(adds).toHaveLength(2);
  });

  test("a PDF becomes the press drawing only if none is set: the second PDF stays a plain file", async () => {
    const p = await plant();
    const first = await attach(p, { name: "12170.pdf", kind: "pdf", sectionId: p.s12170, dieInstanceId: null, pressDrawing: true });
    expect(first.pressDrawing).toBe(true);
    // The web would not ask again (matchNames says pressDrawing:false), but even if it does, the server keeps the first.
    const second = await attach(p, { name: "12170-rev2.pdf", kind: "pdf", sectionId: p.s12170, dieInstanceId: null, pressDrawing: true });
    expect(second.pressDrawing).toBe(false);
    const [section] = await env.db.select().from(die).where(eq(die.id, p.s12170));
    expect(section!.drawingKey).toBe(first.key);
    const rows = await env.db.select().from(dieFile).where(eq(dieFile.sectionId, p.s12170));
    expect(rows.filter((r) => r.pressDrawing).map((r) => r.filename)).toEqual(["12170.pdf"]);
  });

  test("two PDFs begun before either commits: one takes the place, the other is a plain file", async () => {
    const p = await plant();
    const a = await p.dieRoom.dieInstance.files.beginUpload({ sectionId: p.s12170, kind: "pdf", name: "a.pdf", size: 512, mime: "application/pdf", pressDrawingIfNone: true });
    const b = await p.dieRoom.dieInstance.files.beginUpload({ sectionId: p.s12170, kind: "pdf", name: "b.pdf", size: 512, mime: "application/pdf", pressDrawingIfNone: true });
    await put(a.uploadUrl, 512);
    await put(b.uploadUrl, 512);
    const ca = await p.dieRoom.dieInstance.files.commit({ uploadId: a.uploadId });
    const cb = await p.dieRoom.dieInstance.files.commit({ uploadId: b.uploadId });
    expect([ca.pressDrawing, cb.pressDrawing]).toEqual([true, false]);
    const rows = await env.db.select().from(dieFile).where(eq(dieFile.sectionId, p.s12170));
    expect(rows.filter((r) => r.pressDrawing)).toHaveLength(1);
  });

  test("a real race: the other commit lands between this one's read and its batch; no error, both files kept", async () => {
    const p = await plant();
    const a = await p.dieRoom.dieInstance.files.beginUpload({ sectionId: p.s12170, kind: "pdf", name: "a.pdf", size: 512, mime: "application/pdf", pressDrawingIfNone: true });
    const b = await p.dieRoom.dieInstance.files.beginUpload({ sectionId: p.s12170, kind: "pdf", name: "b.pdf", size: 512, mime: "application/pdf", pressDrawingIfNone: true });
    await put(a.uploadUrl, 512);
    await put(b.uploadUrl, 512);
    // A has read the section (no drawing yet); B commits in full before A's batch runs.
    let cb: { pressDrawing: boolean; key: string } | undefined;
    env.beforeNextBatch(async () => {
      cb = await p.dieRoom.dieInstance.files.commit({ uploadId: b.uploadId });
    });
    const ca = await p.dieRoom.dieInstance.files.commit({ uploadId: a.uploadId });
    expect(cb!.pressDrawing).toBe(true);
    expect(ca.pressDrawing).toBe(false);
    const [section] = await env.db.select().from(die).where(eq(die.id, p.s12170));
    expect(section!.drawingKey).toBe(cb!.key);
    const rows = await env.db.select().from(dieFile).where(eq(dieFile.sectionId, p.s12170));
    expect(rows.map((r) => [r.filename, r.pressDrawing]).sort()).toEqual([["a.pdf", false], ["b.pdf", true]]);
    // Neither upload was deleted.
    expect(r2.objects.has(ca.key)).toBe(true);
    expect(r2.objects.has(cb!.key)).toBe(true);
  });

  test("a press-drawing row left without the section key never collides: the new PDF stays a plain file", async () => {
    const p = await plant();
    const first = await attach(p, { name: "12170.pdf", kind: "pdf", sectionId: p.s12170, dieInstanceId: null, pressDrawing: true });
    expect(first.pressDrawing).toBe(true);
    // A hand fix cleared die.drawing_key but left the file flagged.
    await env.db.update(die).set({ drawingKey: null }).where(eq(die.id, p.s12170));
    const second = await attach(p, { name: "12170-b.pdf", kind: "pdf", sectionId: p.s12170, dieInstanceId: null, pressDrawing: true });
    expect(second.pressDrawing).toBe(false);
    expect(r2.objects.has(second.key)).toBe(true);
    const rows = await env.db.select().from(dieFile).where(eq(dieFile.sectionId, p.s12170));
    expect(rows.filter((r) => r.pressDrawing).map((r) => r.filename)).toEqual(["12170.pdf"]);
  });

  test("pressDrawingIfNone is for a section's PDF only", async () => {
    const p = await plant();
    await expect(
      p.dieRoom.dieInstance.files.beginUpload({ copyId: p.c1.id, kind: "pdf", name: "x.pdf", size: 10, mime: "application/pdf", pressDrawingIfNone: true }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      p.dieRoom.dieInstance.files.beginUpload({ sectionId: p.s12170, kind: "cdr", name: "x.cdr", size: 10, mime: "", pressDrawingIfNone: true }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  test("a per-file refusal is the server's own sentence (a 26 MB PDF), and nothing is stored for it", async () => {
    const p = await plant();
    await expect(
      p.dieRoom.dieInstance.files.beginUpload({ sectionId: p.s12170, kind: "pdf", name: "12170.pdf", size: 26 * 1024 * 1024, mime: "application/pdf", pressDrawingIfNone: true }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("larger than 25 MB") });
    expect(r2.objects.size).toBe(0);
    expect(await env.db.select().from(dieFile).where(eq(dieFile.companyId, p.companyId))).toEqual([]);
  });
});

describe("board: filters, sort and tiles", () => {
  async function board() {
    const { companyId } = await env.seedCompany({ settings: { dieRoom: { newCopyOnTrial: true } } });
    const cust = await env.seedCustomer(companyId);
    const mk = (over: Record<string, unknown>) => env.seedDie(companyId, over as never);
    const a = await mk({ series: "Domal", sectionCode: "A100", weightMinG: 3_000, weightMaxG: 3_200, profileKind: "solid" });
    const b = await mk({ series: "Domal", sectionCode: "B200", weightMinG: 1_000, weightMaxG: 1_100, profileKind: "hollow", ownerCustomerId: cust });
    const c = await mk({ series: "Zed", sectionCode: "C300", weightMinG: 2_000, weightMaxG: 2_100 });
    const dr = env.caller({ role: "die_room", companyId });
    const owner = env.caller({ role: "owner", companyId });
    await dr.dieInstance.create({ sectionId: a }); // on_trial
    await dr.dieInstance.create({ sectionId: a });
    const rack = await owner.dieInstance.create({ sectionId: a, status: "available" });
    await owner.dieInstance.create({ sectionId: b, status: "available" });
    const retired = await owner.dieInstance.create({ sectionId: c, status: "available" });
    await owner.dieInstance.update({ id: retired.id, status: "retired" });
    return { companyId, a, b, c, rack, owner, cust };
  }

  test("tiles: copies by status and sections without live copies", async () => {
    const x = await board();
    const counts = await x.owner.die.boardCounts();
    expect(counts).toMatchObject({ sections: 3, sectionsWithoutCopies: 1 });
    expect(counts.copies).toMatchObject({ on_trial: 2, available: 2, retired: 1, in_use: 0, at_maker: 0, at_nitriding: 0 });
  });

  test("filters: copy status (On trial), kind, owner, copies none/some", async () => {
    const x = await board();
    const ids = async (input: Record<string, unknown>) => (await x.owner.die.list(input as never)).items.map((i) => i.id).sort();
    expect(await ids({ copyStatus: "on_trial" })).toEqual([x.a]);
    expect(await ids({ copyStatus: "available" })).toEqual([x.a, x.b].sort());
    expect(await ids({ profileKind: "hollow" })).toEqual([x.b]);
    expect(await ids({ owner: "customer" })).toEqual([x.b]);
    expect(await ids({ owner: "plant" })).toEqual([x.a, x.c].sort());
    expect(await ids({ copies: "none" })).toEqual([x.c]);
    expect(await ids({ copies: "some" })).toEqual([x.a, x.b].sort());
    const both = await x.owner.die.list({ copies: "some", profileKind: "solid" });
    expect(both.items.map((i) => i.id)).toEqual([x.a]);
    expect(both.total).toBe(1);
  });

  test("sort: code, band (lightest first) and copies (most first)", async () => {
    const x = await board();
    const order = async (sort: "newest" | "code" | "band" | "copies") => (await x.owner.die.list({ sort })).items.map((i) => i.sectionCode);
    expect(await order("code")).toEqual(["A100", "B200", "C300"]);
    expect(await order("band")).toEqual(["B200", "C300", "A100"]);
    expect((await order("copies"))[0]).toBe("A100");
    expect((await order("newest")).sort()).toEqual(["A100", "B200", "C300"]);
  });
});

describe("import of 3,000 rows in two calls (2,000 + 1,000)", () => {
  test("every row lands once; params stay within the D1 limit; the same chunk sent again is replayed", async () => {
    const { companyId } = await env.seedCompany();
    const owner = env.caller({ role: "owner", companyId });
    const rows = Array.from({ length: 3_000 }, (_, i) => ({
      series: "BULK",
      sectionCode: `S${String(i).padStart(4, "0")}`,
      dimensions: {},
      weightMinG: 1_000 + (i % 50),
      weightMaxG: 1_100 + (i % 50),
      status: "active" as const,
    }));
    env.resetPeakParams();
    // The check the web runs before the save takes 2,000 rows at a time too.
    const checked = await owner.die.validateImport(rows.slice(0, 2_000));
    expect(checked.duplicates).toEqual([]);
    expect(checked.errors).toEqual([]);
    const first = await owner.die.processImport({ newRows: rows.slice(0, 2_000), updatedRows: [], clientRequestId: "imp-chunk-0000000001" });
    const second = await owner.die.processImport({ newRows: rows.slice(2_000), updatedRows: [], clientRequestId: "imp-chunk-0000000002" });
    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    expect(env.peakParams()).toBeLessThanOrEqual(100);
    const stored = await env.db.select({ id: die.id }).from(die).where(eq(die.companyId, companyId));
    expect(stored).toHaveLength(3_000);
    const again2 = await owner.die.validateImport(rows.slice(2_000));
    expect(again2.duplicates).toHaveLength(1_000);
    // The reply of chunk 1 was lost and the web sends it again: nothing is saved twice.
    await owner.die.processImport({ newRows: rows.slice(0, 2_000), updatedRows: [], clientRequestId: "imp-chunk-0000000001" });
    expect(await env.db.select({ id: die.id }).from(die).where(eq(die.companyId, companyId))).toHaveLength(3_000);
    // Over 2,000 in one call is refused with the split message.
    await expect(owner.die.processImport({ newRows: rows.slice(0, 2_001), updatedRows: [] })).rejects.toBeDefined();
    // The board reads the whole book.
    expect((await owner.die.boardCounts()).sections).toBe(3_000);
  }, 120_000);
});

describe("dieInstance rows used by this file stay on the rack", () => {
  test("setting off: create gives available (the bulk tests rely on it)", async () => {
    const p = await plant();
    const [row] = await env.db.select().from(dieInstance).where(eq(dieInstance.id, p.c1.id));
    expect(row!.status).toBe("available");
  });
});
