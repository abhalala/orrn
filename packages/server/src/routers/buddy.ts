/**
 * The buddy's own router (design 2026-11-18, §4.4, §7, §13). Browser session only: every procedure
 * refuses the MCP context (`ctx.via === "buddy"`) and an impersonating platform admin, and `buddy.*` is
 * denied on the tool leg too (`lib/buddy/decisions.ts`), so Hermes can never confirm its own drafts or
 * mint a grant.
 */
import { TRPCError } from "@trpc/server";
import { buddyCall, buddyGrant, buddyLink } from "@orrn/db/schema";
import { buddyRevokeStatements } from "@orrn/auth/buddy-revoke";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";

import { router } from "../index";
import { atomicBatch, atomicBatchLast } from "../lib/atomic";
import { auditInsert, auditInsertGuarded } from "../lib/audit";
import { TRPCMetaError } from "../lib/errorMeta";
import { now } from "../lib/clock";
import { createId } from "../lib/id";
import { buddyAccess, buddyEnv } from "../lib/buddy/access";
import { buddyHermesProfile } from "../lib/buddy/config";
import { buddyDraftsRouter } from "./buddyDrafts";
import { buddyProcedure } from "./buddyProcedure";
import { hashBuddyToken, newBuddyToken } from "../lib/buddy/token";
import type { BuddyCallView, BuddyGrantCreated, BuddyStatusView } from "../lib/buddy/views";

/** A grant lives 30 days (security M4, decision 5); Settings > Buddy renews it, and the owner can revoke it any time. */
export const BUDDY_GRANT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Making or renewing a grant needs a session signed in within this long (decision 5). */
export const BUDDY_FRESH_SIGN_IN_MS = 10 * 60 * 1000;

/** `error.data.meta.reason` when the session is older than `BUDDY_FRESH_SIGN_IN_MS`: the screen asks to sign in again. */
export const FRESH_SIGN_IN_NEEDED = "FRESH_SIGN_IN_NEEDED";

type SessionShape = { session?: { signInMethod?: unknown; createdAt?: unknown } } | null | undefined;

/** When this browser session signed in (Better Auth `session.createdAt`), or null when unknown. */
function signedInAt(session: SessionShape): number | null {
  const raw = session?.session?.createdAt;
  const ms = raw instanceof Date ? raw.getTime() : typeof raw === "string" || typeof raw === "number" ? new Date(raw).getTime() : NaN;
  return Number.isFinite(ms) ? ms : null;
}

/**
 * A fresh sign-in: the session was made in the last 10 minutes. The plant's secure sign-in rule is already applied by
 * `companyProcedure`, and the grant keeps this session's sign-in method, so the MCP leg is judged like it.
 */
function assertFreshSignIn(session: SessionShape, at: Date): void {
  const since = signedInAt(session);
  if (since === null || at.getTime() - since > BUDDY_FRESH_SIGN_IN_MS || since > at.getTime() + 60_000) {
    throw new TRPCMetaError({
      code: "FORBIDDEN",
      message: "Sign in again to connect Hermes. This keeps a stolen session from making a key.",
      meta: { reason: FRESH_SIGN_IN_NEEDED },
    });
  }
}

const sessionMethod = (session: SessionShape): string | null => {
  const m = session?.session?.signInMethod;
  return typeof m === "string" ? m : null;
};

type BuddyStatusOut = Omit<BuddyStatusView, "connected"> & {
  connected: (NonNullable<BuddyStatusView["connected"]> & { renewedAt: string | null }) | null;
};

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

export const buddyRouter = router({
  status: buddyProcedure.query(async ({ ctx }): Promise<BuddyStatusOut> => {
    const access = await buddyAccess(ctx);
    const grant = await ctx.db
      .select({
        id: buddyGrant.id,
        createdAt: buddyGrant.createdAt,
        lastUsedAt: buddyGrant.lastUsedAt,
        expiresAt: buddyGrant.expiresAt,
        renewedAt: buddyGrant.renewedAt,
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
            renewedAt: iso(live.renewedAt),
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
      const at = now();
      assertFreshSignIn(ctx.session, at);
      const access = await buddyAccess(ctx);
      if (!access.listed) throw new TRPCError({ code: "FORBIDDEN", message: "The buddy is not open for this plant" });
      const hermesProfile = buddyHermesProfile(buddyEnv());
      if (!hermesProfile) throw new TRPCError({ code: "FORBIDDEN", message: "The buddy is not set up on this stage" });
      const userId = ctx.session.user.id;
      const token = newBuddyToken();
      const grantId = createId();
      const writes = [
        // The earlier key ends (`replaced`) with its pending drafts; the link stays.
        ...buddyRevokeStatements(ctx.db, { userId, companyId: ctx.companyId, link: false }, "replaced", at),
        ctx.db.insert(buddyGrant).values({
          id: grantId,
          companyId: ctx.companyId,
          userId,
          tokenHash: await hashBuddyToken(token),
          scopes: [],
          signInMethod: sessionMethod(ctx.session),
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
      ];
      await atomicBatch(ctx.db, writes);
      return { grantId, token };
    }),

    /**
     * Renew from Settings > Buddy (decision 5): 30 days from now, after a fresh sign-in. The grant takes this
     * session's sign-in method again (security L4). A revoked or run-out key cannot be renewed: connect again.
     */
    renew: buddyProcedure
      .input(z.strictObject({ grantId: z.string().min(1).max(64) }))
      .mutation(async ({ ctx, input }): Promise<{ grantId: string; expiresAt: string }> => {
        const at = now();
        assertFreshSignIn(ctx.session, at);
        const userId = ctx.session.user.id;
        const mine = and(eq(buddyGrant.companyId, ctx.companyId), eq(buddyGrant.id, input.grantId), eq(buddyGrant.userId, userId));
        const grant = await ctx.db.select({ id: buddyGrant.id }).from(buddyGrant).where(mine).get();
        if (!grant) throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });
        const expiresAt = new Date(at.getTime() + BUDDY_GRANT_TTL_MS);
        const live = and(mine, isNull(buddyGrant.revokedAt), gt(buddyGrant.expiresAt, at));
        const renewed = await atomicBatchLast<{ id: string }>(ctx.db, [
          ctx.db.update(buddyGrant).set({ expiresAt, renewedAt: at, signInMethod: sessionMethod(ctx.session) }).where(live),
          auditInsertGuarded(
            ctx,
            { action: "buddy.grant.renew", subjectType: "buddy_grant", subjectId: grant.id },
            { from: buddyGrant, where: and(mine, eq(buddyGrant.renewedAt, at)) },
          ),
          ctx.db.select({ id: buddyGrant.id }).from(buddyGrant).where(and(mine, eq(buddyGrant.renewedAt, at))),
        ]);
        if (renewed.length === 0) {
          throw new TRPCError({ code: "CONFLICT", message: "This key no longer works. Connect Hermes again." });
        }
        return { grantId: grant.id, expiresAt: expiresAt.toISOString() };
      }),

    /**
     * Cuts Hermes off at once. The person's link goes too, so the bubble hides until they connect again, and the
     * grant's pending drafts expire in the same batch (security L1).
     */
    revoke: buddyProcedure.input(z.strictObject({ grantId: z.string().min(1).max(64) })).mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const grant = await ctx.db
        .select({ id: buddyGrant.id, revokedAt: buddyGrant.revokedAt })
        .from(buddyGrant)
        .where(and(eq(buddyGrant.companyId, ctx.companyId), eq(buddyGrant.id, input.grantId), eq(buddyGrant.userId, userId)))
        .get();
      if (!grant) throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });
      if (grant.revokedAt) return { grantId: grant.id, revoked: true as const };
      // "Cut off Hermes": the grant, its pending drafts (security L1) and the link, in one batch.
      await atomicBatch(ctx.db, [
        ...buddyRevokeStatements(ctx.db, { userId, companyId: ctx.companyId, grantId: grant.id }, "owner", now()),
        auditInsert(ctx, { action: "buddy.grant.revoke", subjectType: "buddy_grant", subjectId: grant.id }),
      ]);
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
