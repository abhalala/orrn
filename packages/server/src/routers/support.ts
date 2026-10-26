import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { supportRequest } from "@orrn/db/schema/platform";

import { actionProcedure, companyProcedure, router } from "../index";
import { atomicBatch } from "../lib/atomic";
import { auditInsert } from "../lib/audit";
import { createId } from "../lib/id";

export const MAX_SUPPORT_BODY = 2000;

/** Plant side of support (FP-PF-14): ask, and read your own requests and their replies. */
export const supportRouter = router({
  request: actionProcedure("support.request")
    .input(
      z.object({
        subject: z.string().trim().max(120).optional(),
        body: z.string().trim().min(1).max(MAX_SUPPORT_BODY),
        /** The screen the person was on (route path). */
        screen: z.string().trim().max(200).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const id = createId();
      const subject = input.subject?.trim() || input.body.split("\n")[0]!.slice(0, 80);
      await atomicBatch(ctx.db, [
        ctx.db.insert(supportRequest).values({
          id,
          companyId: ctx.companyId,
          subject,
          body: input.body,
          screen: input.screen ?? null,
          status: "open",
          createdBy: ctx.session.user.id,
        }),
        auditInsert(ctx, {
          action: "support_request.create",
          subjectType: "support_request",
          subjectId: id,
          meta: { screen: input.screen ?? null },
        }),
      ]);
      return { id, status: "open" as const };
    }),

  /** The caller's own requests in this plant, newest first. */
  mine: companyProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        id: supportRequest.id,
        subject: supportRequest.subject,
        body: supportRequest.body,
        screen: supportRequest.screen,
        status: supportRequest.status,
        reply: supportRequest.reply,
        repliedAt: supportRequest.repliedAt,
        createdAt: supportRequest.createdAt,
      })
      .from(supportRequest)
      .where(and(eq(supportRequest.companyId, ctx.companyId), eq(supportRequest.createdBy, ctx.session.user.id)))
      .orderBy(desc(supportRequest.createdAt), desc(supportRequest.id))
      .limit(100);
    return rows.map((r) => ({
      ...r,
      repliedAt: r.repliedAt ? r.repliedAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
    }));
  }),
});
