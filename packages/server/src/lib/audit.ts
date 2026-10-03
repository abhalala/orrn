import { sql, type SQL } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";

import { auditLog } from "@orrn/db/schema";

import { createId } from "./id";
import type { Context } from "../context";
import type { OrrnDb } from "./atomic";

export type AuditInput = {
  action: string;
  subjectType: string;
  subjectId?: string | null;
  meta?: Record<string, unknown>;
};

/**
 * Insert one audit_log row.
 *
 * When the request is running under a platform-admin impersonation session
 * (ctx.impersonation != null), the *impersonated company member* would be
 * the natural actor, but we don't have one. Instead we keep:
 *   - actorId          = the platform admin user (ctx.session.user.id)
 *   - impersonatorId   = the same platform admin user, marking the row as
 *                        having been written under impersonation
 *
 * Once M9 lands real grants we can split these apart further.
 */
export function auditInsert(
  ctx: Pick<Context, "db" | "session" | "companyId"> & {
    impersonation?: Context["impersonation"];
    db: OrrnDb;
  },
  input: AuditInput,
): BatchItem<"sqlite"> {
  const actorId = ctx.session?.user.id ?? null;
  const impersonatorId = ctx.impersonation ? ctx.impersonation.actorUserId : null;

  return ctx.db.insert(auditLog).values({
    id: createId(),
    companyId: ctx.companyId,
    actorId,
    impersonatorId,
    action: input.action,
    subjectType: input.subjectType,
    subjectId: input.subjectId ?? null,
    meta: input.meta ?? {},
  });
}

/**
 * Like auditInsert, but the row is written only when `where` matches a row of
 * `from` at write time (INSERT … SELECT). Use it after a conditional UPDATE in
 * the same batch so a write that lost a race leaves no audit row behind.
 */
export function auditInsertGuarded(
  ctx: Pick<Context, "db" | "session" | "companyId"> & {
    impersonation?: Context["impersonation"];
    db: OrrnDb;
  },
  input: AuditInput,
  guard: { from: SQLiteTable; where: SQL | undefined },
): BatchItem<"sqlite"> {
  const actorId = ctx.session?.user.id ?? null;
  const impersonatorId = ctx.impersonation ? ctx.impersonation.actorUserId : null;
  // Keys must match audit_log's columns, in table order (drizzle insert-select rule).
  return ctx.db.insert(auditLog).select(
    ctx.db
      .select({
        id: sql<string>`${createId()}`.as("id"),
        companyId: sql<string | null>`${ctx.companyId}`.as("company_id"),
        actorId: sql<string | null>`${actorId}`.as("actor_id"),
        impersonatorId: sql<string | null>`${impersonatorId}`.as("impersonator_id"),
        action: sql<string>`${input.action}`.as("action"),
        subjectType: sql<string>`${input.subjectType}`.as("subject_type"),
        subjectId: sql<string | null>`${input.subjectId ?? null}`.as("subject_id"),
        meta: sql<string>`${JSON.stringify(input.meta ?? {})}`.as("meta"),
        at: sql<number>`${Date.now()}`.as("at"),
      })
      .from(guard.from)
      .where(guard.where)
      .limit(1),
  );
}

export async function writeAudit(
  ctx: Pick<Context, "db" | "session" | "companyId"> & {
    impersonation?: Context["impersonation"];
  },
  input: AuditInput,
) {
  await ctx.db.insert(auditLog).values({
    id: createId(),
    companyId: ctx.companyId,
    actorId: ctx.session?.user.id ?? null,
    impersonatorId: ctx.impersonation ? ctx.impersonation.actorUserId : null,
    action: input.action,
    subjectType: input.subjectType,
    subjectId: input.subjectId ?? null,
    meta: input.meta ?? {},
  });
}
