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

async function plant(settings?: Record<string, unknown>) {
  const { companyId, users } = await env.seedCompany(settings ? { settings } : undefined);
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
const bundleLayout = (unit: "kg" | "t" | "g") =>
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

/** A bundle sheet in grams: row 1 weighs "20" (20 g, below the plausible 5 kg), row 2 "100000" (100 kg, fine). */
async function gramBundles() {
  const p = await plant();
  await env.seedDie(p.companyId, { series: "R", sectionCode: "5100" });
  await learnLayout(p.companyId, p.users.owner.id, bundleLayout("g"), "Bundles in g");
  const { candidates } = await upload(p.owner, [
    {
      headers: bundleHeaders("g"),
      rows: [
        ["B-1", "R", "5100", "10", "20", "3658"],
        ["B-2", "R", "5100", "10", "100000", "3658"],
      ],
    },
  ]);
  const id = candidates[0]!.id;
  await pump(p.owner, id);
  return { p, id };
}

describe("C19: a number outside its plausible range waits on a person", () => {
  test("bundle weight 20 in grams is not ready: ambiguous with the flag's reason and one magnitude_check question", async () => {
    const { p, id } = await gramBundles();
    const rows = await rowsOf(p.owner, id);
    expect(rows[0]!.state).toBe("ambiguous");
    expect(rows[0]!.reasons).toEqual(["magnitude:weightG", "q:magnitude_check:weightG|g|below"]);
    expect(rows[1]!.state).toBe("ready_create");
    const c = await p.owner.ingest.candidate.get({ candidateId: id });
    const q = c.questions.find((x) => x.code === "magnitude_check");
    expect(q).toMatchObject({ subject: "weightG|g|below", open: true, params: { field: "weightG", unit: "g", side: "below", count: 1 } });
    expect(c.openQuestions).toBe(1);
    await expect(p.owner.ingest.candidate.approve({ candidateId: id, expectSeq: c.serverSeq })).rejects.toThrow(/Answer every question/);
    // A row decision other than skip does not settle it.
    await expect(
      p.owner.ingest.rows.decide({ candidateId: id, rowIds: [rows[0]!.id], decision: "create_new", expectSeq: c.serverSeq }),
    ).rejects.toThrow(/Answer the question above/);
  });

  test("answering 'it is in kg' restages it ready with 20 kg and keeps the entered text; the other row keeps grams", async () => {
    const { p, id } = await gramBundles();
    let c = await p.owner.ingest.candidate.get({ candidateId: id });
    await expect(
      p.owner.ingest.answer.set({ candidateId: id, questionCode: "magnitude_check", subject: "weightG|g|below", answer: "mm", expectSeq: c.serverSeq }),
    ).rejects.toThrow(/does not fit this column/);
    c = await p.owner.ingest.answer.set({ candidateId: id, questionCode: "magnitude_check", subject: "weightG|g|below", answer: { unit: "kg" }, expectSeq: c.serverSeq });
    await pump(p.owner, id);
    const rows = await rowsOf(p.owner, id);
    expect(rows[0]).toMatchObject({ state: "ready_create", values: { weightG: 20_000 }, entered: { weightG: { text: "20", unit: "kg" } } });
    expect(rows[0]!.reasons).toContain("magnitude_unit:weightG");
    expect(rows[1]).toMatchObject({ state: "ready_create", values: { weightG: 100_000 } });
    c = await p.owner.ingest.candidate.get({ candidateId: id });
    expect(c.questions.find((q) => q.code === "magnitude_check")).toMatchObject({ open: false, answer: "kg" });
    expect((await p.owner.ingest.candidate.approve({ candidateId: id, expectSeq: c.serverSeq })).state).toBe("approved");
  });

  test("'the value is right' stages it ready as read, and the approval's audit meta carries the note", async () => {
    const { p, id } = await gramBundles();
    let c = await p.owner.ingest.candidate.get({ candidateId: id });
    c = await p.owner.ingest.answer.set({ candidateId: id, questionCode: "magnitude_check", subject: "weightG|g|below", answer: "as_is", expectSeq: c.serverSeq });
    await pump(p.owner, id);
    const [row] = await rowsOf(p.owner, id);
    expect(row).toMatchObject({ state: "ready_create", values: { weightG: 20 }, entered: { weightG: { text: "20", unit: "g" } } });
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
      { field: "weightG", unit: "g", side: "below", answer: "as_is", note: "The person said the weightG values read in g that looked too small are right" },
    ]);
  });

  test("skipping the flagged row settles it without an answer", async () => {
    const { p, id } = await gramBundles();
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
// Round 2, X-new-1: a magnitude answer covers only the rows the person saw
// ---------------------------------------------------------------------------

describe("X-new-1: a magnitude answer is tied to the unit and side the person saw", () => {
  const openHeaders = ["Bundle id", "Series", "Section", "Pcs", "Wt", "Len (mm)"];
  /** The bundle layout with the weight unit left open (unit_unknown). */
  const openLayout = (): Recipe => {
    const base = layout("bundles", openHeaders, bundleLayout("kg").fields.map((f) => ({ field: f.field, steps: f.steps })), ["legacyId"]);
    return {
      ...base,
      fields: base.fields.map((f) => (f.field === "weightG" ? { ...f, steps: [{ op: "number" as const, kind: "mass" as const, unit: null }] } : f)),
      unclear: [{ field: "weightG", code: "unit_unknown" }],
    };
  };

  async function sheet(recipe: Recipe, headers: string[], weights: string[]) {
    const p = await plant();
    await env.seedDie(p.companyId, { series: "R", sectionCode: "5100" });
    await learnLayout(p.companyId, p.users.owner.id, recipe, "Bundles");
    const { candidates } = await upload(p.owner, [{ headers, rows: weights.map((w, i) => [`B-${i + 1}`, "R", "5100", "10", w, "3658"]) }]);
    const id = candidates[0]!.id;
    await pump(p.owner, id);
    const answer = async (questionCode: "unit_unknown" | "magnitude_check", subject: string, value: string) => {
      const c = await p.owner.ingest.candidate.get({ candidateId: id });
      await p.owner.ingest.answer.set({ candidateId: id, questionCode, subject, answer: value, expectSeq: c.serverSeq });
      await pump(p.owner, id);
    };
    return { p, id, answer };
  }

  test("an answer given before the unit changed does not settle a row the person never saw: it waits on its own question", async () => {
    const { p, id, answer } = await sheet(openLayout(), openHeaders, ["4", "0.1"]);
    await answer("unit_unknown", "weightG", "t");
    let rows = await rowsOf(p.owner, id);
    expect(rows.map((r) => r.state)).toEqual(["ambiguous", "ready_create"]);
    expect(rows[0]!.reasons).toContain("q:magnitude_check:weightG|t|above");
    await answer("magnitude_check", "weightG|t|above", "as_is");
    rows = await rowsOf(p.owner, id);
    expect(rows[0]).toMatchObject({ state: "ready_create", values: { weightG: 4_000_000 } });

    // The column is now read in kg: B-2 is 0.1 kg, far below a bundle. Nobody was asked about it.
    await answer("unit_unknown", "weightG", "kg");
    rows = await rowsOf(p.owner, id);
    for (const r of rows) {
      expect(r.state).toBe("ambiguous");
      expect(r.reasons).toEqual(["magnitude:weightG", "q:magnitude_check:weightG|kg|below"]);
    }
    expect(rows[1]!.values).toMatchObject({ weightG: 100 });
    const c = await p.owner.ingest.candidate.get({ candidateId: id });
    // The answer about tonnes went with the unit change; the new question is open.
    expect(c.questions.filter((q) => q.code === "magnitude_check").map((q) => [q.subject, q.open, q.params.count])).toEqual([["weightG|kg|below", true, 2]]);
    expect(c.openQuestions).toBe(1);
  });

  test("a row read again in the answered unit is checked again: still out of range, it waits", async () => {
    const { p, id, answer } = await sheet(bundleLayout("t"), bundleHeaders("t"), ["3"]);
    await answer("magnitude_check", "weightG|t|above", "kg");
    let [row] = await rowsOf(p.owner, id);
    // 3 kg is below a bundle too.
    expect(row!.state).toBe("ambiguous");
    expect(row!.reasons).toEqual(["magnitude:weightG", "q:magnitude_check:weightG|kg|below", "magnitude_unit:weightG"]);
    await answer("magnitude_check", "weightG|kg|below", "as_is");
    [row] = await rowsOf(p.owner, id);
    expect(row).toMatchObject({ state: "ready_create", values: { weightG: 3_000 }, entered: { weightG: { text: "3", unit: "kg" } } });
    expect(row!.reasons).toEqual(["magnitude_unit:weightG", "magnitude_confirmed:weightG"]);
  });

  test("values too large and too small are two questions: an answer for one side leaves the other side waiting", async () => {
    const { p, id, answer } = await sheet(bundleLayout("t"), bundleHeaders("t"), ["4", "0.004"]);
    let c = await p.owner.ingest.candidate.get({ candidateId: id });
    expect(c.questions.filter((q) => q.code === "magnitude_check").map((q) => [q.subject, q.params.side, q.params.count])).toEqual([
      ["weightG|t|above", "above", 1],
      ["weightG|t|below", "below", 1],
    ]);
    await answer("magnitude_check", "weightG|t|above", "kg");
    const rows = await rowsOf(p.owner, id);
    // 4 t read in kg is 4 kg, below a bundle: B-1 waits again, on the kg question.
    expect(rows[0]!.reasons).toContain("q:magnitude_check:weightG|kg|below");
    // B-2 was too small, not too large: the answer was not about it, so it is not read as 4 g.
    expect(rows[1]).toMatchObject({ state: "ambiguous", values: { weightG: 4_000 } });
    expect(rows[1]!.reasons).toEqual(["magnitude:weightG", "q:magnitude_check:weightG|t|below"]);
    c = await p.owner.ingest.candidate.get({ candidateId: id });
    expect(c.openQuestions).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Round 2, X-new-2: a rate's magnitude check shows no rate to a person who may not see rates
// ---------------------------------------------------------------------------

describe("X-new-2: a rate flag tells nothing about the rate to a role without order.price", () => {
  const headers = [...ORDER_HEADERS, "Rate (paise/kg)"];
  const ratedLayout = (): Recipe => {
    const base = orderLayout();
    return layout(
      "orders",
      headers,
      [...base.fields.map((f) => ({ field: f.field, steps: f.steps })), { field: "rate", steps: [{ op: "number", kind: "price_per_mass", unit: "paise/kg" }] }],
      base.keys,
    );
  };

  async function ratedSheet() {
    const p = await plant();
    await p.owner.customer.create({ name: "Acme Traders" });
    await env.seedDie(p.companyId, { series: "R", sectionCode: "5100" });
    await learnLayout(p.companyId, p.users.owner.id, ratedLayout(), "Rated orders");
    // 250 paise/kg is Rs 2.50 a kg, far below a believable rate: likely Rs 250 a kg.
    const { candidates } = await upload(p.owner, [{ headers, rows: [["Acme Traders", "PO-1", "01/10/2025", "R", "5100", "3658", "", "300", "250"]] }]);
    const id = candidates[0]!.id;
    await pump(p.owner, id);
    return { p, id };
  }

  test("the admin's row read holds no rate value anywhere, and the question offers no unit", async () => {
    const { p, id } = await ratedSheet();
    const [own] = await rowsOf(p.owner, id);
    expect((own!.values as { _magnitude?: unknown })._magnitude).toEqual([{ field: "rate", side: "below", unit: "paise/kg", likelyUnit: "inr/kg", likelyValue: 25_000 }]);
    const [row] = await rowsOf(p.admin, id);
    expect(row!.rate).toBeNull();
    expect(row!.rateHidden).toBe(true);
    expect((row!.values as { _magnitude?: unknown[] })._magnitude ?? []).toEqual([]);
    const text = JSON.stringify(row);
    expect(text).not.toContain("25000");
    expect(text).not.toContain("inr/kg");
    const c = await p.admin.ingest.candidate.get({ candidateId: id });
    const q = c.questions.find((x) => x.code === "magnitude_check");
    expect(q).toMatchObject({ subject: "rate|paise/kg|below", open: true, params: { field: "rate", likelyUnit: "" } });
  });

  test("the admin may not answer the rate's magnitude check; leaving rates out settles the row", async () => {
    const { p, id } = await ratedSheet();
    let c = await p.admin.ingest.candidate.get({ candidateId: id });
    await expect(
      p.admin.ingest.answer.set({ candidateId: id, questionCode: "magnitude_check", subject: "rate|paise/kg|below", answer: "inr/kg", expectSeq: c.serverSeq }),
    ).rejects.toThrow(/Rates are hidden from you/);
    c = await p.admin.ingest.answer.set({ candidateId: id, questionCode: "rates_hidden", subject: "", answer: "leave_out", expectSeq: c.serverSeq });
    await pump(p.admin, id);
    const [row] = await rowsOf(p.admin, id);
    expect(row!.state).toBe("ready_create");
    expect(row!.reasons.some((r) => r.includes("rate"))).toBe(false);
    c = await p.admin.ingest.candidate.get({ candidateId: id });
    expect(c.questions.some((q) => q.code === "magnitude_check")).toBe(false);
    expect(c.openQuestions).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Round 2, X-new-3: four more holds the dry run now finds first
// ---------------------------------------------------------------------------

describe("X-new-3: the dry run refuses what the merge would hold", () => {
  test("(a) an alias of another customer takes skip or keep orrn's only; keep the file's is refused at once and on a re-run", async () => {
    const p = await plant();
    await p.owner.customer.create({ name: "Acme Traders" });
    const bharat = await p.owner.customer.create({ name: "Bharat Metals" });
    await p.owner.customer.addAliases({ rows: [{ customerId: bharat.id, alias: "Acme Trading Co" }] });
    const headers = ["Customer", "Other name"];
    const aliasLayout = layout(
      "customer_aliases",
      headers,
      [
        { field: "customer", steps: [{ op: "trim" }, { op: "lookup", resolver: "customer_by_name" }] },
        { field: "alias", steps: trim },
      ],
      ["alias"],
    );
    await learnLayout(p.companyId, p.users.owner.id, aliasLayout, "Aliases");
    const { candidates } = await upload(p.owner, [{ headers, rows: [["Acme Traders", "Acme Trading Co"]] }]);
    const id = candidates[0]!.id;
    await pump(p.owner, id);
    let [row] = await rowsOf(p.owner, id);
    expect([row!.state, row!.reasons]).toEqual(["conflict", ["alias_taken:alias"]]);
    const c = await p.owner.ingest.candidate.get({ candidateId: id });
    for (const decision of ["keep_file", "create_new"] as const) {
      await expect(p.owner.ingest.rows.decide({ candidateId: id, rowIds: [row!.id], decision, expectSeq: c.serverSeq })).rejects.toThrow(
        "A name that belongs to another customer is not moved by an import. Skip these rows.",
      );
    }
    // A choice stored before this rule (or by another path) does not make the row ready.
    const { ingestCandidate, ingestStagedRow } = await import("@orrn/db/schema/ingest");
    const { eq } = await import("drizzle-orm");
    await env.db.update(ingestStagedRow).set({ decision: "keep_file" }).where(eq(ingestStagedRow.id, row!.id));
    await env.db.update(ingestCandidate).set({ state: "processing", dryCursor: 0 }).where(eq(ingestCandidate.id, id));
    await pump(p.owner, id);
    [row] = await rowsOf(p.owner, id);
    expect([row!.state, row!.reasons]).toEqual(["refused", ["alias_taken:alias"]]);
  });

  test("(b) one PO on two order dates, and an order above 100 lines, are refused at dry run; skipping a line brings the order back", async () => {
    const p = await plant();
    await p.owner.customer.create({ name: "Acme Traders" });
    await env.seedDie(p.companyId, { series: "R", sectionCode: "5100" });
    await learnLayout(p.companyId, p.users.owner.id, orderLayout(), "Orders");
    const line = (po: string, date: string) => ["Acme Traders", po, date, "R", "5100", "3658", "", "300"];
    const rows = [line("PO-9", "01/10/2025"), line("PO-9", "02/10/2025"), line("PO-8", "01/10/2025")];
    for (let i = 0; i < 101; i += 1) rows.push(line("PO-BIG", "03/10/2025"));
    const { candidates } = await upload(p.owner, [{ headers: ORDER_HEADERS, rows }]);
    const id = candidates[0]!.id;
    await pump(p.owner, id);
    const all = async () => {
      const first = await p.owner.ingest.rows.list({ candidateId: id, limit: 100 });
      const rest = await p.owner.ingest.rows.list({ candidateId: id, limit: 100, cursor: first.nextCursor! });
      return [...first.items, ...rest.items];
    };
    let staged = await all();
    expect(staged.slice(0, 3).map((r) => [r.state, r.reasons])).toEqual([
      ["refused", ["po_two_dates:orderDate"]],
      ["refused", ["po_two_dates:orderDate"]],
      ["ready_create", []],
    ]);
    expect(new Set(staged.slice(3).map((r) => `${r.state} ${r.reasons.join(",")}`))).toEqual(new Set(["refused order_lines_over:order"]));
    let c = await p.owner.ingest.candidate.get({ candidateId: id });
    expect(c.counts).toMatchObject({ create: 1, refused: 103 });

    await p.owner.ingest.rows.decide({ candidateId: id, rowIds: [staged.at(-1)!.id], decision: "skip", expectSeq: c.serverSeq });
    await pump(p.owner, id);
    staged = await all();
    expect(staged.at(-1)!.state).toBe("skipped");
    expect(new Set(staged.slice(3, -1).map((r) => `${r.state} ${r.reasons.join(",")}`))).toEqual(new Set(["ready_create "]));
    c = await p.owner.ingest.candidate.get({ candidateId: id });
    expect(c.counts).toMatchObject({ create: 101, refused: 2, skipped: 1 });
  });

  test("(c) a new die copy on an archived section is refused at dry run with the merge's reason", async () => {
    const p = await plant();
    await env.seedDie(p.companyId, { series: "R", sectionCode: "7100" });
    await env.seedDie(p.companyId, { series: "R", sectionCode: "7200", status: "archived" });
    await learnLayout(p.companyId, p.users.owner.id, copyLayout(), "Copies");
    const { candidates } = await upload(p.owner, [
      {
        headers: COPY_HEADERS,
        rows: [
          ["R", "7100", "A-1", "available"],
          ["R", "7200", "A-2", "available"],
          ["R", "7100", "A-3", "at_nitriding"],
        ],
      },
    ]);
    await pump(p.owner, candidates[0]!.id);
    const rows = await rowsOf(p.owner, candidates[0]!.id);
    expect(rows.map((r) => [r.state, r.reasons])).toEqual([
      ["ready_create", []],
      ["refused", ["section_archived:sectionCode"]],
      ["refused", ["status_not_allowed:status"]],
    ]);
  });

  test("(d) with rates on sales orders off, a sheet with rates asks everyone to leave rates out before approve", async () => {
    const p = await plant({ priceOnSalesOrder: false });
    await p.owner.customer.create({ name: "Acme Traders" });
    await env.seedDie(p.companyId, { series: "R", sectionCode: "5100" });
    const headers = [...ORDER_HEADERS, "Rate (Rs/kg)"];
    const base = orderLayout();
    await learnLayout(
      p.companyId,
      p.users.owner.id,
      layout(
        "orders",
        headers,
        [...base.fields.map((f) => ({ field: f.field, steps: f.steps })), { field: "rate", steps: [{ op: "number", kind: "price_per_mass", unit: "inr/kg" }] }],
        base.keys,
      ),
      "Rated orders",
    );
    const { candidates } = await upload(p.owner, [{ headers, rows: [["Acme Traders", "PO-1", "01/10/2025", "R", "5100", "3658", "", "300", "250"]] }]);
    const id = candidates[0]!.id;
    await pump(p.owner, id);
    let c = await p.owner.ingest.candidate.get({ candidateId: id });
    expect(c.questions.find((q) => q.code === "rates_hidden")).toMatchObject({ open: true, params: { reason: "pricing_off" } });
    expect(c.openQuestions).toBe(1);
    await expect(p.owner.ingest.candidate.approve({ candidateId: id, expectSeq: c.serverSeq })).rejects.toThrow(/Answer every question/);
    await expect(
      p.owner.ingest.answer.set({ candidateId: id, questionCode: "rates_hidden", subject: "", answer: "owner_merges", expectSeq: c.serverSeq }),
    ).rejects.toThrow(/Rates on sales orders are off/);
    c = await p.owner.ingest.answer.set({ candidateId: id, questionCode: "rates_hidden", subject: "", answer: "leave_out", expectSeq: c.serverSeq });
    await pump(p.owner, id);
    const [row] = await rowsOf(p.owner, id);
    expect(row!.state).toBe("ready_create");
    expect(row!.rate).toBeNull();
    c = await p.owner.ingest.candidate.get({ candidateId: id });
    expect((await p.owner.ingest.candidate.approve({ candidateId: id, expectSeq: c.serverSeq })).state).toBe("approved");
  });
});

// ---------------------------------------------------------------------------
// Round 2, X-new-4: a die sheet and an order book in one upload merge in one go
// ---------------------------------------------------------------------------

describe("X-new-4: an order book may use a section the die sheet of the same upload adds", () => {
  const DIE_HEADERS = ["Series", "Section", "Min (kg/12ft)", "Max (kg/12ft)"];
  const dieLayout = () =>
    layout(
      "dies",
      DIE_HEADERS,
      [
        { field: "series", steps: [{ op: "trim" }, { op: "case", to: "upper" }] },
        { field: "sectionCode", steps: trim },
        { field: "weightMinG", steps: [{ op: "number", kind: "linear_mass", unit: "kg/12ft" }] },
        { field: "weightMaxG", steps: [{ op: "number", kind: "linear_mass", unit: "kg/12ft" }] },
      ],
      ["series", "sectionCode"],
    );

  async function mergeOnce(as: Caller) {
    const { runId } = await as.ingest.merge.start();
    let cursor = 0;
    for (let i = 0; i < 80; i += 1) {
      const s = await as.ingest.merge.step({ runId, expectCursor: cursor });
      cursor = s.cursor;
      if (s.state !== "planning" && s.state !== "running") return s;
    }
    throw new Error("The merge did not finish");
  }

  async function bothSheets() {
    const p = await plant();
    await p.owner.customer.create({ name: "Acme Traders" });
    await learnLayout(p.companyId, p.users.owner.id, dieLayout(), "Dies");
    await learnLayout(p.companyId, p.users.owner.id, orderLayout(), "Orders");
    const { candidates } = await upload(p.owner, [
      { name: "Dies", headers: DIE_HEADERS, rows: [["R", "9100", "2.0", "2.4"]] },
      {
        name: "Order book",
        headers: ORDER_HEADERS,
        rows: [
          ["Acme Traders", "PO-1", "01/10/2025", "R", "9100", "3658", "", "300"],
          ["Acme Traders", "PO-1", "01/10/2025", "R", "9100", "4877", "", "200"],
        ],
      },
    ]);
    const [dies, orders] = candidates;
    await pump(p.owner, dies!.id);
    await pump(p.owner, orders!.id);
    return { p, dies: dies!.id, orders: orders!.id };
  }

  async function salesOrders(companyId: string) {
    const row = await env.d1.prepare("select count(*) as n from sales_order_line where company_id = ?").bind(companyId).first<{ n: number }>();
    return Number(row?.n ?? 0);
  }

  test("the order lines are ready at dry run; approve both, one merge writes the die and then the order", async () => {
    const { p, dies, orders } = await bothSheets();
    const rows = await rowsOf(p.owner, orders);
    expect(rows.map((r) => [r.state, r.reasons])).toEqual([
      ["ready_create", ["section_pending:sectionCode"]],
      ["ready_create", ["section_pending:sectionCode"]],
    ]);
    for (const id of [dies, orders]) {
      const c = await p.owner.ingest.candidate.get({ candidateId: id });
      expect((await p.owner.ingest.candidate.approve({ candidateId: id, expectSeq: c.serverSeq })).state).toBe("approved");
    }
    expect((await mergeOnce(p.owner)).state).toBe("done");
    const c = await p.owner.ingest.candidate.get({ candidateId: orders });
    expect(c).toMatchObject({ state: "merged", counts: { written: 2 } });
    expect(await salesOrders(p.companyId)).toBe(2);
  });

  test("an order book merged without its die sheet is held, not merged with its lines lost", async () => {
    const { p, dies, orders } = await bothSheets();
    let c = await p.owner.ingest.candidate.get({ candidateId: orders });
    await p.owner.ingest.candidate.approve({ candidateId: orders, expectSeq: c.serverSeq });
    expect((await mergeOnce(p.owner)).state).toBe("done_with_holds");
    c = await p.owner.ingest.candidate.get({ candidateId: orders });
    expect(c).toMatchObject({ state: "held", reasonCode: "dependency_held", counts: { written: 0 } });
    expect(await salesOrders(p.companyId)).toBe(0);
    // The die sheet merges; the order book is checked again and merges.
    const d = await p.owner.ingest.candidate.get({ candidateId: dies });
    await p.owner.ingest.candidate.approve({ candidateId: dies, expectSeq: d.serverSeq });
    expect((await mergeOnce(p.owner)).state).toBe("done");
    c = await p.owner.ingest.candidate.release({ candidateId: orders, expectSeq: c.serverSeq });
    await pump(p.owner, orders);
    c = await p.owner.ingest.candidate.get({ candidateId: orders });
    await p.owner.ingest.candidate.approve({ candidateId: orders, expectSeq: c.serverSeq });
    expect((await mergeOnce(p.owner)).state).toBe("done");
    expect(await salesOrders(p.companyId)).toBe(2);
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

// ---------------------------------------------------------------------------
// Item 3 (B-new-3): a held candidate comes back through the API
// ---------------------------------------------------------------------------

describe("B-new-3: after a failed chunk, the person fixes the cause and approves again through the API", () => {
  async function merge(as: Caller) {
    const { runId } = await as.ingest.merge.start();
    let cursor = 0;
    for (let i = 0; i < 50; i += 1) {
      const s = await as.ingest.merge.step({ runId, expectCursor: cursor });
      cursor = s.cursor;
      if (s.state !== "planning" && s.state !== "running") return s;
    }
    throw new Error("The merge did not finish");
  }

  /**
   * Three die copies; the middle one's section is archived after the dry run (the dry run refuses an
   * archived section itself, X-new-3), so its chunk fails after the first copy is written.
   */
  async function heldCopies() {
    const p = await plant();
    await env.seedDie(p.companyId, { series: "R", sectionCode: "7100" });
    const archived = await env.seedDie(p.companyId, { series: "R", sectionCode: "7200" });
    await learnLayout(p.companyId, p.users.owner.id, copyLayout(), "Copies");
    const { candidates } = await upload(p.owner, [
      {
        headers: COPY_HEADERS,
        rows: [
          ["R", "7100", "A-1", "available"],
          ["R", "7200", "A-2", "available"],
          ["R", "7100", "A-3", "available"],
        ],
      },
    ]);
    const id = candidates[0]!.id;
    await pump(p.owner, id);
    let c = await p.owner.ingest.candidate.get({ candidateId: id });
    await p.owner.ingest.candidate.approve({ candidateId: id, expectSeq: c.serverSeq });
    const { die } = await import("@orrn/db/schema/catalog");
    const { eq } = await import("drizzle-orm");
    await env.db.update(die).set({ status: "archived" }).where(eq(die.id, archived));
    expect((await merge(p.owner)).state).toBe("done_with_holds");
    c = await p.owner.ingest.candidate.get({ candidateId: id });
    expect(c).toMatchObject({ state: "held", reasonDetail: "This section is archived; no new die copies", counts: { written: 1 } });
    const first = (await rowsOf(p.owner, id))[0]!;
    expect(first.mergeState).toBe("written");
    return { p, id, archived, first };
  }

  async function copies(companyId: string) {
    const row = await env.d1.prepare("select count(*) as n from die_instance where company_id = ?").bind(companyId).first<{ n: number }>();
    return Number(row?.n ?? 0);
  }

  test("the section is fixed outside: check again, approve, merge; the written row is left alone", async () => {
    const { p, id, archived, first } = await heldCopies();
    const { die } = await import("@orrn/db/schema/catalog");
    const { eq } = await import("drizzle-orm");
    await env.db.update(die).set({ status: "active" }).where(eq(die.id, archived));
    let c = await p.owner.ingest.candidate.get({ candidateId: id });
    c = await p.owner.ingest.candidate.release({ candidateId: id, expectSeq: c.serverSeq });
    expect((await pump(p.owner, id)).state).toBe("ready");
    c = await p.owner.ingest.candidate.get({ candidateId: id });
    expect((await p.owner.ingest.candidate.approve({ candidateId: id, expectSeq: c.serverSeq })).state).toBe("approved");
    expect((await merge(p.owner)).state).toBe("done");
    c = await p.owner.ingest.candidate.get({ candidateId: id });
    expect(c).toMatchObject({ state: "merged", counts: { written: 3 } });
    const after = (await rowsOf(p.owner, id))[0]!;
    expect([after.mergeState, after.committedId]).toEqual(["written", first.committedId]);
    expect(await copies(p.companyId)).toBe(3);
  });

  test("the person skips the failing row: the candidate is ready again, approves and merges the rest", async () => {
    const { p, id } = await heldCopies();
    let c = await p.owner.ingest.candidate.get({ candidateId: id });
    const bad = (await rowsOf(p.owner, id))[1]!;
    await p.owner.ingest.rows.decide({ candidateId: id, rowIds: [bad.id], decision: "skip", expectSeq: c.serverSeq });
    expect((await pump(p.owner, id)).state).toBe("ready");
    c = await p.owner.ingest.candidate.get({ candidateId: id });
    await p.owner.ingest.candidate.approve({ candidateId: id, expectSeq: c.serverSeq });
    expect((await merge(p.owner)).state).toBe("done");
    c = await p.owner.ingest.candidate.get({ candidateId: id });
    expect(c).toMatchObject({ state: "merged", counts: { written: 2, skipped: 1 } });
    expect(await copies(p.companyId)).toBe(2);
  });

  test("approving again saves no second copy of the answered layout", async () => {
    const p = await plant();
    await env.seedDie(p.companyId, { series: "R", sectionCode: "5100" });
    const open = bundleLayout("kg");
    const recipe: Recipe = {
      ...open,
      fields: open.fields.map((f) => (f.field === "weightG" ? { ...f, steps: [{ op: "number" as const, kind: "mass" as const, unit: null }] } : f)),
      unclear: [{ field: "weightG", code: "unit_unknown" }],
    };
    await learnLayout(p.companyId, p.users.owner.id, recipe, "Bundles");
    const { candidates } = await upload(p.owner, [{ headers: bundleHeaders("kg"), rows: [["B-1", "R", "5100", "10", "90", "3658"]] }]);
    const id = candidates[0]!.id;
    await pump(p.owner, id);
    let c = await p.owner.ingest.candidate.get({ candidateId: id });
    c = await p.owner.ingest.answer.set({ candidateId: id, questionCode: "unit_unknown", subject: "weightG", answer: "kg", expectSeq: c.serverSeq });
    await pump(p.owner, id);
    c = await p.owner.ingest.candidate.get({ candidateId: id });
    c = await p.owner.ingest.candidate.approve({ candidateId: id, expectSeq: c.serverSeq });
    const versions = async () => {
      const row = await env.d1.prepare("select count(*) as n from ingest_hole_version where company_id = ?").bind(p.companyId).first<{ n: number }>();
      return Number(row?.n ?? 0);
    };
    const saved = await versions();
    expect(saved).toBe(2);
    c = await p.owner.ingest.candidate.hold({ candidateId: id, expectSeq: c.serverSeq });
    c = await p.owner.ingest.candidate.approve({ candidateId: id, expectSeq: c.serverSeq });
    expect(c.state).toBe("approved");
    expect(await versions()).toBe(saved);
  });
});
