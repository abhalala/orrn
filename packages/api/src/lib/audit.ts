import { auditLog } from "@orrn/db/schema";

import { createId } from "./id";
import type { Context } from "../context";

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
export async function writeAudit(
  ctx: Pick<Context, "db" | "session" | "companyId"> & {
    impersonation?: Context["impersonation"];
  },
  input: AuditInput,
) {
  const actorId = ctx.session?.user.id ?? null;
  const impersonatorId = ctx.impersonation ? ctx.impersonation.actorUserId : null;

  await ctx.db.insert(auditLog).values({
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
