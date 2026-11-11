/**
 * Lane A, round 3: the dry run and the merge agree (the merge's row checks run at dry run), magnitude
 * checks reach the person (C19), a held candidate has a way back through the API (B-new-3), and the
 * dateless order match stays inside the period's financial year. Real D1 through the `ingest` router.
 * No model and no network.
 */
import { createHash, randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { createTestEnv, type CompanyRole, type TestEnv } from "./harness";

import { fingerprint, type Recipe } from "@orrn/ingest";

let env: TestEnv;

beforeAll(async () => {
  env = await createTestEnv();
});

afterAll(async () => {
  await env.dispose();
});

type Caller = ReturnType<TestEnv["caller"]>;
type Sheet = { headers: string[]; rows: string[][]; name?: string };

const sha = () => createHash("sha256").update(randomUUID()).digest("hex");

async function plant() {
  const { companyId, users } = await env.seedCompany();
  const as = (role: CompanyRole) => env.caller({ role, companyId });
  return { companyId, users, as, admin: as("admin"), owner: as("owner") };
}

async function upload(as: Caller, sheets: Sheet[], fileName = "book.xlsx") {
  const begin = await as.ingest.artifact.begin({ sha256: sha(), fileName, sizeBytes: 1000, contentType: null, kind: "sheet" });
  const put = await as.ingest.artifact.putBlocks({
    artifactId: begin.artifactId,
    blocks: sheets.map((s, ordinal) => ({
      ordinal,
      sheetName: s.name ?? `Sheet${ordinal + 1}`,
      title: null,
      headerRow: 0,
      headerRows: 1,
      headers: s.headers,
      rowCount: s.rows.length,
      sample: s.rows.slice(0, 200),
    })),
  });
  for (const [i, s] of sheets.entries()) {
    const block = put.blocks.find((b) => b.ordinal === i)!;
    if (s.rows.length > 0) await as.ingest.artifact.putRows({ blockId: block.blockId, fromIndex: 0, expectRowsPut: 0, rows: s.rows });
  }
  await as.ingest.artifact.complete({ artifactId: begin.artifactId });
  return { artifactId: begin.artifactId, candidates: put.candidates.sort((a, b) => a.blockOrdinal - b.blockOrdinal) };
}

async function pump(as: Caller, candidateId: string) {
  let cursor = (await as.ingest.candidate.get({ candidateId })).dryCursor;
  for (let i = 0; i < 50; i += 1) {
    const out = await as.ingest.dryRun.step({ candidateId, expectCursor: cursor });
    if (out.done) return out;
    cursor = out.cursor;
  }
  throw new Error("dry run did not finish");
}

async function learnLayout(companyId: string, createdBy: string, recipe: Recipe, name = "Learned") {
  const { ingestHole, ingestHoleVersion } = await import("@orrn/db/schema/ingest");
  const holeId = `hole_${randomUUID()}`;
  await env.db.insert(ingestHole).values({ id: holeId, companyId, target: recipe.target, name, currentVersion: 1, state: "active", createdBy });
  await env.db.insert(ingestHoleVersion).values({
    id: `hv_${randomUUID()}`,
    companyId,
    holeId,
    version: 1,
    headerKey: recipe.match.headerKey,
    recipe: recipe as never,
    madeBy: "person",
    state: "approved",
    createdBy,
  });
}

const col = (col: number, header: string) => ({ kind: "columns" as const, cols: [{ col, header }] });
const trim = [{ op: "trim" as const }];

/** A layout over `headers`, with each field read from the column of the same place. */
function layout(target: Recipe["target"], headers: string[], fields: { field: string; steps: Recipe["fields"][number]["steps"] }[], keys: string[]): Recipe {
  const fp = fingerprint({ headers, rows: [] });
  return {
    schemaVersion: 1,
    target,
    headerRow: 0,
    headerRows: 1,
    match: { headerKey: fp.headerKey, headers: fp.normalized },
    fields: fields.map((f, i) => ({ field: f.field, source: col(i, headers[i]!), steps: f.steps })),
    filters: [],
    keys,
    onExisting: "ask",
    unclear: [],
  } as Recipe;
}

async function rowsOf(as: Caller, candidateId: string) {
  return (await as.ingest.rows.list({ candidateId, limit: 100 })).items;
}

const bundleHeaders = (unit: string) => ["Bundle id", "Series", "Section", "Pcs", `Wt (${unit})`, "Len (mm)"];
const bundleLayout = (unit: "kg" | "t") =>
  layout(
    "bundles",
    bundleHeaders(unit),
    [
      { field: "legacyId", steps: trim },
      { field: "series", steps: [{ op: "trim" }, { op: "case", to: "upper" }] },
      { field: "sectionCode", steps: [{ op: "trim" }, { op: "lookup", resolver: "section_by_code" }] },
      { field: "quantity", steps: [{ op: "number", kind: "count", unit: "pcs" }] },
      { field: "weightG", steps: [{ op: "number", kind: "mass", unit }] },
      { field: "lengthMm", steps: [{ op: "number", kind: "length", unit: "mm" }] },
    ],
    ["legacyId"],
  );

// ---------------------------------------------------------------------------
// Item 2: the dry run applies the merge's row checks
// ---------------------------------------------------------------------------

const ORDER_HEADERS = ["Party", "PO", "Date", "Series", "Section", "Cut (mm)", "Pcs", "Baki (kg)"];
const orderLayout = () =>
  layout(
    "orders",
    ORDER_HEADERS,
    [
      { field: "customer", steps: [{ op: "trim" }, { op: "lookup", resolver: "customer_by_name" }] },
      { field: "poNumber", steps: trim },
      { field: "orderDate", steps: [{ op: "date", format: "dmy" }] },
      { field: "series", steps: [{ op: "trim" }, { op: "case", to: "upper" }] },
      { field: "sectionCode", steps: [{ op: "trim" }, { op: "lookup", resolver: "section_by_code" }] },
      { field: "cutLength", steps: [{ op: "number", kind: "length", unit: "mm" }] },
      { field: "pcs", steps: [{ op: "number", kind: "count", unit: "pcs" }] },
      { field: "bakiKg", steps: [{ op: "number", kind: "mass", unit: "kg" }] },
    ],
    ["customer", "poNumber", "orderDate"],
  );

describe("dry run and merge agree: order lines (B11)", () => {
  test("no cut length, no weight and balance 0 are refused at dry run with the merge's reason; a full line is ready", async () => {
    const p = await plant();
    await p.owner.customer.create({ name: "Acme Traders" });
    await env.seedDie(p.companyId, { series: "R", sectionCode: "5100" });
    await learnLayout(p.companyId, p.users.owner.id, orderLayout(), "Orders");
    const { candidates } = await upload(p.owner, [
      {
        headers: ORDER_HEADERS,
        rows: [
          ["Acme Traders", "PO-1", "01/10/2025", "R", "5100", "3658", "", "300"],
          ["Acme Traders", "PO-2", "01/10/2025", "R", "5100", "", "", "300"],
          ["Acme Traders", "PO-3", "01/10/2025", "R", "5100", "3658", "20", ""],
          ["Acme Traders", "PO-4", "01/10/2025", "R", "5100", "3658", "", "0"],
        ],
      },
    ]);
    await pump(p.owner, candidates[0]!.id);
    const rows = await rowsOf(p.owner, candidates[0]!.id);
    expect(rows.map((r) => r.state)).toEqual(["ready_create", "refused", "refused", "refused"]);
    expect(rows[1]!.reasons).toContain("no_cut_length:cutLength");
    expect(rows[2]!.reasons).toContain("no_weight:bakiKg");
    expect(rows[3]!.reasons).toContain("not_positive:bakiKg");
  });

  test("an order line whose section is not in orrn is refused, and no 'add it as an old section' question is asked", async () => {
    const p = await plant();
    await p.owner.customer.create({ name: "Acme Traders" });
    await learnLayout(p.companyId, p.users.owner.id, orderLayout(), "Orders");
    const { candidates } = await upload(p.owner, [{ headers: ORDER_HEADERS, rows: [["Acme Traders", "PO-1", "01/10/2025", "R", "9999", "3658", "", "300"]] }]);
    await pump(p.owner, candidates[0]!.id);
    const c = await p.owner.ingest.candidate.get({ candidateId: candidates[0]!.id });
    expect(c.questions.some((q) => q.code === "create_legacy_die")).toBe(false);
    const [row] = await rowsOf(p.owner, c.id);
    expect(row!.state).toBe("refused");
    expect(row!.reasons).toContain("section_unknown:sectionCode");
  });
});

const COPY_HEADERS = ["Series", "Section", "Maker die no", "Status"];
const copyLayout = () =>
  layout(
    "die_copies",
    COPY_HEADERS,
    [
      { field: "series", steps: [{ op: "trim" }, { op: "case", to: "upper" }] },
      { field: "sectionCode", steps: [{ op: "trim" }, { op: "lookup", resolver: "section_by_code" }] },
      { field: "makerDieNo", steps: trim },
      { field: "status", steps: trim },
    ],
    ["makerDieNo"],
  );

describe("dry run and merge agree: die copies (B10, B12)", () => {
  test("a status only the die room sets (in_use, at_maker, on_trial) is refused at dry run; available is ready", async () => {
    const p = await plant();
    await env.seedDie(p.companyId, { series: "R", sectionCode: "5200" });
    await learnLayout(p.companyId, p.users.owner.id, copyLayout(), "Copies");
    const { candidates } = await upload(p.owner, [
      {
        headers: COPY_HEADERS,
        rows: [
          ["R", "5200", "MK-1", "available"],
          ["R", "5200", "MK-2", "in_use"],
          ["R", "5200", "MK-3", "at_maker"],
          ["R", "5200", "MK-4", "on_trial"],
        ],
      },
    ]);
    await pump(p.owner, candidates[0]!.id);
    const rows = await rowsOf(p.owner, candidates[0]!.id);
    expect(rows.map((r) => r.state)).toEqual(["ready_create", "refused", "refused", "refused"]);
    for (const r of rows.slice(1)) expect(r.reasons).toContain("status_not_allowed:status");
  });

  test("a die copy whose section is not in orrn is refused with no old-section question; a bundle still gets the question", async () => {
    const p = await plant();
    await learnLayout(p.companyId, p.users.owner.id, copyLayout(), "Copies");
    const { candidates } = await upload(p.owner, [{ headers: COPY_HEADERS, rows: [["R", "9998", "MK-9", "available"]] }]);
    await pump(p.owner, candidates[0]!.id);
    const c = await p.owner.ingest.candidate.get({ candidateId: candidates[0]!.id });
    expect(c.questions.some((q) => q.code === "create_legacy_die")).toBe(false);
    const [row] = await rowsOf(p.owner, c.id);
    expect([row!.state, row!.reasons]).toEqual(["refused", ["section_unknown:sectionCode"]]);

    await learnLayout(p.companyId, p.users.owner.id, bundleLayout("kg"), "Bundles");
    const b = await upload(p.owner, [{ headers: bundleHeaders("kg"), rows: [["B-1", "R", "9998", "10", "900", "3658"]] }], "bundles.xlsx");
    await pump(p.owner, b.candidates[0]!.id);
    const bc = await p.owner.ingest.candidate.get({ candidateId: b.candidates[0]!.id });
    expect(bc.questions.some((q) => q.code === "create_legacy_die" && q.subject === "9998")).toBe(true);
  });
});

describe("dry run and merge agree: aliases (B13)", () => {
  test("an alias that is another customer's name is refused at dry run; a new alias is ready", async () => {
    const p = await plant();
    await p.owner.customer.create({ name: "Acme Traders" });
    await p.owner.customer.create({ name: "Bharat Metals" });
    const headers = ["Customer", "Other name"];
    await learnLayout(
      p.companyId,
      p.users.owner.id,
      layout(
        "customer_aliases",
        headers,
        [
          { field: "customer", steps: [{ op: "trim" }, { op: "lookup", resolver: "customer_by_name" }] },
          { field: "alias", steps: trim },
        ],
        ["alias"],
      ),
      "Aliases",
    );
    const { candidates } = await upload(p.owner, [
      {
        headers,
        rows: [
          ["Acme Traders", "Acme Trading Co"],
          ["Acme Traders", "Bharat Metals"],
        ],
      },
    ]);
    await pump(p.owner, candidates[0]!.id);
    const rows = await rowsOf(p.owner, candidates[0]!.id);
    expect(rows.map((r) => r.state)).toEqual(["ready_create", "refused"]);
    expect(rows[1]!.reasons).toEqual(["alias_is_name:alias"]);
  });
});

// ---------------------------------------------------------------------------
// Item 1: magnitude checks (C19)
// ---------------------------------------------------------------------------

/** A bundle sheet in tonnes: row 1 weighs "3" (3 t, past the plausible 2 t), row 2 "1.2" (fine). */
async function tonneBundles() {
  const p = await plant();
  await env.seedDie(p.companyId, { series: "R", sectionCode: "5100" });
  await learnLayout(p.companyId, p.users.owner.id, bundleLayout("t"), "Bundles in t");
  const { candidates } = await upload(p.owner, [
    {
      headers: bundleHeaders("t"),
      rows: [
        ["B-1", "R", "5100", "10", "3", "3658"],
        ["B-2", "R", "5100", "10", "1.2", "3658"],
      ],
    },
  ]);
  const id = candidates[0]!.id;
  await pump(p.owner, id);
  return { p, id };
}

describe("C19: a number outside its plausible range waits on a person", () => {
  test("bundle weight 3 in tonnes is not ready: ambiguous with the flag's reason and one magnitude_check question", async () => {
    const { p, id } = await tonneBundles();
    const rows = await rowsOf(p.owner, id);
    expect(rows[0]!.state).toBe("ambiguous");
    expect(rows[0]!.reasons).toEqual(["magnitude:weightG", "q:magnitude_check:weightG"]);
    expect(rows[1]!.state).toBe("ready_create");
    const c = await p.owner.ingest.candidate.get({ candidateId: id });
    const q = c.questions.find((x) => x.code === "magnitude_check");
    expect(q).toMatchObject({ subject: "weightG", open: true, params: { field: "weightG", unit: "t", side: "above", count: 1 } });
    expect(c.openQuestions).toBe(1);
    await expect(p.owner.ingest.candidate.approve({ candidateId: id, expectSeq: c.serverSeq })).rejects.toThrow(/Answer every question/);
    // A row decision other than skip does not settle it.
    await expect(
      p.owner.ingest.rows.decide({ candidateId: id, rowIds: [rows[0]!.id], decision: "create_new", expectSeq: c.serverSeq }),
    ).rejects.toThrow(/Answer the question above/);
  });

  test("answering 'it is in kg' restages it ready with 3000 g and keeps the entered text; the other row keeps tonnes", async () => {
    const { p, id } = await tonneBundles();
    let c = await p.owner.ingest.candidate.get({ candidateId: id });
    await expect(
      p.owner.ingest.answer.set({ candidateId: id, questionCode: "magnitude_check", subject: "weightG", answer: "mm", expectSeq: c.serverSeq }),
    ).rejects.toThrow(/does not fit this column/);
    c = await p.owner.ingest.answer.set({ candidateId: id, questionCode: "magnitude_check", subject: "weightG", answer: { unit: "kg" }, expectSeq: c.serverSeq });
    await pump(p.owner, id);
    const rows = await rowsOf(p.owner, id);
    expect(rows[0]).toMatchObject({ state: "ready_create", values: { weightG: 3000 }, entered: { weightG: { text: "3", unit: "kg" } } });
    expect(rows[0]!.reasons).toContain("magnitude_unit:weightG");
    expect(rows[1]).toMatchObject({ state: "ready_create", values: { weightG: 1_200_000 } });
    c = await p.owner.ingest.candidate.get({ candidateId: id });
    expect(c.questions.find((q) => q.code === "magnitude_check")).toMatchObject({ open: false, answer: "kg" });
    expect((await p.owner.ingest.candidate.approve({ candidateId: id, expectSeq: c.serverSeq })).state).toBe("approved");
  });

  test("'the value is right' stages it ready as read, and the approval's audit meta carries the note", async () => {
    const { p, id } = await tonneBundles();
    let c = await p.owner.ingest.candidate.get({ candidateId: id });
    c = await p.owner.ingest.answer.set({ candidateId: id, questionCode: "magnitude_check", subject: "weightG", answer: "as_is", expectSeq: c.serverSeq });
    await pump(p.owner, id);
    const [row] = await rowsOf(p.owner, id);
    expect(row).toMatchObject({ state: "ready_create", values: { weightG: 3_000_000 }, entered: { weightG: { text: "3", unit: "t" } } });
    expect(row!.reasons).toContain("magnitude_confirmed:weightG");
    c = await p.owner.ingest.candidate.get({ candidateId: id });
    await p.owner.ingest.candidate.approve({ candidateId: id, expectSeq: c.serverSeq });
    const { auditLog } = await import("@orrn/db/schema/audit");
    const { and, eq } = await import("drizzle-orm");
    const [audit] = await env.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.companyId, p.companyId), eq(auditLog.action, "ingest.candidate.approve")));
    expect((audit!.meta as { magnitude?: unknown }).magnitude).toEqual([
      { field: "weightG", answer: "as_is", note: "The person said the flagged values are right" },
    ]);
  });

  test("skipping the flagged row settles it without an answer", async () => {
    const { p, id } = await tonneBundles();
    let c = await p.owner.ingest.candidate.get({ candidateId: id });
    const [row] = await rowsOf(p.owner, id);
    await p.owner.ingest.rows.decide({ candidateId: id, rowIds: [row!.id], decision: "skip", expectSeq: c.serverSeq });
    await pump(p.owner, id);
    c = await p.owner.ingest.candidate.get({ candidateId: id });
    expect(c.counts).toMatchObject({ create: 1, skipped: 1, ambiguous: 0 });
    expect(c.questions.some((q) => q.code === "magnitude_check")).toBe(false);
    expect((await p.owner.ingest.candidate.approve({ candidateId: id, expectSeq: c.serverSeq })).state).toBe("approved");
  });
});

// ---------------------------------------------------------------------------
// Item 4a: the dateless order match stays in the period's financial year
// ---------------------------------------------------------------------------

describe("A5 note: with no date column, an old order number matches only an open order of the period's year", () => {
  const headers = ["Party", "Old no", "Series", "Section", "Cut (mm)", "Baki (kg)"];
  const dateless = (): Recipe => {
    const r = layout(
      "orders",
      headers,
      [
        { field: "customer", steps: [{ op: "trim" }, { op: "lookup", resolver: "customer_by_name" }] },
        { field: "oldOrderNo", steps: trim },
        { field: "series", steps: [{ op: "trim" }, { op: "case", to: "upper" }] },
        { field: "sectionCode", steps: [{ op: "trim" }, { op: "lookup", resolver: "section_by_code" }] },
        { field: "cutLength", steps: [{ op: "number", kind: "length", unit: "mm" }] },
        { field: "bakiKg", steps: [{ op: "number", kind: "mass", unit: "kg" }] },
      ],
      ["customer", "oldOrderNo", "orderDate"],
    );
    return { ...r, fields: [...r.fields, { field: "orderDate", source: { kind: "period_as_of" }, steps: [] }] };
  };

  async function sheetAgainst(live: { status: string; orderDate: string }) {
    const p = await plant();
    const acme = await p.owner.customer.create({ name: "Acme Traders" });
    const dieId = await env.seedDie(p.companyId, { series: "R", sectionCode: "5300" });
    const { salesOrder, salesOrderLine } = await import("@orrn/db/schema");
    const orderId = `so_${randomUUID()}`;
    await env.db.insert(salesOrder).values({
      id: orderId,
      companyId: p.companyId,
      period: fyOfDate(live.orderDate),
      number: `SO-${randomUUID().slice(0, 6)}`,
      customerId: acme.id,
      orderDate: live.orderDate,
      status: live.status,
      note: "Old order no. OB-1",
    } as never);
    await env.db.insert(salesOrderLine).values({
      id: `sol_${randomUUID()}`,
      companyId: p.companyId,
      salesOrderId: orderId,
      lineNo: 1,
      dieId,
      cutLengthMm: 3658,
      kgG: 300_000,
    } as never);
    await learnLayout(p.companyId, p.users.owner.id, dateless(), "Dateless book");
    const { candidates, artifactId } = await upload(p.owner, [{ headers, rows: [["Acme Traders", "OB-1", "R", "5300", "3658", "300"]] }]);
    await p.owner.ingest.period.confirm({ artifactId, fy: "2025-26", asOf: "2025-11-30" });
    await pump(p.owner, candidates[0]!.id);
    const [row] = await rowsOf(p.owner, candidates[0]!.id);
    return { row: row!, orderId };
  }

  const fyOfDate = (d: string) => {
    const y = Number(d.slice(0, 4));
    const start = Number(d.slice(5, 7)) >= 4 ? y : y - 1;
    return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
  };

  test("an open order of the same year matches: unchanged", async () => {
    const { row, orderId } = await sheetAgainst({ status: "confirmed", orderDate: "2025-06-10" });
    expect(row).toMatchObject({ state: "unchanged", matchId: orderId });
    expect(row.reasons).toContain("order_exists");
  });

  test("a closed order with the same old number is not matched: the line is a new order", async () => {
    const { row } = await sheetAgainst({ status: "closed", orderDate: "2025-06-10" });
    expect(row.state).toBe("ready_create");
    expect(row.matchId).toBeNull();
  });

  test("an open order of the year before with the same old number is not matched: the line is a new order", async () => {
    const { row } = await sheetAgainst({ status: "confirmed", orderDate: "2024-06-10" });
    expect(row.state).toBe("ready_create");
    expect(row.matchId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Item 4b: a Sonnet claim covers the server-side fallback attempt
// ---------------------------------------------------------------------------

describe("A8 note: one Sonnet call with a server-side fallback stays under the day cost cap", () => {
  async function bot() {
    const { runShapeAttempt } = await import("../src/lib/ingest/bot");
    const { DAY_COST_CAP_MICRO, MemoryBotRunStore } = await import("../src/lib/ingest/bot/caps");
    const { FakeShapeClient } = await import("../src/lib/ingest/bot/fake");
    const fx = await import("./ingest-bot-fixture");
    return { runShapeAttempt, DAY_COST_CAP_MICRO, MemoryBotRunStore, FakeShapeClient, ...fx };
  }

  /** Two attempts, each with the full Sonnet output budget: what a fallback can bill for one call. */
  const fallbackUsage = { input: 4_000, output: 16_000, cacheRead: 0, cacheWrite: 0 };

  test("the claim of a Sonnet call is the worst case of Sonnet 5.5 plus its fallback", async () => {
    const b = await bot();
    const seen: number[] = [];
    class Probe extends b.MemoryBotRunStore {
      override async insertRun(row: Parameters<InstanceType<typeof b.MemoryBotRunStore>["insertRun"]>[0]) {
        if (row.outcome === "pending") seen.push(row.costMicroUsd);
        return super.insertRun(row);
      }
    }
    const args = b.baseArgs({ store: new Probe(), noFitBlocks: 2 });
    await b.runShapeAttempt({ ...args, client: new b.FakeShapeClient([b.sonnet(b.recipeAnswer())]) });
    expect(seen).toHaveLength(1);
    // 16,000 output tokens at 10 USD per million is 160,000 micro-USD per attempt; two attempts.
    expect(seen[0]!).toBeGreaterThan(320_000);
  });

  test("with room for one attempt only, the call is capped before it is made and the day stays under 5 USD", async () => {
    const b = await bot();
    const args = b.baseArgs({ noFitBlocks: 2 });
    const at = args.nowMs!();
    await args.store.insertRun({
      companyId: "co1", blockId: "old", candidateId: null, purpose: "shape", model: "claude-sonnet-5-5", attempt: 1, outcome: "recipe",
      inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costMicroUsd: b.DAY_COST_CAP_MICRO - 250_000,
      durationMs: 0, createdBy: null, createdAtMs: at - 1000, errorCodes: null,
    });
    const fake = new b.FakeShapeClient([
      b.sonnet(b.recipeAnswer(), {
        modelUsed: "claude-sonnet-5",
        usage: fallbackUsage,
        iterations: [
          { model: "claude-sonnet-5-5", usage: fallbackUsage },
          { model: "claude-sonnet-5", usage: fallbackUsage },
        ],
      }),
    ]);
    const r = await b.runShapeAttempt({ ...args, client: fake });
    expect(fake.calls).toHaveLength(0);
    expect(r).toMatchObject({ status: "ran", outcome: "capped", capReason: "day_cost" });
    const day = await args.store.dayTotals({ companyId: "co1", sinceMs: 0 });
    expect(day.costMicroUsd).toBeLessThanOrEqual(b.DAY_COST_CAP_MICRO);
  });
});
