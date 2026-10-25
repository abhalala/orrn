/**
 * Reason-code defaults for real plants (C39, rank 30). The defaults live in `@orrn/domain`
 * (`defaultReasonCodeRows()`); a plant gets them when its company is approved and, for plants
 * that already exist, the first time a reason list is read. Both go through `ensureDefaultReasonCodes`,
 * which only inserts the (kind, code) pairs the company does not have: a renamed or retired code
 * keeps its row (unique on company + kind + code), so it is never created again.
 */
import { reasonCode } from "@orrn/db/schema/reasons";
import { defaultReasonCodeRows } from "@orrn/domain";
import { eq } from "drizzle-orm";

import { atomicBatch, pushChunkedInserts, type OrrnDb, type SqliteBatchItem } from "./atomic";

type ReasonCodeRowInsert = typeof reasonCode.$inferInsert;

function defaultRowsFor(companyId: string, have: ReadonlySet<string>, createdBy: string | null): ReasonCodeRowInsert[] {
  // Every bound column is named, so the chunker counts them (a JS default or $onUpdate binds one it does not see).
  const at = new Date();
  return defaultReasonCodeRows()
    .filter((row) => !have.has(`${row.kind}:${row.code}`))
    .map((row) => ({
      id: crypto.randomUUID(),
      companyId,
      kind: row.kind,
      code: row.code,
      label: row.label,
      requiresNote: row.requiresNote,
      active: true,
      sortOrder: row.sortOrder,
      serverSeq: 0,
      createdBy,
      createdAt: at,
      updatedAt: at,
    }));
}

/** Statements that insert every default for a company that has none yet (company approval). */
export function defaultReasonCodeStatements(db: OrrnDb, companyId: string, createdBy: string | null = null): SqliteBatchItem[] {
  const out: SqliteBatchItem[] = [];
  pushChunkedInserts(out, (rows) => db.insert(reasonCode).values(rows).onConflictDoNothing(), defaultRowsFor(companyId, new Set(), createdBy));
  return out;
}

/**
 * Idempotent: inserts the defaults the company is missing and returns how many it added. Safe to
 * call on every read (one small select when nothing is missing); concurrent calls cannot duplicate
 * because the insert is `on conflict do nothing` on the unique (company, kind, code) index.
 */
export async function ensureDefaultReasonCodes(db: OrrnDb, companyId: string): Promise<number> {
  const existing = await db.select({ kind: reasonCode.kind, code: reasonCode.code }).from(reasonCode).where(eq(reasonCode.companyId, companyId));
  const rows = defaultRowsFor(companyId, new Set(existing.map((r) => `${r.kind}:${r.code}`)), null);
  if (rows.length === 0) return 0;
  const statements: SqliteBatchItem[] = [];
  pushChunkedInserts(statements, (part) => db.insert(reasonCode).values(part).onConflictDoNothing(), rows);
  await atomicBatch(db, statements);
  return rows.length;
}
