import { sql, type SQL } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";

import { approval, type ApprovalKind } from "@orrn/db/schema/approval";

import type { OrrnDb, SqliteBatchItem } from "./atomic";

/**
 * Batch item that opens a pending approval for `subjectId`. Plant modules put
 * it in the same atomicBatch as the document that needs the second person
 * (D/C note, cast close, die re-rank, dispatch overdraw, phantom void). The
 * partial unique index allows one pending request per (company, kind, subject).
 *
 * The caller MUST have already loaded `subjectId` scoped to `ctx.companyId`
 * (e.g. scopedFindOrThrow) — this helper does not check that the subject
 * belongs to the tenant, and an approval must never point across tenants.
 */
export function requestApprovalInsert(
  ctx: { db: OrrnDb; companyId: string; session: { user: { id: string } } },
  input: {
    kind: ApprovalKind;
    subjectId: string;
    serverSeq: number;
    requestNote?: string | null;
    meta?: Record<string, unknown>;
    id?: string;
    /**
     * Land the request only if `where` matches a row of `from` at write time (INSERT … SELECT),
     * e.g. only if the subject document inserted earlier in the same batch actually landed.
     */
    guard?: { from: SQLiteTable; where: SQL | undefined };
  },
): { id: string; statement: SqliteBatchItem } {
  const id = input.id ?? crypto.randomUUID();
  if (input.guard) {
    const now = Date.now();
    // Keys follow approval's column order (insert-select rule).
    return {
      id,
      statement: ctx.db.insert(approval).select(
        ctx.db
          .select({
            id: sql<string>`${id}`.as("id"),
            companyId: sql<string>`${ctx.companyId}`.as("company_id"),
            serverSeq: sql<number>`${input.serverSeq}`.as("server_seq"),
            kind: sql<ApprovalKind>`${input.kind}`.as("kind"),
            subjectId: sql<string>`${input.subjectId}`.as("subject_id"),
            status: sql<string>`'pending'`.as("status"),
            requestNote: sql<string | null>`${input.requestNote ?? null}`.as("request_note"),
            meta: sql<string>`${JSON.stringify(input.meta ?? {})}`.as("meta"),
            requestedBy: sql<string>`${ctx.session.user.id}`.as("requested_by"),
            decidedBy: sql<string | null>`null`.as("decided_by"),
            decidedAt: sql<number | null>`null`.as("decided_at"),
            note: sql<string | null>`null`.as("note"),
            createdAt: sql<number>`${now}`.as("created_at"),
            updatedAt: sql<number>`${now}`.as("updated_at"),
          })
          .from(input.guard.from)
          .where(input.guard.where)
          .limit(1),
      ),
    };
  }
  return {
    id,
    statement: ctx.db.insert(approval).values({
      id,
      companyId: ctx.companyId,
      serverSeq: input.serverSeq,
      kind: input.kind,
      subjectId: input.subjectId,
      requestNote: input.requestNote ?? null,
      meta: input.meta ?? {},
      requestedBy: ctx.session.user.id,
    }),
  };
}
