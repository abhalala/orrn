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
