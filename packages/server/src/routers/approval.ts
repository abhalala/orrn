import { TRPCError } from "@trpc/server";
import { and, count, desc, eq, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { z } from "zod";

import { user } from "@orrn/db/schema/auth";
import { approval, approvalKinds, approvalStatuses } from "@orrn/db/schema/approval";

import { APPROVAL_APPLIERS, APPROVAL_PREPARERS, explainApplyAbort } from "../lib/approvalApply";
import { APPROVAL_KIND_MODULE, assertModule } from "../lib/moduleGate";
import { atomicBatch } from "../lib/atomic";
import { auditInsertGuarded } from "../lib/audit";
import { canAny, canApprove, type Action } from "../lib/permissions";
import { nextCompanySeq } from "../lib/sequence";
import { companyProcedure, router } from "../index";

const requester = alias(user, "approval_requester");

/** Who may read scrap purchase figures (mirror of `purchaseReader` in routers/vendor.ts). */
const PURCHASE_READ_ACTIONS: readonly Action[] = ["purchase.receipt", "purchase.dcnote", "reports.read", "masters.publish"];
/** dc_note meta keys anyone may see (no weights or money: rate = amount ÷ kg). */
const DC_NOTE_PUBLIC_META = ["number", "lotId", "lotNumber", "type", "reason"] as const;
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
      // Defence in depth: whatever a dc_note request carries, callers who cannot read purchase
      // figures see only its number, lot and type (and not the free-text note).
      const purchaseReader = canAny({ company: { role: ctx.role }, isPlatformAdmin: false, platformRole: null }, PURCHASE_READ_ACTIONS);
      const visible = purchaseReader
        ? items
        : items.map((item) =>
            item.kind === "dc_note"
              ? {
                  ...item,
                  requestNote: null,
                  meta: Object.fromEntries(DC_NOTE_PUBLIC_META.filter((k) => k in (item.meta ?? {})).map((k) => [k, item.meta[k]])),
                }
              : item,
          );
      const [totalRow] = await ctx.db.select({ n: count() }).from(approval).where(where);
      const total = totalRow?.n ?? 0;
      const next = input.offset + items.length;
      return { items: visible, total, limit: input.limit, offset: input.offset, nextOffset: next < total ? next : null };
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
    // Final explore L13: a role that approves no kind at all is refused before its input is read
    // (403, not 400 for a malformed body); the per-kind check below still runs.
    .use(({ ctx, next }) => {
      if (!approvalKinds.some((kind) => canApprove(ctx.role, kind))) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You don't have permission to do that" });
      }
      return next({ ctx });
    })
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
      // FP-PF-07: deciding writes the kind's module rows (a cast close, a D/C note), so that module
      // must be on, as for the module's own mutations.
      await assertModule(ctx, APPROVAL_KIND_MODULE[row.kind]);
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
      const applyCtx = { db: ctx.db, companyId: ctx.companyId, userId, seq: serverSeq, decidedAt };
      const prepared = await APPROVAL_PREPARERS[row.kind]?.(applyCtx, { id: row.id, subjectId: row.subjectId, meta: row.meta ?? null }, input.decision);
      const apply = APPROVAL_APPLIERS[row.kind]?.(applyCtx, { id: row.id, subjectId: row.subjectId }, input.decision, prepared) ?? [];

      try {
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
      } catch (e) {
        // An apply hook refused the effect at write time (e.g. a bori the foundry already melted).
        await explainApplyAbort(ctx.db, ctx.companyId, row, e);
        throw e;
      }

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
