import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { company, membership, waitlistRequest } from "@orrn/db/schema/tenant";
import { user } from "@orrn/db/schema/auth";
import { env } from "@orrn/env/server";
import { createAuth } from "@orrn/auth";

import { atomicBatch, type SqliteBatchItem } from "../../lib/atomic";
import { platformGuard, platformProcedure } from "../../index";

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
      const webBase = (env.WEB_PUBLIC_URL ?? env.CORS_ORIGIN).replace(/\/$/, "");

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

  waitlistReject: platformProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(waitlistRequest)
        .set({
          status: "rejected",
          reviewedBy: ctx.session.user.id,
          reviewedAt: new Date(),
        })
        .where(eq(waitlistRequest.id, input.id));

      return { success: true };
    }),
};
