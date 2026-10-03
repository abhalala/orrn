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
  },
): { id: string; statement: SqliteBatchItem } {
  const id = input.id ?? crypto.randomUUID();
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
