import { and, desc, eq, getTableName, is, sql } from "drizzle-orm";
import { getTableConfig, SQLiteTable } from "drizzle-orm/sqlite-core";

import * as schema from "@orrn/db/schema";
import { backupRun, type BackupRunRow } from "@orrn/db/schema/platform";
import { company } from "@orrn/db/schema/tenant";
import { env } from "@orrn/env/server";

import type { Context } from "../context";
import { atomicBatch, chunk, rowsPerStatement, type OrrnDb } from "./atomic";
import { auditInsert } from "./audit";
import { DEFAULT_TIMEZONE, zonedYmd } from "./dayWindow";
import { createId } from "./id";

/**
 * Backups and the restore drill (FP-PF-12; platform spec §3 backup_run, §4 Backups, §6 Backup).
 *
 *   export: Running -> Ok (R2 object + counts) | Failed (note set; the previous Ok object stays)
 *   drill:  Ok export -> DrillRunning -> DrillOk (scratch counts match) | DrillFailed (mismatch or
 *           restore error, the table named in `error`)
 *
 * An export is every row of the company (settings, masters, documents, ledger, audit) WITHOUT
 * secrets: no session, account, verification, two-factor or invite rows (token hashes), no spool
 * deployment (wrapped tunnel/shared secrets), no `*_wrapped` / token / secret / password column.
 * The plant cannot download or restore its own backup; only platform staff run a drill, into a new
 * suspended company `restore-drill-{date}`, never the live one. Runbook: docs/RESTORE_DRILL.md.
 */

/** The subset of an R2 bucket the backup code uses (a fake implements it in tests). */
export type BackupBucket = {
  put(key: string, value: string, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  get(key: string): Promise<{ text(): Promise<string> } | null>;
};

export function backupBucket(): BackupBucket | null {
  return ((env as unknown as { BACKUPS?: BackupBucket }).BACKUPS ?? null) as BackupBucket | null;
}

/** Tables never exported: sessions, credentials, tokens, wrapped keys, and backup metadata itself. */
export const EXCLUDED_TABLES: ReadonlySet<string> = new Set([
  "session",
  "account",
  "verification",
  "two_factor",
  "invite",
  "spool_deployment",
  "backup_run",
]);

/** Columns never exported (e.g. company.spool_api_key_wrapped, device.push_token). */
export function isSecretColumn(name: string): boolean {
  return /(_wrapped$|_hash$|token|secret|password)/.test(name);
}

/** Restored by an export but not by a drill: a drill must not give real users a second plant. */
const DRILL_SKIP_TABLES: ReadonlySet<string> = new Set(["membership", "impersonation_grant"]);

/** The counts a drill compares (acceptance N11). */
export const DRILL_COUNT_TABLES = ["customer", "die", "bundle", "dispatch"] as const;

export const BACKUP_FORMAT = "orrn-company-backup";

export type BackupTable = { columns: string[]; rows: unknown[][] };
export type BackupPayload = {
  format: typeof BACKUP_FORMAT;
  version: 1;
  companyId: string;
  exportedAt: string;
  company: Record<string, unknown>;
  tables: Record<string, BackupTable>;
};

type TableInfo = { name: string; columns: string[]; refs: string[] };

let tableCache: TableInfo[] | null = null;

/**
 * Every company-scoped table in the schema, parents before children (foreign keys), with its
 * exportable columns. Derived from the Drizzle schema so a table added later is backed up without
 * a list to maintain.
 */
export function companyTables(): TableInfo[] {
  if (tableCache) return tableCache;
  const infos = new Map<string, TableInfo>();
  for (const value of Object.values(schema)) {
    if (!is(value, SQLiteTable)) continue;
    const config = getTableConfig(value);
    if (config.name === "company" || EXCLUDED_TABLES.has(config.name)) continue;
    const columns = config.columns.map((c) => c.name);
    if (!columns.includes("company_id")) continue;
    const refs = config.foreignKeys
      .map((fk) => getTableName(fk.reference().foreignTable))
      .filter((t) => t !== config.name);
    infos.set(config.name, { name: config.name, columns: columns.filter((c) => !isSecretColumn(c)), refs });
  }
  // Depth-first topological order; a cycle (none today) falls back to discovery order.
  const ordered: TableInfo[] = [];
  const state = new Map<string, "visiting" | "done">();
  const visit = (name: string) => {
    const info = infos.get(name);
    if (!info || state.get(name) === "done" || state.get(name) === "visiting") return;
    state.set(name, "visiting");
    for (const ref of info.refs) visit(ref);
    state.set(name, "done");
    ordered.push(info);
  };
  for (const name of [...infos.keys()].sort()) visit(name);
  tableCache = ordered;
  return ordered;
}

function stripSecrets(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).filter(([k]) => !isSecretColumn(k)));
}

/** Read one company's rows (raw column values, so a restore writes back exactly what was read). */
export async function exportCompanyPayload(db: OrrnDb, companyId: string, at: Date): Promise<BackupPayload> {
  const [companyRow] = await db.all<Record<string, unknown>>(sql`select * from ${company} where ${company.id} = ${companyId}`);
  if (!companyRow) throw new Error("Company not found");
  const tables: Record<string, BackupTable> = {};
  for (const t of companyTables()) {
    const cols = sql.join(
      t.columns.map((c) => sql.identifier(c)),
      sql`, `,
    );
    const rows = await db.all<Record<string, unknown>>(
      sql`select ${cols} from ${sql.identifier(t.name)} where ${sql.identifier("company_id")} = ${companyId}`,
    );
    tables[t.name] = { columns: t.columns, rows: rows.map((r) => t.columns.map((c) => r[c] ?? null)) };
  }
  return {
    format: BACKUP_FORMAT,
    version: 1,
    companyId,
    exportedAt: at.toISOString(),
    company: stripSecrets(companyRow),
    tables,
  };
}

export function payloadCounts(payload: BackupPayload): Record<string, number> {
  return Object.fromEntries(Object.entries(payload.tables).map(([name, t]) => [name, t.rows.length]));
}

function dateKey(at: Date): string {
  const { year, month, day } = zonedYmd(DEFAULT_TIMEZONE, at.getTime());
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** A failure note without secrets or stack traces: the message, trimmed. */
function failureNote(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, " ").slice(0, 300) || "Unknown error";
}

type Actor = { db: OrrnDb; session: Context["session"]; impersonation?: Context["impersonation"] };

async function finish(db: OrrnDb, id: string): Promise<BackupRunRow> {
  const row = await db.select().from(backupRun).where(eq(backupRun.id, id)).get();
  return row!;
}

/**
 * Export one company to R2. Writes a `running` row first, then `succeeded` (bytes, rows, key,
 * per-table counts) or `failed` (note). A failed run never touches an earlier object.
 */
export async function runExport(
  actor: Actor,
  opts: { companyId: string; kind: "scheduled" | "manual"; at: Date; bucket?: BackupBucket | null },
): Promise<BackupRunRow> {
  const { db } = actor;
  const id = createId(opts.at.getTime());
  const startedBy = actor.session?.user.id ?? null;
  await db.insert(backupRun).values({
    id,
    companyId: opts.companyId,
    kind: opts.kind,
    purpose: "export",
    status: "running",
    startedAt: opts.at,
    startedBy,
  });
  const bucket = opts.bucket === undefined ? backupBucket() : opts.bucket;
  try {
    if (!bucket) throw new Error("No backup bucket is bound (BACKUPS)");
    const payload = await exportCompanyPayload(db, opts.companyId, opts.at);
    const body = JSON.stringify(payload);
    const key = `backups/${opts.companyId}/${dateKey(opts.at)}/${id}.json`;
    await bucket.put(key, body, { httpMetadata: { contentType: "application/json" } });
    const counts = payloadCounts(payload);
    const rowCount = Object.values(counts).reduce((a, b) => a + b, 0) + 1;
    await atomicBatch(db, [
      db
        .update(backupRun)
        .set({
          status: "succeeded",
          r2Key: key,
          bytes: new TextEncoder().encode(body).byteLength,
          rowCount,
          detail: { counts },
          finishedAt: new Date(),
        })
        .where(eq(backupRun.id, id)),
      auditInsert(
        { ...actor, companyId: opts.companyId },
        { action: "backup.export", subjectType: "backup_run", subjectId: id, meta: { companyId: opts.companyId, kind: opts.kind, rowCount } },
      ),
    ]);
  } catch (error) {
    await db
      .update(backupRun)
      .set({ status: "failed", error: failureNote(error), finishedAt: new Date() })
      .where(eq(backupRun.id, id));
  }
  return finish(db, id);
}

/** The newest successful export of a company, or null. */
export async function latestExport(db: OrrnDb, companyId: string): Promise<BackupRunRow | null> {
  const row = await db
    .select()
    .from(backupRun)
    .where(and(eq(backupRun.companyId, companyId), eq(backupRun.purpose, "export"), eq(backupRun.status, "succeeded")))
    .orderBy(desc(backupRun.startedAt), desc(backupRun.id))
    .limit(1)
    .get();
  return row ?? null;
}

/** Scratch company name for a drill on `at` (`restore-drill-2026-10-24`). */
export function drillCompanyName(at: Date): string {
  return `restore-drill-${dateKey(at)}`;
}

/**
 * Restore the export `source` into a new suspended scratch company and compare the counts of
 * customer, die, bundle and dispatch. Every primary key is re-issued (the live rows keep theirs)
 * and every value that named an exported id is pointed at the new one.
 */
export async function runDrill(
  actor: Actor,
  opts: { companyId: string; at: Date; sourceRunId?: string; bucket?: BackupBucket | null },
): Promise<BackupRunRow> {
  const { db } = actor;
  const source = opts.sourceRunId
    ? ((await db
        .select()
        .from(backupRun)
        .where(
          and(
            eq(backupRun.id, opts.sourceRunId),
            eq(backupRun.companyId, opts.companyId),
            eq(backupRun.purpose, "export"),
            eq(backupRun.status, "succeeded"),
          ),
        )
        .get()) ?? null)
    : await latestExport(db, opts.companyId);

  const id = createId(opts.at.getTime());
  await db.insert(backupRun).values({
    id,
    companyId: opts.companyId,
    kind: "manual",
    purpose: "drill",
    status: "running",
    sourceRunId: source?.id ?? null,
    startedAt: opts.at,
    startedBy: actor.session?.user.id ?? null,
  });

  let scratchId: string | null = null;
  let stage = "read";
  try {
    if (!source?.r2Key) throw new Error("No successful export to restore");
    const bucket = opts.bucket === undefined ? backupBucket() : opts.bucket;
    if (!bucket) throw new Error("No backup bucket is bound (BACKUPS)");
    const object = await bucket.get(source.r2Key);
    if (!object) throw new Error("The export object is missing from the bucket");
    const payload = JSON.parse(await object.text()) as BackupPayload;
    if (payload.format !== BACKUP_FORMAT || payload.companyId !== opts.companyId) {
      throw new Error("The export object is not this company's backup");
    }

    // The scratch company: suspended, never the live one, named for the drill day.
    stage = "company";
    scratchId = createId();
    const name = drillCompanyName(opts.at);
    await db.insert(company).values({
      id: scratchId,
      name,
      slug: `${name}-${scratchId.slice(-6).toLowerCase()}`,
      status: "suspended",
      plan: typeof payload.company.plan === "string" ? payload.company.plan : "starter",
      modules: parseJsonArray(payload.company.modules),
      settings: parseJsonObject(payload.company.settings),
    });
    await db.update(backupRun).set({ scratchCompanyId: scratchId }).where(eq(backupRun.id, id));

    // Old id -> new id for every exported row, and the company id -> the scratch id.
    const idMap = new Map<string, string>([[opts.companyId, scratchId]]);
    for (const table of Object.values(payload.tables)) {
      const idIdx = table.columns.indexOf("id");
      if (idIdx < 0) continue;
      for (const row of table.rows) {
        const old = row[idIdx];
        if (typeof old === "string" && !idMap.has(old)) idMap.set(old, createId());
      }
    }
    const remap = (v: unknown) => (typeof v === "string" && idMap.has(v) ? idMap.get(v)! : v);

    // Raw D1 statements: Drizzle cannot batch raw inserts, and the column list is the export's.
    const d1 = (env as unknown as { DB: D1Database }).DB;
    const quote = (id: string) => `"${id.replace(/"/g, '""')}"`;
    const order = companyTables().map((t) => t.name);
    for (const name of order) {
      const table = payload.tables[name];
      if (!table || table.rows.length === 0 || DRILL_SKIP_TABLES.has(name)) continue;
      stage = name;
      const head = `insert into ${quote(name)} (${table.columns.map(quote).join(", ")}) values `;
      const tuple = `(${table.columns.map(() => "?").join(", ")})`;
      const statements = chunk(table.rows, rowsPerStatement(table.columns.length)).map((rows) =>
        d1.prepare(head + rows.map(() => tuple).join(", ")).bind(...rows.flatMap((r) => r.map((v) => remap(v) ?? null))),
      );
      // Rows of one table that cite each other (supersedes, parent ids) may arrive out of order:
      // foreign keys are checked at the end of each batch.
      for (const part of chunk(statements, 200)) {
        await d1.batch([d1.prepare("PRAGMA defer_foreign_keys = on"), ...part]);
      }
    }

    stage = "compare";
    const expected: Record<string, number> = {};
    const restored: Record<string, number> = {};
    const mismatched: string[] = [];
    // Expected = what the export counted when it ran (backup_run.detail), so an object that lost
    // rows in storage fails the drill; the payload's own length only when the run kept no counts.
    const exportCounts = ((source.detail ?? {}) as { counts?: Record<string, number> }).counts ?? {};
    for (const name of DRILL_COUNT_TABLES) {
      expected[name] = exportCounts[name] ?? payload.tables[name]?.rows.length ?? 0;
      const [row] = await db.all<{ n: number }>(
        sql`select count(*) as n from ${sql.identifier(name)} where ${sql.identifier("company_id")} = ${scratchId}`,
      );
      restored[name] = Number(row?.n ?? 0);
      if (restored[name] !== expected[name]) mismatched.push(name);
    }
    const ok = mismatched.length === 0;
    await atomicBatch(db, [
      db
        .update(backupRun)
        .set({
          status: ok ? "succeeded" : "failed",
          error: ok ? null : `Counts differ: ${mismatched.join(", ")}`,
          detail: { expected, restored, scratchCompanyId: scratchId, sourceRunId: source.id },
          finishedAt: new Date(),
        })
        .where(eq(backupRun.id, id)),
      auditInsert(
        { ...actor, companyId: opts.companyId },
        {
          action: "backup.drill",
          subjectType: "backup_run",
          subjectId: id,
          meta: { companyId: opts.companyId, scratchCompanyId: scratchId, sourceRunId: source.id, ok, expected, restored },
        },
      ),
    ]);
  } catch (error) {
    await db
      .update(backupRun)
      .set({
        status: "failed",
        error: `${stage === "read" || stage === "company" || stage === "compare" ? "" : `Restore of ${stage} failed: `}${failureNote(error)}`.slice(0, 400),
        finishedAt: new Date(),
      })
      .where(eq(backupRun.id, id));
  }
  return finish(db, id);
}

function parseJsonArray(v: unknown): string[] {
  try {
    const parsed = typeof v === "string" ? JSON.parse(v) : v;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function parseJsonObject(v: unknown): Record<string, unknown> {
  try {
    const parsed = typeof v === "string" ? JSON.parse(v) : v;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * The daily job (worker `scheduled`): one export per active company per IST day. A company that
 * already has a successful export for the day is skipped, so a retried cron does not double up.
 */
export async function runScheduledBackups(db: OrrnDb, at: Date, bucket?: BackupBucket | null) {
  const companies = await db.select({ id: company.id }).from(company).where(eq(company.status, "active"));
  const day = dateKey(at);
  const results: { companyId: string; status: string }[] = [];
  for (const { id } of companies) {
    const last = await latestExport(db, id);
    if (last && dateKey(last.startedAt) === day) {
      results.push({ companyId: id, status: "skipped" });
      continue;
    }
    const run = await runExport({ db, session: null }, { companyId: id, kind: "scheduled", at, bucket });
    results.push({ companyId: id, status: run.status });
  }
  return results;
}
