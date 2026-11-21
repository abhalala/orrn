/**
 * orrn buddy, imports that work in practice (fix round decision 8, review S6). Real D1, through `/mcp` and
 * `buddy.drafts.confirm`, with the real 20 drafts an hour limit on.
 *
 * Pins: the composite drafts `orrn_import_answers` (each answer in order, the current expectSeq each time; a
 * stop part way says how many were saved) and `orrn_import_dry_run` (confirm hands the browser a drive; the
 * browser reports); ingest drafts run with the candidate's current expectSeq, so drafts made in one turn do not
 * conflict; the card names the sheet; and a 4,000-row sheet reaches the review link within 20 drafts.
 */
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { auditLog, buddyDraft } from "@orrn/db/schema";
import { fingerprint, type Recipe } from "@orrn/ingest";
import { and, eq, sql } from "drizzle-orm";

import { listPlant, tool } from "./buddy-fixture";
import { createTestEnv, type TestEnv } from "./harness";
import { plant as ingestPlant, putBlocksPicked, putRowsAs, sha, type Caller, type Plant } from "./ingest-portal-helpers";

let env: TestEnv;

beforeAll(async () => {
  env = await createTestEnv();
});

afterAll(async () => {
  await env.dispose();
});

const HEADERS = ["Bundle id", "Series", "Section", "Pcs", "Wt (g)", "Len (mm)"];

/** A learned bundles layout in grams (a weight of 20 g is below the plausible range and asks magnitude_check). */
function gramLayout(): Recipe {
  const fp = fingerprint({ headers: HEADERS, rows: [] });
  const col = (i: number) => ({ kind: "columns" as const, cols: [{ col: i, header: HEADERS[i]! }] });
  const steps: Recipe["fields"][number]["steps"][] = [
    [{ op: "trim" }],
    [{ op: "trim" }, { op: "case", to: "upper" }],
    [{ op: "trim" }, { op: "lookup", resolver: "section_by_code" }],
    [{ op: "number", kind: "count", unit: "pcs" }],
    [{ op: "number", kind: "mass", unit: "g" }],
    [{ op: "number", kind: "length", unit: "mm" }],
  ];
  const fields = ["legacyId", "series", "sectionCode", "quantity", "weightG", "lengthMm"];
  return {
    schemaVersion: 1,
    target: "bundles",
    headerRow: 0,
    headerRows: 1,
    match: { headerKey: fp.headerKey, headers: fp.normalized },
    fields: fields.map((field, i) => ({ field, source: col(i), steps: steps[i]! })),
    filters: [],
    keys: ["legacyId"],
    onExisting: "ask",
    unclear: [],
  } as Recipe;
}

async function learn(p: Plant): Promise<void> {
  const { ingestHole, ingestHoleVersion } = await import("@orrn/db/schema/ingest");
  const recipe = gramLayout();
  const holeId = `hole_${randomUUID()}`;
  await env.db.insert(ingestHole).values({ id: holeId, companyId: p.companyId, target: "bundles", name: "Bundles in g", currentVersion: 1, state: "active", createdBy: p.users.owner.id });
  await env.db.insert(ingestHoleVersion).values({
    id: `hv_${randomUUID()}`,
    companyId: p.companyId,
    holeId,
    version: 1,
    headerKey: recipe.match.headerKey,
    recipe: recipe as never,
    madeBy: "person",
    state: "approved",
    createdBy: p.users.owner.id,
  });
}

/** `n` bundle rows; every 500th weighs 20 (grams), which asks one magnitude_check question. */
function bundleRows(n: number, odd = true): string[][] {
  return Array.from({ length: n }, (_, i) => [`SB-${i + 1}`, "R", "5100", "10", odd && i % 500 === 0 ? "20" : "25000", "3658"]);
}

/** The browser's upload: begin, the tables, rows 500 at a time, complete. Never through the buddy (§12.2). */
async function uploadSheet(as: Caller, rows: string[][]): Promise<{ artifactId: string; candidateId: string }> {
  const begin = await as.ingest.artifact.begin({ sha256: sha(), fileName: "synthetic-bundles.xlsx", sizeBytes: 1000, contentType: null, kind: "sheet" });
  const put = await putBlocksPicked(as, {
    artifactId: begin.artifactId,
    blocks: [{ ordinal: 0, sheetName: "Stock", title: null, headerRow: 0, headerRows: 1, headers: HEADERS, rowCount: rows.length, sample: rows.slice(0, 200) }],
  });
  const blockId = put.blocks[0]!.blockId;
  for (let from = 0; from < rows.length; from += 500) {
    await putRowsAs(as, { blockId, fromIndex: from, expectRowsPut: from, rows: rows.slice(from, from + 500) });
  }
  await as.ingest.artifact.complete({ artifactId: begin.artifactId });
  return { artifactId: begin.artifactId, candidateId: put.candidates[0]!.id };
}

async function importPlant(rows: number, odd = true) {
  const p = await ingestPlant(env);
  await env.seedDie(p.companyId, { series: "R", sectionCode: "5100" });
  await learn(p);
  await listPlant(env, p.companyId);
  const { token } = await p.owner.buddy.grant.create();
  const sheet = await uploadSheet(p.owner, bundleRows(rows, odd));
  return { p, token, ...sheet };
}

/** What the bubble does for a confirmed dry run draft: pump `ingest.dryRun.step` until done, then report. */
async function drive(p: Plant, draftId: string): Promise<number> {
  const card = (await p.owner.buddy.drafts.listMine()).find((d) => d.id === draftId)!;
  expect(card.drive).toEqual({ kind: "dryRun", candidateId: expect.any(String) });
  const candidateId = card.drive!.candidateId;
  let cursor = (await p.owner.ingest.candidate.get({ candidateId })).dryCursor;
  let steps = 0;
  for (;;) {
    const out = await p.owner.ingest.dryRun.step({ candidateId, expectCursor: cursor });
    steps += 1;
    if (out.done) break;
    cursor = out.cursor;
    if (steps > 100) throw new Error("dry run did not finish");
  }
  const reported = await p.owner.buddy.drafts.report({ draftId, outcome: "done", summary: "Synthetic run finished" });
  expect(reported.drive).toBeNull();
  return steps;
}

async function draft(token: string, name: string, args: Record<string, unknown>): Promise<string> {
  const r = await tool(env, token, name, args);
  if (r.status !== "needs_confirm") throw new Error(`expected a draft, got ${JSON.stringify(r)}`);
  return r.data.draftId as string;
}

const MAGNITUDE = { questionCode: "magnitude_check", subject: "weightG|g|below" };

describe("orrn_import_answers", () => {
  test("one draft for a batch; confirm saves each answer in order with the current expectSeq; the card lists every answer", async () => {
    const { p, token, candidateId } = await importPlant(4);
    const run = await draft(token, "orrn_import_dry_run", { candidateId });
    expect((await p.owner.buddy.drafts.confirm({ draftId: run, via: "bubble" })).status).toBe("confirmed");
    await drive(p, run);
    const before = await p.owner.ingest.candidate.get({ candidateId });
    expect(before.questions.find((q) => q.code === "magnitude_check")).toMatchObject({ open: true });

    const draftId = await draft(token, "orrn_import_answers", {
      candidateId,
      answers: [
        { ...MAGNITUDE, answer: { unit: "kg" } },
        { ...MAGNITUDE, answer: "as_is" },
      ],
    });
    const row = await env.db.select().from(buddyDraft).where(eq(buddyDraft.id, draftId)).get();
    expect(row).toMatchObject({ path: "import.answerQuestions", kind: "answers" });
    const card = (await p.owner.buddy.drafts.listMine()).find((d) => d.id === draftId)!;
    expect(card).toMatchObject({
      kind: "answers",
      fields: [{ key: "candidateId", value: "synthetic-bundles.xlsx / Stock" }],
      items: [
        { label: "magnitude_check: weightG|g|below", value: '{"unit":"kg"}' },
        { label: "magnitude_check: weightG|g|below", value: "as_is" },
      ],
      link: `/ingest/review/${candidateId}`,
    });
    const done = await p.owner.buddy.drafts.confirm({ draftId, via: "settings" });
    expect(done).toMatchObject({ status: "confirmed", decidedVia: "settings", result: { applied: 2, total: 2 } });
    const after = await p.owner.ingest.candidate.get({ candidateId });
    // The last answer stands (the question closes when the dry run runs again).
    expect(after.questions.find((q) => q.code === "magnitude_check")).toMatchObject({ answer: "as_is" });
    expect(after.serverSeq).toBeGreaterThanOrEqual(before.serverSeq + 2);
  });

  test("a stop part way: failed with the server's sentence, and how many answers were saved", async () => {
    const { p, token, candidateId } = await importPlant(4);
    const run = await draft(token, "orrn_import_dry_run", { candidateId });
    await p.owner.buddy.drafts.confirm({ draftId: run, via: "bubble" });
    await drive(p, run);
    const draftId = await draft(token, "orrn_import_answers", {
      candidateId,
      answers: [
        { ...MAGNITUDE, answer: { unit: "kg" } },
        { ...MAGNITUDE, answer: "mm" },
        { ...MAGNITUDE, answer: "as_is" },
      ],
    });
    const out = await p.owner.buddy.drafts.confirm({ draftId, via: "bubble" });
    expect(out.status).toBe("failed");
    expect(out.failure).toMatch(/does not fit this column/);
    expect(out.result).toEqual({ applied: 1, total: 3 });
    const c = await p.owner.ingest.candidate.get({ candidateId });
    expect(c.questions.find((q) => q.code === "magnitude_check")).toMatchObject({ answer: "kg" });
  });

  test("more than 30 answers in one draft is refused (one Confirm request runs them all)", async () => {
    const { p, token, candidateId } = await importPlant(2);
    const answers = Array.from({ length: 31 }, (_, i) => ({ ...MAGNITUDE, subject: `weightG|g|below${i}`, answer: "as_is" }));
    expect((await tool(env, token, "orrn_import_answers", { candidateId, answers })).status).toBe("invalid");
    const n = await env.db.select({ n: sql<number>`count(*)` }).from(buddyDraft).where(eq(buddyDraft.companyId, p.companyId)).get();
    expect(Number(n?.n)).toBe(0);
  });

  test("an unknown question code makes no draft", async () => {
    const { p, token, candidateId } = await importPlant(2);
    const r = await tool(env, token, "orrn_import_answers", { candidateId, answers: [{ questionCode: "no_such_question", subject: "", answer: true }] });
    expect(r.status).toBe("invalid");
    const n = await env.db.select({ n: sql<number>`count(*)` }).from(buddyDraft).where(eq(buddyDraft.companyId, p.companyId)).get();
    expect(Number(n?.n)).toBe(0);
  });
});

describe("orrn_import_dry_run and buddy.drafts.report", () => {
  test("confirm hands the browser a drive; the report is stored once, ends the drive and is noted again", async () => {
    const { p, token, candidateId } = await importPlant(3);
    const draftId = await draft(token, "orrn_import_dry_run", { candidateId });
    const card = (await p.owner.buddy.drafts.listMine()).find((d) => d.id === draftId)!;
    expect(card).toMatchObject({ kind: "dryRun", path: "import.runDryRun", fields: [{ key: "candidateId", value: "synthetic-bundles.xlsx / Stock" }], items: null, drive: null });
    const confirmed = await p.owner.buddy.drafts.confirm({ draftId, via: "bubble" });
    expect(confirmed).toMatchObject({ status: "confirmed", drive: { kind: "dryRun", candidateId }, result: { candidateId, cursor: 0, state: "processing" } });
    // Nothing ran yet: the confirm only checked the candidate.
    expect((await p.owner.ingest.candidate.get({ candidateId })).dryCursor).toBe(0);
    await env.db.update(buddyDraft).set({ notedAt: new Date() }).where(eq(buddyDraft.id, draftId));
    await drive(p, draftId);
    const row = await env.db.select({ notedAt: buddyDraft.notedAt, result: buddyDraft.resultJson }).from(buddyDraft).where(eq(buddyDraft.id, draftId)).get();
    expect(row?.notedAt).toBeNull();
    // Delta S2: the outcome is the candidate's own state when the browser reported; the browser's words are not kept.
    expect(row?.result).toMatchObject({ dryRun: { outcome: "done", state: "ready" } });
    expect(JSON.stringify(row?.result)).not.toContain("Synthetic run finished");
    // A second report replays; the first one stands.
    const again = await p.owner.buddy.drafts.report({ draftId, outcome: "failed" });
    expect(again.result).toMatchObject({ dryRun: { outcome: "done" } });
    const audits = await env.db
      .select({ n: sql<number>`count(*)` })
      .from(auditLog)
      .where(and(eq(auditLog.subjectId, draftId), eq(auditLog.action, "buddy.draft.report")))
      .get();
    expect(Number(audits?.n)).toBe(1);
  });

  test("a candidate that cannot run now fails with the importer's sentence; report refuses a draft with no dry run", async () => {
    const { p, token, candidateId } = await importPlant(2);
    const first = await draft(token, "orrn_import_dry_run", { candidateId });
    await p.owner.buddy.drafts.confirm({ draftId: first, via: "bubble" });
    await drive(p, first);
    // magnitude_check is open, so the sheet waits for an answer; answer it and run once more to reach ready.
    const ans = await draft(token, "orrn_import_answers", { candidateId, answers: [{ ...MAGNITUDE, answer: "as_is" }] });
    await p.owner.buddy.drafts.confirm({ draftId: ans, via: "bubble" });
    const second = await draft(token, "orrn_import_dry_run", { candidateId });
    await p.owner.buddy.drafts.confirm({ draftId: second, via: "bubble" });
    await drive(p, second);
    expect((await p.owner.ingest.candidate.get({ candidateId })).state).toBe("ready");
    const third = await draft(token, "orrn_import_dry_run", { candidateId });
    expect(await p.owner.buddy.drafts.confirm({ draftId: third, via: "bubble" })).toMatchObject({ status: "failed", failure: "This import is already checked", drive: null });
    await expect(p.owner.buddy.drafts.report({ draftId: ans, outcome: "done" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("expectSeq is filled in at confirm (decision 8)", () => {
  test("two drafts made in one turn on the same candidate both run; Hermes's expectSeq is neither stored nor shown", async () => {
    const { p, token, candidateId } = await importPlant(2, false);
    const run = await draft(token, "orrn_import_dry_run", { candidateId });
    await p.owner.buddy.drafts.confirm({ draftId: run, via: "bubble" });
    await drive(p, run);
    const seen = await p.owner.ingest.candidate.get({ candidateId });
    expect(seen.state).toBe("ready");
    const hold = await draft(token, "orrn_call", { path: "ingest.candidate.hold", input: { candidateId, reason: "synthetic check", expectSeq: seen.serverSeq } });
    const release = await draft(token, "orrn_call", { path: "ingest.candidate.release", input: { candidateId, expectSeq: seen.serverSeq } });
    const stored = await env.db.select({ input: buddyDraft.inputJson }).from(buddyDraft).where(eq(buddyDraft.id, hold)).get();
    expect(stored?.input).toEqual({ candidateId, reason: "synthetic check" });
    const card = (await p.owner.buddy.drafts.listMine()).find((d) => d.id === hold)!;
    expect(card.fields.map((f) => f.key)).toEqual(["candidateId", "reason"]);
    expect(await p.owner.buddy.drafts.confirm({ draftId: hold, via: "bubble" })).toMatchObject({ status: "confirmed", failure: null });
    expect((await p.owner.buddy.drafts.confirm({ draftId: release, via: "bubble" })).status).toBe("confirmed");
  });
});

describe("a 4,000-row sheet reaches the review link within 20 drafts (review S6)", () => {
  test("upload in the browser, then the buddy: dry run, answer, dry run, review link", async () => {
    const { p, token, candidateId } = await importPlant(4000);
    // The buddy reads, then drafts. Every change is a draft the owner confirms.
    expect((await tool(env, token, "orrn_call", { path: "ingest.candidate.list", input: {} })).status).toBe("ok");
    const run1 = await draft(token, "orrn_import_dry_run", { candidateId });
    expect((await p.owner.buddy.drafts.confirm({ draftId: run1, via: "bubble" })).status).toBe("confirmed");
    // 200 rows a step: 20 steps of rows and the step that says done.
    expect(await drive(p, run1)).toBeGreaterThanOrEqual(20);

    const read = await tool(env, token, "orrn_call", { path: "ingest.candidate.get", input: { candidateId } });
    const open = (read.data.questions as { code: string; subject: string; open: boolean }[]).filter((q) => q.open);
    expect(open.map((q) => q.code)).toEqual(["magnitude_check"]);
    const answers = await draft(token, "orrn_import_answers", { candidateId, answers: open.map((q) => ({ questionCode: q.code, subject: q.subject, answer: "as_is" })) });
    expect((await p.owner.buddy.drafts.confirm({ draftId: answers, via: "bubble" })).status).toBe("confirmed");

    const run2 = await draft(token, "orrn_import_dry_run", { candidateId });
    expect((await p.owner.buddy.drafts.confirm({ draftId: run2, via: "bubble" })).status).toBe("confirmed");
    await drive(p, run2);

    const ready = await p.owner.ingest.candidate.get({ candidateId });
    expect(ready).toMatchObject({ state: "ready", openQuestions: 0 });
    expect(ready.counts).toMatchObject({ total: 4000, create: 4000 });
    const link = await tool(env, token, "orrn_review_link", { candidateId });
    expect(link).toMatchObject({ status: "ok", data: { path: `/ingest/review/${candidateId}` } });

    const made = await env.db.select({ n: sql<number>`count(*)` }).from(buddyDraft).where(eq(buddyDraft.companyId, p.companyId)).get();
    expect(Number(made?.n)).toBeLessThanOrEqual(20);
    expect(Number(made?.n)).toBe(3);
  }, 120_000); // measured 5.1 s on its own on a quiet Mac, 49.5 s at load average 30 (2026-11-20)
});
