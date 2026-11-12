/**
 * Helpers for the portal round 3 tests: a plant, an upload through the real procedures, a dry run
 * pumped to the end, a learned layout, approve and one merge. Real D1 through the `ingest` router.
 */
import { createHash, randomUUID } from "node:crypto";

import { fingerprint, type Recipe } from "@orrn/ingest";

import type { CompanyRole, TestEnv } from "./harness";

export type Caller = ReturnType<TestEnv["caller"]>;
export type Sheet = { headers: string[]; rows: string[][]; name?: string; merged?: { col: number; firstRow: number; lastRow: number }[] };

export const sha = () => createHash("sha256").update(randomUUID()).digest("hex");

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

type BlockIn = Parameters<Caller["ingest"]["artifact"]["putBlocks"]>[0]["blocks"][number];
type LooseBlock = Omit<BlockIn, "preview"> & { preview?: BlockIn["preview"]; headers?: string[] };
/** The header each block was settled with, so `putRowsAs` sends the rows as read under it. */
const settledHeader = new Map<string, { headerRow: number; headerRows: 1 | 2 }>();

/** A preview as a reader gives it: the names on the header row, then the first sample rows (rule 7.2). */
export function previewOf(b: { headerRow: number; headerRows: number; headers?: string[]; sample: string[][] }): BlockIn["preview"] {
  const cut = (r: readonly string[]) => r.slice(0, 200).map((c) => c.slice(0, 200));
  const head = [{ row: b.headerRow, cells: cut(b.headers ?? []) }];
  if (b.headerRows === 2) head.push({ row: b.headerRow + 1, cells: [] });
  const from = b.headerRow + b.headerRows;
  return [...head, ...b.sample.slice(0, 15 - head.length).map((r, i) => ({ row: from + i, cells: cut(r) }))];
}

/**
 * putBlocks as the web sends it (rule 7.2): every table with its preview; a table the server asks
 * about, or tells to read again, is sent again with the person's pick of the guessed row.
 */
export async function putBlocksPicked(as: Caller, input: { artifactId: string; blocks: LooseBlock[] }) {
  const blocks = input.blocks.map((b) => ({ ...b, preview: b.preview ?? previewOf(b) })) as BlockIn[];
  let out = await as.ingest.artifact.putBlocks({ artifactId: input.artifactId, blocks });
  const open = out.header.filter((h) => h.answer !== "keep").map((h) => h.ordinal);
  if (open.length) {
    const picked = blocks.map((b) => (open.includes(b.ordinal) ? { ...b, hint: { headerRow: b.headerRow, headerRows: (b.headerRows === 2 ? 2 : 1) as 1 | 2 } } : b));
    out = await as.ingest.artifact.putBlocks({ artifactId: input.artifactId, blocks: picked });
  }
  for (const b of out.blocks) {
    const sent = blocks.find((x) => x.ordinal === b.ordinal)!;
    settledHeader.set(b.blockId, { headerRow: sent.headerRow, headerRows: sent.headerRows === 2 ? 2 : 1 });
  }
  return out;
}

type RowsIn = Parameters<Caller["ingest"]["artifact"]["putRows"]>[0];
/** putRows with the header the block was settled with (rule 7.2). */
export async function putRowsAs(as: Caller, input: Omit<RowsIn, "headerRow" | "headerRows"> & Partial<Pick<RowsIn, "headerRow" | "headerRows">>) {
  const h = settledHeader.get(input.blockId) ?? { headerRow: 0, headerRows: 1 as const };
  return as.ingest.artifact.putRows({ headerRow: h.headerRow, headerRows: h.headerRows, ...input });
}

export async function upload(as: Caller, sheets: Sheet[], fileName = "book.xlsx", sha256 = sha()) {
  const begin = await as.ingest.artifact.begin({ sha256, fileName, sizeBytes: 1000, contentType: null, kind: "sheet" });
  const put = await putBlocksPicked(as, {
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
      ...(s.merged ? { merged: s.merged } : {}),
    })),
  });
  for (const [i, s] of sheets.entries()) {
    const block = put.blocks.find((b) => b.ordinal === i)!;
    if (s.rows.length > 0) await putRowsAs(as, { blockId: block.blockId, fromIndex: 0, expectRowsPut: 0, rows: s.rows });
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
