import { auditLog } from "@orrn/db/schema";

import { createId } from "./id";
import type { Context } from "../context";

export type AuditInput = {
  action: string;
  subjectType: string;
  subjectId?: string | null;
  meta?: Record<string, unknown>;
};

export async function writeAudit(ctx: Pick<Context, "db" | "session" | "companyId">, input: AuditInput) {
  await ctx.db.insert(auditLog).values({
    id: createId(),
    companyId: ctx.companyId,
    actorId: ctx.session?.user.id ?? null,
    action: input.action,
    subjectType: input.subjectType,
    subjectId: input.subjectId ?? null,
    meta: input.meta ?? {},
  });
}
