import { and, eq, isNull, like, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";

import { companyRoles, invite, membership, type CompanyRole } from "@orrn/db/schema/tenant";
import { authThrottle, user } from "@orrn/db/schema/auth";
import { createAuth } from "@orrn/auth";
import { clientIp, throttleHit } from "@orrn/auth/reset-throttle";
import { signInMethodsFor } from "@orrn/auth/sign-in-methods";
import { mayHandOutRole } from "@orrn/domain";
import { env } from "@orrn/env/server";
import { acceptInvite, inviteHeldBy } from "../lib/acceptInvite";
import { hasLivePortalRow } from "../lib/portal";
import { atomicBatch } from "../lib/atomic";
import { auditInsert, auditInsertGuarded } from "../lib/audit";
import { sendEmail, renderOrrnEmailHtml } from "../lib/email";
import { webBaseUrl } from "../lib/webUrl";
import { errorText } from "../lib/pack";
import { REPLAY_KEY_PATTERN, replayRowId, replayToken } from "../lib/replayToken";
import type { OrrnDb } from "../lib/atomic";
import { actionProcedure, companyProcedure, publicProcedure, router } from "../index";

const DAY_MS = 24 * 60 * 60 * 1000;
/** An invite link works for a week from when it was sent (or sent again). */
const INVITE_DAYS = 7;

/** `invite.status` reads per client IP in one window (plan 2026-11-18, Task 8). */
export const INVITE_STATUS_LIMIT = { max: 30, windowMs: 10 * 60 * 1000 } as const;
/** `invite.sendSetPasswordLink` per client IP and per invite link, like the reset request's own limit. */
export const INVITE_SET_PASSWORD_LIMIT = { max: 5, windowMs: 15 * 60 * 1000 } as const;
const BUSY = "Too many requests. Try again in a few minutes.";

const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
const hashInviteToken = async (token: string) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));

/**
 * Counts one public call in `auth_throttle` (fixed window, the reset throttle's upsert) and throws 429
 * when a key is over. Old windows are swept first, on every call, refused ones too (indexed on
 * window_start). The IP key is counted first: once the IP is over, the call stops there, so a flood of
 * made-up links from one IP adds no row per link. Then each other key (the link's own) is counted.
 */
async function limitInviteCall(db: OrrnDb, keys: { ip: string[]; other?: string[] }, limit: { max: number; windowMs: number }, nowMs: number) {
  await db.delete(authThrottle).where(and(like(authThrottle.key, "invite:%"), lt(authThrottle.windowStart, nowMs - 2 * INVITE_SET_PASSWORD_LIMIT.windowMs)));
  for (const group of [keys.ip, keys.other ?? []]) {
    const allowed = await Promise.all(group.map((key) => throttleHit(db as never, key, nowMs, limit)));
    if (allowed.some((ok) => !ok)) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: BUSY });
  }
}

/** The client IP's throttle key for `what`, or none when the platform reports no IP (local dev, tests). */
const ipKey = (what: string, request: Request | null | undefined) => {
  const ip = clientIp(request?.headers);
  return ip ? [`invite:${what}:i:${ip}`] : [];
};

/** Same rule as `auth.methods.google`: Google sign-in is on when both secrets are bound. */
const googleOn = () => Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);

/** What the invite page needs about the invited email's account: none, one with a password, or one without. */
async function inviteAccountState(db: OrrnDb, email: string): Promise<"none" | "password" | "noPassword"> {
  const found = await db.select({ id: user.id }).from(user).where(sql`lower(${user.email}) = ${email.toLowerCase()}`).get();
  if (!found) return "none";
  return (await signInMethodsFor(db as never, found.id)).password ? "password" : "noPassword";
}

/**
 * `invite.create` and `invite.resend` refuse an email that is already staff here, or a party login here
 * (PF §9-12: never both). Same messages from both.
 */
async function refuseIfAlreadyHere(db: OrrnDb, companyId: string, email: string) {
  const existingUser = await db.query.user.findFirst({ where: sql`lower(${user.email}) = ${email.toLowerCase()}` });
  if (existingUser) {
    const existingMembership = await db.query.membership.findFirst({
      where: and(eq(membership.userId, existingUser.id), eq(membership.companyId, companyId)),
    });
    if (existingMembership) throw new TRPCError({ code: "BAD_REQUEST", message: "User is already a member" });
  }
  if (await hasLivePortalRow(db, companyId, { email })) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "This email is a party login here. Use another email for staff." });
  }
}

export type InviteStatus =
  | { live: false }
  | { live: true; kind: "member" | "portal"; account: "none" | "password" | "noPassword"; google: boolean };

/**
 * The invite email, sent by `invite.create` and `invite.resend`. Never throws: false when it did not go
 * (Purelymail refused or unreachable, or no mail set up), and the caller hands the inviter the link.
 */
async function sendInviteEmail(email: string, role: CompanyRole, inviteUrl: string): Promise<boolean> {
  try {
    await sendEmail({
      to: email,
      subject: "You've been invited to join a company on ORRN",
      text: `You have been invited to join an ORRN company workspace as ${role.toUpperCase()}.\n\nAccept the invitation: ${inviteUrl}\n\nIf you did not expect this invitation, ignore this email. This link works for 7 days.`,
      html: renderOrrnEmailHtml({
        title: "Workspace Invitation",
        description: `You have been invited to join a company workspace on ORRN-AL with the role of ${role.toUpperCase()}. Click the button below to accept the invitation and complete your account setup.`,
        buttonText: "Accept Invitation",
        buttonUrl: inviteUrl,
        footerText: "If you did not expect this invitation, you can safely ignore this email. This invitation is valid for 7 days.",
      }),
    });
    return true;
  } catch (error) {
    // Neutral log: no address, no link (the link is a live invite). Provider, SMTP code and our own
    // message (never the server's reply) say which mail path failed.
    const failure = error instanceof Error ? error : new Error(String(error));
    const provider = "provider" in failure ? String(failure.provider) : "unknown";
    const status = "status" in failure ? String(failure.status) : "";
    console.warn("Invite saved; its email did not go:", failure.name, provider, status, failure.message);
    return false;
  }
}

export const inviteRouter = router({
  list: companyProcedure.query(async ({ ctx }) => {
    return ctx.db.query.invite.findMany({
      where: and(
        eq(invite.companyId, ctx.companyId),
        // Party logins are listed by portal.users.list (Team tab second list), not here.
        eq(invite.kind, "member"),
        isNull(invite.acceptedAt),
        isNull(invite.revokedAt)
      ),
    });
  }),

  create: actionProcedure("member.invite")
    .input(
      z.object({
        email: z.string().trim().max(320).email(),
        role: z.enum(companyRoles),
        /**
         * Replay key (final fixes 5, M4): a repeat of the same request (a double tap, a reply lost on the way) answers the
         * FIRST invite and its link with `replayed: true` and makes no second one. Another email or role under the same
         * key is a CONFLICT. The email is not sent again on a repeat.
         */
        clientMutationId: z.string().regex(REPLAY_KEY_PATTERN, "clientMutationId is 16 to 64 letters, digits, - or _").optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Emails are compared case-insensitively everywhere; store them lower-cased (audit S7).
      const email = input.email.toLowerCase();
      if (!mayHandOutRole(ctx.role, input.role)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only an owner can invite another owner",
        });
      }
      const keyed = input.clientMutationId ? { id: await replayRowId(ctx.companyId, "invite.create", input.clientMutationId), key: input.clientMutationId } : null;
      const inviteReplay = async () => {
        if (!keyed) return null;
        const prior = await ctx.db.query.invite.findFirst({ where: and(eq(invite.id, keyed.id), eq(invite.companyId, ctx.companyId)) });
        if (!prior) return null;
        if (prior.email !== email || prior.role !== input.role) {
          throw new TRPCError({ code: "CONFLICT", message: "This request id was already used for a different request." });
        }
        const token = await replayToken(ctx.companyId, "invite.create", keyed.key, "uuid");
        // Resent since (invite.resend rotates the token): the first link is dead, so do not hand it back.
        if ((await hashInviteToken(token)) !== prior.tokenHash) {
          throw new TRPCError({ code: "CONFLICT", message: "This invite was sent again since. Copy its new link from the Team tab." });
        }
        const link = `${webBaseUrl()}/invite/${token}`;
        // The first call tried the email; whether it went is not kept, so a repeat says it did not and hands over the link.
        return { success: true, inviteId: prior.id, email, role: input.role, link, emailSent: false, expiresAt: prior.expiresAt, replayed: true as const };
      };
      const again = await inviteReplay();
      if (again) return again;

      // Already a member here, or a party login here (PF §9-12: never also staff).
      await refuseIfAlreadyHere(ctx.db, ctx.companyId, email);

      const inviteId = keyed?.id ?? crypto.randomUUID();
      const token = keyed ? await replayToken(ctx.companyId, "invite.create", keyed.key, "uuid") : crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
      const tokenHash = await hashInviteToken(token);

      try {
      await atomicBatch(ctx.db, [
        ctx.db.insert(invite).values({
          id: inviteId,
          companyId: ctx.companyId,
          email,
          role: input.role,
          tokenHash,
          expiresAt,
          invitedBy: ctx.session.user.id,
        }),
        auditInsert(ctx, {
          action: "member.invite",
          subjectType: "invite",
          subjectId: inviteId,
          meta: { email, role: input.role },
        }),
      ]);
      } catch (e) {
        // Two identical requests racing end on the row's primary key: the second answers the first invite.
        if (keyed && /UNIQUE constraint failed: invite\.(id|token_hash)|PRIMARY KEY/i.test(errorText(e))) {
          const won = await inviteReplay();
          if (won) return won;
        }
        throw e;
      }

      const inviteUrl = `${webBaseUrl()}/invite/${token}`;

      // M3 (final explore): the invite is written; nothing after this throws. The email can fail
      // (Purelymail refused or unreachable) or not be set up (local), so the inviter always gets the link to copy and
      // send by WhatsApp or their own mail, the same way Godseye gets an owner's sign-in details.
      const emailSent = await sendInviteEmail(email, input.role, inviteUrl);

      return { success: true, inviteId, email, role: input.role, link: inviteUrl, emailSent, expiresAt, replayed: false as const };
    }),

  revoke: actionProcedure("member.invite")
    .input(z.object({ inviteId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const targetInvite = await ctx.db.query.invite.findFirst({
        where: and(
          eq(invite.id, input.inviteId),
          eq(invite.companyId, ctx.companyId)
        )
      });
      
      // Party invites are revoked with portal.users.revoke (it also revokes the login).
      if (!targetInvite || targetInvite.kind !== "member") {
        throw new TRPCError({ code: "NOT_FOUND", message: "Invite not found" });
      }

      if (targetInvite.acceptedAt || targetInvite.revokedAt) {
         throw new TRPCError({ code: "BAD_REQUEST", message: "Invite is no longer pending" });
      }

      await atomicBatch(ctx.db, [
        ctx.db
          .update(invite)
          .set({ revokedAt: new Date() })
          .where(and(eq(invite.id, input.inviteId), eq(invite.companyId, ctx.companyId))),
        auditInsert(ctx, {
          action: "member.invite.revoke",
          subjectType: "invite",
          subjectId: input.inviteId,
          meta: { email: targetInvite.email, role: targetInvite.role },
        }),
      ]);

      return { success: true };
    }),

  /**
   * Resend a pending member invite (plan 2026-11-18, Task 8): only the token's hash is stored, so the
   * old link cannot be shown again. A new token replaces it (the old link stops working), the link gets
   * a fresh week, and the invite email goes again. An expired invite that was never revoked or used can
   * be resent; that is the point. The inviter always gets the link to copy, whether or not the email went.
   */
  resend: actionProcedure("member.invite")
    .input(z.object({ inviteId: z.string().min(1).max(64) }))
    .mutation(async ({ ctx, input }) => {
      const target = await ctx.db.query.invite.findFirst({
        where: and(eq(invite.id, input.inviteId), eq(invite.companyId, ctx.companyId)),
      });
      // Party invites are made again with portal.users.grant (it also resets the portal row).
      if (!target || target.kind !== "member") throw new TRPCError({ code: "NOT_FOUND", message: "Invite not found" });
      if (target.acceptedAt || target.revokedAt) throw new TRPCError({ code: "BAD_REQUEST", message: "Invite is no longer pending" });
      if (!mayHandOutRole(ctx.role, target.role)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only an owner can invite another owner" });
      }
      // As create: not for someone already in this plant, as staff or as a party login.
      await refuseIfAlreadyHere(ctx.db, ctx.companyId, target.email);

      const token = crypto.randomUUID();
      const tokenHash = await hashInviteToken(token);
      const expiresAt = new Date(Date.now() + INVITE_DAYS * DAY_MS);
      const pending = and(eq(invite.id, target.id), eq(invite.companyId, ctx.companyId), isNull(invite.acceptedAt), isNull(invite.revokedAt));
      // The pending check is in the write itself, and the audit row is written only when it landed, so a
      // resend that races an accept or a revoke changes nothing.
      await atomicBatch(ctx.db, [
        ctx.db.update(invite).set({ tokenHash, expiresAt }).where(pending),
        auditInsertGuarded(
          ctx,
          { action: "member.invite.resend", subjectType: "invite", subjectId: target.id, meta: { email: target.email, role: target.role } },
          { from: invite, where: and(eq(invite.id, target.id), eq(invite.tokenHash, tokenHash)) },
        ),
      ]);
      const now = await ctx.db.select({ tokenHash: invite.tokenHash }).from(invite).where(eq(invite.id, target.id)).get();
      if (now?.tokenHash !== tokenHash) throw new TRPCError({ code: "BAD_REQUEST", message: "Invite is no longer pending" });

      const link = `${webBaseUrl()}/invite/${token}`;
      const emailSent = await sendInviteEmail(target.email, target.role, link);
      return { link, emailSent, expiresAt };
    }),

  /**
   * What the invite page shows (plan 2026-11-18, Task 8), read without accepting anything. A dead link
   * (unknown, expired, revoked or used) is `{ live: false }`. A live one says its kind, whether the
   * invited email has an account and whether that account has a password, and whether Google sign-in is
   * on. It never says the email, the company, the role or which other ways in the account has. An
   * invite already accepted by the signed-in account (Google sign-up accepts invites as it makes the
   * account) stays live for that account, so the page offers Join and the idempotent accept answers.
   * Public, so it is limited per client IP like the other public reads. A mutation although it writes
   * nothing but the throttle row: a mutation is a POST, so the token rides in the body and never in a
   * GET URL that the request log or Workers Logs could keep (Task 8 fix round 1).
   */
  status: publicProcedure
    .input(z.object({ token: z.string().min(1).max(200) }))
    .mutation(async ({ ctx, input }): Promise<InviteStatus> => {
      const nowMs = Date.now();
      await limitInviteCall(ctx.db, { ip: ipKey("status", ctx.request) }, INVITE_STATUS_LIMIT, nowMs);
      const dead: InviteStatus = { live: false };
      const target = await ctx.db.query.invite.findFirst({ where: eq(invite.tokenHash, await hashInviteToken(input.token)) });
      if (!target || target.revokedAt) return dead;
      if (target.acceptedAt) {
        if (!ctx.session) return dead;
        const me = await ctx.db.select({ email: user.email }).from(user).where(eq(user.id, ctx.session.user.id)).get();
        if (me?.email.toLowerCase() !== target.email.toLowerCase()) return dead;
        if (!(await inviteHeldBy(ctx.db, target, ctx.session.user.id))) return dead;
      } else if (target.expiresAt.getTime() < nowMs) {
        return dead;
      }
      const account = await inviteAccountState(ctx.db, target.email);
      return { live: true, kind: target.kind, account, google: googleOn() };
    }),

  /**
   * "Email me a link to set a password" on the invite page (plan 2026-11-18, Task 8), for an invited
   * email whose account has no password (a magic-link approval, Google or a passkey only). The reset
   * email goes only when the typed email is the invite's own and the invite is live, and its link comes
   * back to this invite (`/reset-password?next=/invite/<token>`). The answer is the same either way, so
   * it says nothing about the invite's email. Limited per client IP and per link before anything is
   * compared; the reset request's own per-address limit and any send failure are swallowed for the same
   * reason. Finishing the reset proves the mailbox (`onPasswordReset` sets `emailVerified`), so a later
   * Google link keeps the new password. The reset request (its writes and the email) runs after the
   * answer through the Worker's `waitUntil`, so a match answers as fast as a mismatch.
   */
  sendSetPasswordLink: publicProcedure
    .input(z.object({ token: z.string().min(1).max(200), email: z.string().trim().min(1).max(320) }))
    .mutation(async ({ ctx, input }) => {
      const nowMs = Date.now();
      const tokenHash = await hashInviteToken(input.token);
      await limitInviteCall(ctx.db, { ip: ipKey("setpw", ctx.request), other: [`invite:setpw:t:${tokenHash.slice(0, 32)}`] }, INVITE_SET_PASSWORD_LIMIT, nowMs);
      const target = await ctx.db.query.invite.findFirst({ where: eq(invite.tokenHash, tokenHash) });
      const live = target && !target.revokedAt && !target.acceptedAt && target.expiresAt.getTime() >= nowMs;
      if (live && target.email.toLowerCase() === input.email.toLowerCase()) {
        const redirectTo = `${webBaseUrl()}/reset-password?next=${encodeURIComponent(`/invite/${input.token}`)}`;
        const headers = ctx.request?.headers ?? new Headers();
        const send = (async () => {
          try {
            await createAuth().api.requestPasswordReset({ body: { email: target.email, redirectTo }, headers });
          } catch (error) {
            // The reset request's own limit or a failure: the answer stays the same. No address, no link.
            console.warn("Invite set-password link not sent:", error instanceof Error ? error.name : "unknown");
          }
        })();
        // After the answer where the Worker allows it (prod, wrangler dev); awaited where it does not (tests).
        if (ctx.waitUntil) ctx.waitUntil(send);
        else await send;
      }
      return { success: true as const };
    }),

  acceptByToken: publicProcedure
    .input(z.object({ token: z.string(), name: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const tokenHash = await hashInviteToken(input.token);

      const targetInvite = await ctx.db.query.invite.findFirst({
        where: eq(invite.tokenHash, tokenHash)
      });

      if (!targetInvite) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Invalid invite token" });
      }

      const deadInvite = () => new TRPCError({ code: "BAD_REQUEST", message: "Invite is expired or no longer valid" });
      if (targetInvite.revokedAt) throw deadInvite();
      // An accepted invite is looked at further down: it may be this account's own (Google sign-up
      // accepts invites as it makes the account, then the invite page asks again).
      if (!targetInvite.acceptedAt && targetInvite.expiresAt < new Date()) throw deadInvite();

      // Check if the user is already authenticated
      if (!ctx.session) {
         if (targetInvite.acceptedAt) throw deadInvite();
         throw new TRPCError({ code: "UNAUTHORIZED", message: "Must be logged in to accept invite" });
      }

      const userId = ctx.session.user.id;
      
      // Ensure the logged in user matches the invite email
      const currentUser = await ctx.db.query.user.findFirst({ where: eq(user.id, userId) });
      const emailMatches = currentUser?.email.toLowerCase() === targetInvite.email.toLowerCase();

      if (targetInvite.acceptedAt) {
        // Idempotent only for the account that already holds what the invite gives (plan 2026-11-18).
        if (!emailMatches || !(await inviteHeldBy(ctx.db, targetInvite, userId))) throw deadInvite();
        return targetInvite.kind === "portal" ? { success: true as const, portal: true as const } : { success: true as const };
      }

      if (!emailMatches) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Invite email does not match logged in user" });
      }

      return acceptInvite(ctx.db, { session: ctx.session, impersonation: ctx.impersonation }, targetInvite, userId);
    }),
});
