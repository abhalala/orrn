import { TRPCError } from "@trpc/server";
import { and, count, desc, eq, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { z } from "zod";

import { user } from "@orrn/db/schema/auth";
import { approval, approvalKinds, approvalStatuses } from "@orrn/db/schema/approval";

import { APPROVAL_APPLIERS } from "../lib/approvalApply";
import { atomicBatch } from "../lib/atomic";
import { auditInsertGuarded } from "../lib/audit";
import { canApprove } from "../lib/permissions";
import { nextCompanySeq } from "../lib/sequence";
import { companyProcedure, router } from "../index";

const requester = alias(user, "approval_requester");
const decider = alias(user, "approval_decider");

/**
 * Second-person sign-off for plant submits (spec P9 "approve"). Requests are
 * opened by the plant modules (lib/approval.ts) inside their own batch; this
 * router lists them and records the decision.
 */
export const approvalRouter = router({
  /**
   * Tenant-scoped list, newest first, paginated by limit/offset with `total`
   * and `nextOffset` (null on the last page). Reads are open to every role.
   */
  list: companyProcedure
    .input(
      z.object({
        status: z.enum(approvalStatuses).optional(),
        kind: z.enum(approvalKinds).optional(),
        limit: z.number().int().min(1).max(200).default(50),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .query(async ({ ctx, input }) => {
      const conditions: (SQL | undefined)[] = [eq(approval.companyId, ctx.companyId)];
      if (input.status) conditions.push(eq(approval.status, input.status));
      if (input.kind) conditions.push(eq(approval.kind, input.kind));
      const where = and(...conditions);
      const items = await ctx.db
        .select({
          id: approval.id,
          kind: approval.kind,
          subjectId: approval.subjectId,
          status: approval.status,
          requestNote: approval.requestNote,
          meta: approval.meta,
          requestedBy: approval.requestedBy,
          requestedByName: requester.name,
          decidedBy: approval.decidedBy,
          decidedByName: decider.name,
          decidedAt: approval.decidedAt,
          note: approval.note,
          createdAt: approval.createdAt,
        })
        .from(approval)
        .leftJoin(requester, eq(requester.id, approval.requestedBy))
        .leftJoin(decider, eq(decider.id, approval.decidedBy))
        .where(where)
        .orderBy(desc(approval.createdAt), desc(approval.id))
        .limit(input.limit)
        .offset(input.offset);
      const [totalRow] = await ctx.db.select({ n: count() }).from(approval).where(where);
      const total = totalRow?.n ?? 0;
      const next = input.offset + items.length;
      return { items, total, limit: input.limit, offset: input.offset, nextOffset: next < total ? next : null };
    }),

  /**
   * Approve or reject a pending request. Only the approver roles for its kind
   * may decide, never the requester; a decided request is BAD_REQUEST. The
   * UPDATE is conditional on `pending`, and the audit row is written only if
   * this request's write landed, so two racing approvers produce one decision.
   * Kinds with an apply hook (lib/approvalApply.ts) write their effect in the same
   * batch, guarded the same way.
   */
  decide: companyProcedure
    .input(
      z.object({
        id: z.string().min(1).max(64),
        decision: z.enum(["approved", "rejected"]),
        note: z.string().trim().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select()
        .from(approval)
        .where(and(eq(approval.id, input.id), eq(approval.companyId, ctx.companyId)))
        .limit(1);
      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });
      }
      if (!canApprove(ctx.role, row.kind)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You don't have permission to do that" });
      }
      const userId = ctx.session.user.id;
      if (row.requestedBy === userId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Someone else has to approve your request" });
      }
      if (row.status !== "pending") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This request was already decided" });
      }

      const serverSeq = await nextCompanySeq(ctx, ctx.companyId);
      const decidedAt = new Date();
      const note = input.note ? input.note : null;
      const mine = and(
        eq(approval.id, row.id),
        eq(approval.companyId, ctx.companyId),
        eq(approval.serverSeq, serverSeq),
        eq(approval.status, input.decision),
      );

      // Kind-specific effect (e.g. die re-rank writes the tier), guarded to land only if this
      // decision did, in the same batch as the decision.
      const apply = APPROVAL_APPLIERS[row.kind]?.(
        { db: ctx.db, companyId: ctx.companyId, seq: serverSeq, decidedAt },
        { id: row.id, subjectId: row.subjectId },
        input.decision,
      ) ?? [];

      await atomicBatch(ctx.db, [
        ctx.db
          .update(approval)
          .set({ status: input.decision, decidedBy: userId, decidedAt, note, serverSeq })
          .where(
            and(eq(approval.id, row.id), eq(approval.companyId, ctx.companyId), eq(approval.status, "pending")),
          ),
        ...apply,
        auditInsertGuarded(
          ctx,
          {
            action: `approval.${input.decision}`,
            subjectType: "approval",
            subjectId: row.id,
            meta: { kind: row.kind, subjectId: row.subjectId, decision: input.decision, note },
          },
          { from: approval, where: mine },
        ),
      ]);

      const [landed] = await ctx.db
        .select({ id: approval.id })
        .from(approval)
        .where(mine)
        .limit(1);
      if (!landed) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This request was already decided" });
      }

      return { id: row.id, status: input.decision, decidedAt };
    }),
});
