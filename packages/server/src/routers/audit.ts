import { and, desc, eq, gte, lt, lte, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { auditLog } from "@orrn/db/schema/audit";
import { user } from "@orrn/db/schema/auth";
import { company } from "@orrn/db/schema/tenant";

import { actionProcedure, router } from "../index";
import type { OrrnDb } from "../lib/atomic";
import { now } from "../lib/clock";
import { canAny, type Action } from "../lib/permissions";

/**
 * Audit viewer (FP-PF-16, ledger D8: Now). Read-only, company-scoped, `audit.read` (owner, admin,
 * manager). There is no delete and no pruning: `auditRetentionDays` is only the default `from`.
 */
export const AUDIT_PAGE_MAX = 100;
export const AUDIT_FOR_SUBJECT_CAP = 50;

/** Same restraint as the approvals inbox: purchase figures only for purchase readers. */
const PURCHASE_READ_ACTIONS: readonly Action[] = ["purchase.receipt", "purchase.dcnote", "reports.read", "masters.publish"];
const PURCHASE_SUBJECTS = new Set(["dc_note", "purchase_lot"]);
const PURCHASE_PUBLIC_META = ["number", "lotId", "lotNumber", "type", "reason", "status"];

const cursorSchema = z.object({ at: z.number().int(), id: z.string().min(1).max(64) });

type Row = {
  id: string;
  at: Date;
  action: string;
  subjectType: string;
  subjectId: string | null;
  meta: Record<string, unknown>;
  actorId: string | null;
  actorName: string | null;
  impersonatorId: string | null;
};

function view(rows: Row[], purchaseReader: boolean) {
  return rows.map((r) => ({
    id: r.id,
    at: r.at.toISOString(),
    action: r.action,
    subjectType: r.subjectType,
    subjectId: r.subjectId,
    actorId: r.actorId,
    actorName: r.actorName,
    /** Written by ORRN staff under impersonation. */
    byStaff: r.impersonatorId !== null,
    meta:
      purchaseReader || !PURCHASE_SUBJECTS.has(r.subjectType)
        ? (r.meta ?? {})
        : Object.fromEntries(PURCHASE_PUBLIC_META.filter((k) => k in (r.meta ?? {})).map((k) => [k, r.meta[k]])),
  }));
}

const select = {
  id: auditLog.id,
  at: auditLog.at,
  action: auditLog.action,
  subjectType: auditLog.subjectType,
  subjectId: auditLog.subjectId,
  meta: auditLog.meta,
  actorId: auditLog.actorId,
  actorName: user.name,
  impersonatorId: auditLog.impersonatorId,
};

export const auditListInput = z.object({
  actorId: z.string().min(1).max(64).optional(),
  /** Exact action (`dispatch.complete`), or a kind prefix ending in "." (`dispatch.`). */
  action: z.string().trim().min(1).max(80).optional(),
  /**
   * Several exact actions and/or prefixes ending in "." at once (one Kind in the viewer covers
   * `die.`, `die_instance.`, `nitriding.` …). Combined with `action` by OR.
   */
  actions: z.array(z.string().trim().min(1).max(80)).min(1).max(20).optional(),
  subjectType: z.string().trim().min(1).max(60).optional(),
  subjectId: z.string().min(1).max(64).optional(),
  /** Epoch ms, inclusive. Default: `auditRetentionDays` ago. */
  from: z.number().int().min(0).optional(),
  /** Epoch ms, inclusive. */
  to: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(AUDIT_PAGE_MAX).default(50),
  cursor: cursorSchema.optional(),
});

/** One page of a plant's audit log, newest first. `companyId` comes from the caller's context, never an input. */
export async function listAudit(
  db: OrrnDb,
  companyId: string,
  input: z.infer<typeof auditListInput>,
  purchaseReader: boolean,
) {
  const co = await db.select({ days: company.auditRetentionDays }).from(company).where(eq(company.id, companyId)).get();
  const from = input.from ?? now().getTime() - (co?.days ?? 180) * 86_400_000;
  const filters: SQL[] = [eq(auditLog.companyId, companyId), gte(auditLog.at, new Date(from))];
  if (input.to !== undefined) filters.push(lte(auditLog.at, new Date(input.to)));
  if (input.actorId) filters.push(eq(auditLog.actorId, input.actorId));
  const wanted = [...(input.action ? [input.action] : []), ...(input.actions ?? [])];
  if (wanted.length > 0) {
    const matches = wanted.map((a) => {
      if (!a.endsWith(".")) return eq(auditLog.action, a);
      // LIKE with the prefix escaped ('_' and '%' are literal in action names).
      const escaped = a.replace(/[\\%_]/g, (c) => `\\${c}`);
      return sql`${auditLog.action} like ${`${escaped}%`} escape '\\'`;
    });
    filters.push(or(...matches)!);
  }
  if (input.subjectType) filters.push(eq(auditLog.subjectType, input.subjectType));
  if (input.subjectId) filters.push(eq(auditLog.subjectId, input.subjectId));
  if (input.cursor) {
    const at = new Date(input.cursor.at);
    filters.push(or(lt(auditLog.at, at), and(eq(auditLog.at, at), lt(auditLog.id, input.cursor.id)))!);
  }
  const rows = await db
    .select(select)
    .from(auditLog)
    .leftJoin(user, eq(user.id, auditLog.actorId))
    .where(and(...filters))
    .orderBy(desc(auditLog.at), desc(auditLog.id))
    .limit(input.limit + 1);
  const page = rows.slice(0, input.limit) as Row[];
  const last = page[page.length - 1];
  return {
    items: view(page, purchaseReader),
    nextCursor: rows.length > input.limit && last ? { at: last.at.getTime(), id: last.id } : null,
    from,
  };
}

export const auditRouter = router({
  list: actionProcedure("audit.read")
    .input(auditListInput)
    .query(async ({ ctx, input }) => {
      const purchaseReader = canAny({ company: { role: ctx.role }, isPlatformAdmin: false, platformRole: null }, PURCHASE_READ_ACTIONS);
      return listAudit(ctx.db, ctx.companyId, input, purchaseReader);
    }),

  /** One subject's history (bundle, dispatch screens): newest first, at most 50 rows. */
  forSubject: actionProcedure("audit.read")
    .input(z.object({ subjectType: z.string().trim().min(1).max(60), subjectId: z.string().min(1).max(64) }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select(select)
        .from(auditLog)
        .leftJoin(user, eq(user.id, auditLog.actorId))
        .where(
          and(
            eq(auditLog.companyId, ctx.companyId),
            eq(auditLog.subjectType, input.subjectType),
            eq(auditLog.subjectId, input.subjectId),
          ),
        )
        .orderBy(desc(auditLog.at), desc(auditLog.id))
        .limit(AUDIT_FOR_SUBJECT_CAP + 1);
      const purchaseReader = canAny({ company: { role: ctx.role }, isPlatformAdmin: false, platformRole: null }, PURCHASE_READ_ACTIONS);
      return {
        items: view(rows.slice(0, AUDIT_FOR_SUBJECT_CAP) as Row[], purchaseReader),
        capped: rows.length > AUDIT_FOR_SUBJECT_CAP,
      };
    }),
});
