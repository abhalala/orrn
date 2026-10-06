import { TRPCError } from "@trpc/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { company, membership, waitlistRequest } from "@orrn/db/schema/tenant";
import { user } from "@orrn/db/schema/auth";
import { createAuth } from "@orrn/auth";

import { atomicBatch, type SqliteBatchItem } from "../../lib/atomic";
import { webBaseUrl } from "../../lib/webUrl";
import { platformGuard } from "../../index";

export const waitlistProcedures = {
  waitlistList: platformGuard("platform.waitlist.review").query(async ({ ctx }) => {
    return ctx.db
      .select()
      .from(waitlistRequest)
      .where(eq(waitlistRequest.status, "pending"))
      .all();
  }),

  waitlistApprove: platformGuard("platform.waitlist.review")
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const request = await ctx.db
        .select()
        .from(waitlistRequest)
        .where(eq(waitlistRequest.id, input.id))
        .get();

      if (!request) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Waitlist request not found" });
      }
      if (request.status !== "pending") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Request is already processed" });
      }

      const companyId = request.companyId ?? crypto.randomUUID();
      const webBase = webBaseUrl();

      const companyExists = await ctx.db
        .select()
        .from(company)
        .where(eq(company.id, companyId))
        .get();

      const existingUser = await ctx.db
        .select()
        .from(user)
        .where(eq(user.email, request.requesterEmail))
        .get();

      const userId = existingUser?.id ?? crypto.randomUUID();

      const existingMembership = existingUser
        ? await ctx.db
            .select()
            .from(membership)
            .where(
              and(eq(membership.userId, userId), eq(membership.companyId, companyId)),
            )
            .get()
        : null;

      const batchStatements: SqliteBatchItem[] = [
        ctx.db
          .update(waitlistRequest)
          .set({
            status: "approved",
            reviewedBy: ctx.session.user.id,
            reviewedAt: new Date(),
          })
          .where(eq(waitlistRequest.id, input.id)),
      ];

      if (companyExists) {
        batchStatements.push(
          ctx.db
            .update(company)
            .set({ status: "active" })
            .where(eq(company.id, companyId)),
        );
      } else {
        const slugBase = request.companyName
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "-")
          .replace(/-+/g, "-")
          .replace(/^-|-$/g, "");
        const slug = `${slugBase || "company"}-${crypto.randomUUID().split("-")[0]}`;
        batchStatements.push(
          ctx.db.insert(company).values({
            id: companyId,
            name: request.companyName.trim(),
            slug,
            status: "active",
            settings: {},
            modules: [],
          }),
        );
      }

      if (!existingUser) {
        batchStatements.push(
          ctx.db.insert(user).values({
            id: userId,
            name: request.requesterName,
            email: request.requesterEmail,
            emailVerified: true,
            onboardingCompleted: false,
          }),
        );
      }

      if (!existingMembership) {
        batchStatements.push(
          ctx.db.insert(membership).values({
            id: crypto.randomUUID(),
            userId,
            companyId,
            role: "owner",
          }),
        );
      }

      await atomicBatch(ctx.db, batchStatements);

      const auth = createAuth();
      await auth.api.signInMagicLink({
        body: {
          email: request.requesterEmail,
          callbackURL: `${webBase}/setup-credentials`,
        },
        headers: ctx.request.headers,
      });

      return { success: true };
    }),

  waitlistReject: platformGuard("platform.waitlist.review")
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const request = await ctx.db
        .select()
        .from(waitlistRequest)
        .where(eq(waitlistRequest.id, input.id))
        .get();

      if (!request) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Waitlist request not found" });
      }
      // An approved request already has a company + owner; rejecting it would leave that
      // access in place while the record says otherwise (audit S18).
      if (request.status !== "pending") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Request is already processed" });
      }

      const statements: SqliteBatchItem[] = [
        ctx.db
          .update(waitlistRequest)
          .set({
            status: "rejected",
            reviewedBy: ctx.session.user.id,
            reviewedAt: new Date(),
          })
          .where(and(eq(waitlistRequest.id, input.id), eq(waitlistRequest.status, "pending"))),
      ];
      if (request.companyId) {
        // `waitlist.submit` created a `pending` company for the request. It was
        // never approved, so it has no members and no data: remove it, or it
        // reads as "Waiting for approval" in Godseye forever and counts as a
        // company. Only while it is still pending with no members, and only
        // once this request really is rejected (a concurrent approve wins).
        // The request row stays on record. Its company_id is cleared first:
        // the live column (migration 0004) has no ON DELETE action.
        const shellId = request.companyId;
        const removable = sql`exists (select 1 from "company" c where c."id" = ${shellId} and c."status" = 'pending')
          and not exists (select 1 from "membership" m where m."company_id" = ${shellId})`;
        statements.push(
          ctx.db
            .update(waitlistRequest)
            .set({ companyId: null })
            .where(and(eq(waitlistRequest.id, input.id), eq(waitlistRequest.status, "rejected"), removable)),
          ctx.db
            .delete(company)
            .where(
              and(
                eq(company.id, shellId),
                removable,
                sql`exists (select 1 from "waitlist_request" w where w."id" = ${input.id} and w."status" = 'rejected' and w."company_id" is null)`,
                sql`not exists (select 1 from "waitlist_request" w where w."company_id" = ${shellId})`,
              ),
            ),
        );
      }
      await atomicBatch(ctx.db, statements);

      return { success: true };
    }),
};
