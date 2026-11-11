/**
 * Helpers for the portal round 3 tests: a plant, an upload through the real procedures, a dry run
 * pumped to the end, a learned layout, approve and one merge. Real D1 through the `ingest` router.
 */
import { createHash, randomUUID } from "node:crypto";

import { fingerprint, type Recipe } from "@orrn/ingest";

import type { CompanyRole, TestEnv } from "./harness";

export type Caller = ReturnType<TestEnv["caller"]>;
export type Sheet = { headers: string[]; rows: string[][]; name?: string };

const sha = () => createHash("sha256").update(randomUUID()).digest("hex");

export type Plant = {
  companyId: string;
  users: Awaited<ReturnType<TestEnv["seedCompany"]>>["users"];
  as: (role: CompanyRole) => Caller;
  owner: Caller;
  admin: Caller;
};

export async function plant(env: TestEnv, settings?: Record<string, unknown>): Promise<Plant> {
  const { companyId, users } = await env.seedCompany(settings ? { settings } : undefined);
  const as = (role: CompanyRole) => env.caller({ role, companyId });
  return { companyId, users, as, owner: as("owner"), admin: as("admin") };
}

export async function upload(as: Caller, sheets: Sheet[], fileName = "book.xlsx") {
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

export async function pump(as: Caller, candidateId: string) {
  let cursor = (await as.ingest.candidate.get({ candidateId })).dryCursor;
  for (let i = 0; i < 50; i += 1) {
    const out = await as.ingest.dryRun.step({ candidateId, expectCursor: cursor });
    if (out.done) return out;
    cursor = out.cursor;
  }
  throw new Error("dry run did not finish");
}

export async function learnLayout(env: TestEnv, companyId: string, createdBy: string, recipe: Recipe, name = "Learned") {
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

/** A layout over `headers`, each field read from the column of the same place. */
export function layout(target: Recipe["target"], headers: string[], fields: { field: string; steps: Recipe["fields"][number]["steps"] }[], keys: string[]): Recipe {
  const fp = fingerprint({ headers, rows: [] });
  return {
    schemaVersion: 1,
    target,
    headerRow: 0,
    headerRows: 1,
    match: { headerKey: fp.headerKey, headers: fp.normalized },
    fields: fields.map((f, i) => ({ field: f.field, source: { kind: "columns" as const, cols: [{ col: i, header: headers[i]! }] }, steps: f.steps })),
    filters: [],
    keys,
    onExisting: "ask",
    unclear: [],
  } as Recipe;
}

export async function rowsOf(as: Caller, candidateId: string) {
  return (await as.ingest.rows.list({ candidateId, limit: 100 })).items.sort((a, b) => a.rowIndex - b.rowIndex);
}

export async function approve(as: Caller, candidateId: string) {
  const c = await as.ingest.candidate.get({ candidateId });
  return as.ingest.candidate.approve({ candidateId, expectSeq: c.serverSeq });
}

export async function mergeOnce(as: Caller) {
  const { runId } = await as.ingest.merge.start();
  let cursor = 0;
  for (let i = 0; i < 80; i += 1) {
    const s = await as.ingest.merge.step({ runId, expectCursor: cursor });
    cursor = s.cursor;
    if (s.state !== "planning" && s.state !== "running") return s;
  }
  throw new Error("The merge did not finish");
}

export async function countOf(env: TestEnv, table: string, companyId: string) {
  const row = await env.d1.prepare(`select count(*) as n from ${table} where company_id = ?`).bind(companyId).first<{ n: number }>();
  return Number(row?.n ?? 0);
}

export const trim = [{ op: "trim" as const }];

export const ORDER_HEADERS = ["Party", "PO", "Date", "Series", "Section", "Cut (mm)", "Pcs", "Baki (kg)"];
export const ORDER_FIELDS: { field: string; steps: Recipe["fields"][number]["steps"] }[] = [
  { field: "customer", steps: [{ op: "trim" }, { op: "lookup", resolver: "customer_by_name" }] },
  { field: "poNumber", steps: trim },
  { field: "orderDate", steps: [{ op: "date", format: "dmy" }] },
  { field: "series", steps: [{ op: "trim" }, { op: "case", to: "upper" }] },
  { field: "sectionCode", steps: [{ op: "trim" }, { op: "lookup", resolver: "section_by_code" }] },
  { field: "cutLength", steps: [{ op: "number", kind: "length", unit: "mm" }] },
  { field: "pcs", steps: [{ op: "number", kind: "count", unit: "pcs" }] },
  { field: "bakiKg", steps: [{ op: "number", kind: "mass", unit: "kg" }] },
];
export const orderLayout = () => layout("orders", ORDER_HEADERS, ORDER_FIELDS, ["customer", "poNumber", "orderDate"]);

export const DIE_HEADERS = ["Series", "Section", "Min (kg/12ft)", "Max (kg/12ft)"];
export const dieLayout = () =>
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
