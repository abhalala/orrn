/**
 * The buddy's own router (design 2026-11-18, §4.4, §7, §13). Browser session only: every procedure
 * refuses the MCP context (`ctx.via === "buddy"`) and an impersonating platform admin, and `buddy.*` is
 * denied on the tool leg too (`lib/buddy/decisions.ts`), so Hermes can never confirm its own drafts or
 * mint a grant.
 */
import { TRPCError } from "@trpc/server";
import { buddyCall, buddyGrant, buddyLink } from "@orrn/db/schema";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { router } from "../index";
import { atomicBatch } from "../lib/atomic";
import { auditInsert } from "../lib/audit";
import { now } from "../lib/clock";
import { createId } from "../lib/id";
import { buddyAccess, buddyEnv } from "../lib/buddy/access";
import { buddyHermesProfile } from "../lib/buddy/config";
import { buddyDraftsRouter } from "./buddyDrafts";
import { buddyProcedure } from "./buddyProcedure";
import { hashBuddyToken, newBuddyToken } from "../lib/buddy/token";
import type { BuddyCallView, BuddyGrantCreated, BuddyStatusView } from "../lib/buddy/views";

/** A grant lives a year; the owner can revoke it at any time in Settings > Buddy. */
export const BUDDY_GRANT_TTL_MS = 365 * 24 * 60 * 60 * 1000;

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

export const buddyRouter = router({
  status: buddyProcedure.query(async ({ ctx }): Promise<BuddyStatusView> => {
    const access = await buddyAccess(ctx);
    const grant = await ctx.db
      .select({
        id: buddyGrant.id,
        createdAt: buddyGrant.createdAt,
        lastUsedAt: buddyGrant.lastUsedAt,
        expiresAt: buddyGrant.expiresAt,
      })
      .from(buddyGrant)
      .where(
        and(
          eq(buddyGrant.companyId, ctx.companyId),
          eq(buddyGrant.userId, ctx.session.user.id),
          isNull(buddyGrant.revokedAt),
        ),
      )
      .orderBy(desc(buddyGrant.createdAt))
      .get();
    const live = grant && (!grant.expiresAt || grant.expiresAt.getTime() > now().getTime()) ? grant : null;
    return {
      available: access.person && access.configured,
      listed: access.listed,
      connected: live
        ? {
            grantId: live.id,
            createdAt: live.createdAt.toISOString(),
            lastUsedAt: iso(live.lastUsedAt),
            expiresAt: iso(live.expiresAt),
          }
        : null,
    };
  }),

  grant: router({
    /**
     * "Connect Hermes": a new grant (the token is shown once) and the person's link to the buddy's own Hermes
     * profile (`BUDDY_HERMES_PROFILE`, else `orrn-buddy`; never the default profile). Any earlier live grant of the person in this plant is revoked in the same batch, so one
     * token works at a time. Only for a plant listed in `BUDDY_COMPANIES`.
     */
    create: buddyProcedure.mutation(async ({ ctx }): Promise<BuddyGrantCreated> => {
      const access = await buddyAccess(ctx);
      if (!access.listed) throw new TRPCError({ code: "FORBIDDEN", message: "The buddy is not open for this plant" });
      const hermesProfile = buddyHermesProfile(buddyEnv());
      if (!hermesProfile) throw new TRPCError({ code: "FORBIDDEN", message: "The buddy is not set up on this stage" });
      const userId = ctx.session.user.id;
      const token = newBuddyToken();
      const grantId = createId();
      const at = now();
      const signInMethod = (ctx.session.session as { signInMethod?: unknown } | undefined)?.signInMethod;
      const writes = [
        ctx.db
          .update(buddyGrant)
          .set({ revokedAt: at })
          .where(and(eq(buddyGrant.companyId, ctx.companyId), eq(buddyGrant.userId, userId), isNull(buddyGrant.revokedAt))),
        ctx.db.insert(buddyGrant).values({
          id: grantId,
          companyId: ctx.companyId,
          userId,
          tokenHash: await hashBuddyToken(token),
          scopes: [],
          signInMethod: typeof signInMethod === "string" ? signInMethod : null,
          createdBy: userId,
          createdAt: at,
          expiresAt: new Date(at.getTime() + BUDDY_GRANT_TTL_MS),
        }),
        ...(access.link
          ? []
          : [
              ctx.db.insert(buddyLink).values({
                id: createId(),
                companyId: ctx.companyId,
                userId,
                hermesProfile,
                status: "active" as const,
                createdAt: at,
              }),
            ]),
        auditInsert(ctx, { action: "buddy.grant.create", subjectType: "buddy_grant", subjectId: grantId }),
      ] as const;
      await atomicBatch(ctx.db, writes);
      return { grantId, token };
    }),

    /** Cuts Hermes off at once. The person's link goes too, so the bubble hides until they connect again. */
    revoke: buddyProcedure.input(z.strictObject({ grantId: z.string().min(1).max(64) })).mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const grant = await ctx.db
        .select({ id: buddyGrant.id, revokedAt: buddyGrant.revokedAt })
        .from(buddyGrant)
        .where(and(eq(buddyGrant.companyId, ctx.companyId), eq(buddyGrant.id, input.grantId), eq(buddyGrant.userId, userId)))
        .get();
      if (!grant) throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });
      if (grant.revokedAt) return { grantId: grant.id, revoked: true as const };
      const at = now();
      await atomicBatch(ctx.db, [
        ctx.db
          .update(buddyGrant)
          .set({ revokedAt: at })
          .where(and(eq(buddyGrant.companyId, ctx.companyId), eq(buddyGrant.id, grant.id))),
        ctx.db
          .update(buddyLink)
          .set({ status: "revoked", revokedAt: at })
          .where(and(eq(buddyLink.companyId, ctx.companyId), eq(buddyLink.userId, userId), eq(buddyLink.status, "active"))),
        auditInsert(ctx, { action: "buddy.grant.revoke", subjectType: "buddy_grant", subjectId: grant.id }),
      ] as const);
      return { grantId: grant.id, revoked: true as const };
    }),
  }),

  calls: router({
    /** The plant's last 100 buddy calls (tool calls and chat turns), newest first. No bodies, no chat text. */
    list: buddyProcedure.query(async ({ ctx }): Promise<BuddyCallView[]> => {
      const rows = await ctx.db
        .select({
          id: buddyCall.id,
          tool: buddyCall.tool,
          path: buddyCall.path,
          outcome: buddyCall.outcome,
          ms: buddyCall.ms,
          resultBytes: buddyCall.resultBytes,
          platform: buddyCall.platform,
          at: buddyCall.at,
        })
        .from(buddyCall)
        .where(eq(buddyCall.companyId, ctx.companyId))
        .orderBy(desc(buddyCall.at), desc(buddyCall.id))
        .limit(100);
      return rows.map((r) => ({ ...r, at: r.at.toISOString() }));
    }),
  }),

  drafts: buddyDraftsRouter,
});
