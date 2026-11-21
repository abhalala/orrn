/**
 * Ending orrn buddy grants (fix round 2026-11-20, security M4 and L1). One set of statements, used by every event that
 * ends a grant: the owner's "Cut off Hermes" (`owner`), a new key (`replaced`), a password reset, any password change
 * (self-service or forced), signing out of every session, Google linked to an unverified account, removal from the
 * plant, any role change, the person removing a passkey, the authenticator app or Google (`secure_sign_in_off`), and
 * (`buddyRevokePlantStatements`) the plant suspended, delisted or dropping its secure sign-in rule. Each revoke also
 * expires the pending drafts of the grants it
 * ends, in the same batch. A draft whose confirm is running (it holds a claim) is left to that confirm.
 *
 * Nothing is ever un-revoked: a grant stores no membership state that a re-invite or a re-promotion could match
 * again, and `contextFromGrant` refuses any grant with `revoked_at` set. The person connects Hermes again.
 *
 * Lives in `@orrn/auth` because the auth hooks (password reset, sign out everywhere) need it and this package cannot
 * import `@orrn/server`; the server's routers import it from here.
 */
import type { createDb } from "@orrn/db";
import { atomicBatch } from "@orrn/db/atomic";
import { buddyDraft, buddyGrant, buddyLink, type BuddyGrantRevokeReason } from "@orrn/db/schema/buddy";
import { and, eq, inArray, isNull, notInArray, or, type SQL } from "drizzle-orm";
import { createAuthMiddleware, getSessionFromCtx } from "better-auth/api";

import { sessionOfRequest, STRONG_SIGN_IN_METHODS } from "./session-method";

type Db = ReturnType<typeof createDb>;

export type BuddyRevokeScope = {
  userId: string;
  /** Only this plant; omitted = every plant (password reset, sign out everywhere). */
  companyId?: string;
  /** Only this grant (the owner's "Cut off Hermes" on one key). */
  grantId?: string;
  /** Also end the person's `buddy_link`, so the bubble hides until they connect again. Default true. */
  link?: boolean;
};

/**
 * The statements, in order: expire the live grants' pending drafts, revoke the grants, end the links. Put them in the
 * caller's own `atomicBatch` so the revoke goes with the event's write (a role change, a membership delete).
 */
export function buddyRevokeStatements(db: Db, scope: BuddyRevokeScope, reason: BuddyGrantRevokeReason, at: Date) {
  const live: SQL = and(
    eq(buddyGrant.userId, scope.userId),
    scope.companyId ? eq(buddyGrant.companyId, scope.companyId) : undefined,
    scope.grantId ? eq(buddyGrant.id, scope.grantId) : undefined,
    isNull(buddyGrant.revokedAt),
  )!;
  const statements = [
    db
      .update(buddyDraft)
      .set({ status: "expired", decidedAt: at })
      .where(
        and(
          eq(buddyDraft.status, "pending"),
          isNull(buddyDraft.claimedAt),
          inArray(buddyDraft.grantId, db.select({ id: buddyGrant.id }).from(buddyGrant).where(live)),
        ),
      ),
    db.update(buddyGrant).set({ revokedAt: at, revokedReason: reason }).where(live),
  ];
  if (scope.link === false) return statements;
  return [
    ...statements,
    db
      .update(buddyLink)
      .set({ status: "revoked", revokedAt: at })
      .where(
        and(eq(buddyLink.userId, scope.userId), scope.companyId ? eq(buddyLink.companyId, scope.companyId) : undefined, eq(buddyLink.status, "active")),
      ),
  ];
}

export type BuddyPlantRevokeScope = {
  companyId: string;
  /** Only the grants whose sign-in method a secure sign-in rule would refuse (none, password, sign-in link, other). */
  weakOnly?: boolean;
  /** Also end the plant's `buddy_link`s. Default true. */
  link?: boolean;
  /** An extra condition every statement holds (a guard on the event's own write, evaluated in the same batch). */
  when?: SQL;
};

/**
 * Every live grant of one plant, whoever holds it (delta round, D-L4): the plant suspended (`plant_suspended`) or not
 * listed in `BUDDY_COMPANIES` (`plant_delisted`), and, with `weakOnly`, the plant dropping its secure sign-in rule
 * (`secure_sign_in_off`: a password grant the rule refused must not start working). A separate function from
 * `buddyRevokeStatements`, whose `userId` stays required, so a missing argument can never end every grant.
 */
export function buddyRevokePlantStatements(db: Db, scope: BuddyPlantRevokeScope, reason: BuddyGrantRevokeReason, at: Date) {
  const live: SQL = and(
    eq(buddyGrant.companyId, scope.companyId),
    isNull(buddyGrant.revokedAt),
    scope.weakOnly ? or(isNull(buddyGrant.signInMethod), notInArray(buddyGrant.signInMethod, [...STRONG_SIGN_IN_METHODS])) : undefined,
    scope.when,
  )!;
  const statements = [
    db
      .update(buddyDraft)
      .set({ status: "expired", decidedAt: at })
      .where(
        and(
          eq(buddyDraft.companyId, scope.companyId),
          eq(buddyDraft.status, "pending"),
          isNull(buddyDraft.claimedAt),
          inArray(buddyDraft.grantId, db.select({ id: buddyGrant.id }).from(buddyGrant).where(live)),
        ),
      ),
    db.update(buddyGrant).set({ revokedAt: at, revokedReason: reason }).where(live),
  ];
  if (scope.link === false) return statements;
  return [
    ...statements,
    db
      .update(buddyLink)
      .set({ status: "revoked", revokedAt: at })
      .where(and(eq(buddyLink.companyId, scope.companyId), eq(buddyLink.status, "active"), scope.when)),
  ];
}

/**
 * Revokes on its own (the auth hooks). A database without the buddy tables (the app deployed before its migrations)
 * has no grants to end, so "no such table" is not an error here; anything else is thrown.
 */
export async function revokeBuddyGrants(db: Db, scope: BuddyRevokeScope, reason: BuddyGrantRevokeReason, at: Date = new Date()): Promise<void> {
  try {
    await atomicBatch(db, buddyRevokeStatements(db, scope, reason, at) as never);
  } catch (error) {
    if (error instanceof Error && /no such table/i.test(`${error.message} ${String((error as { cause?: unknown }).cause ?? "")}`)) return;
    throw error;
  }
}

/** `buddyRevokePlantStatements` on its own, in one batch (the MCP leg, which may not batch writes itself). */
export async function revokeBuddyPlantGrants(db: Db, scope: BuddyPlantRevokeScope, reason: BuddyGrantRevokeReason, at: Date = new Date()): Promise<void> {
  await atomicBatch(db, buddyRevokePlantStatements(db, scope, reason, at) as never);
}

/** Better Auth paths that end every session of the person (or every other one). */
export const SIGN_OUT_EVERYWHERE_PATHS: ReadonlySet<string> = new Set(["/revoke-sessions", "/revoke-other-sessions"]);

const STASH = "orrnBuddyRevokeUserId";

type HookCtx = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];

/** Better Auth's self-service password change (it needs the current password). */
export const CHANGE_PASSWORD_PATH = "/change-password";

/**
 * Why this request ends the person's buddy grants, or null. A password change ends trust in the old password, so it
 * revokes whether or not it also signs out the other sessions (`password_changed`); a sign out of every (other)
 * session is `signed_out_everywhere`.
 */
function revokeReasonOf(ctx: { path?: string }): BuddyGrantRevokeReason | null {
  if (ctx.path === CHANGE_PASSWORD_PATH) return "password_changed";
  if (ctx.path && SIGN_OUT_EVERYWHERE_PATHS.has(ctx.path)) return "signed_out_everywhere";
  return null;
}

/**
 * `hooks.before`: remembers whose grants this request ends (from its own session cookie), before any session goes.
 * Writes nothing: the revoke waits for the endpoint to succeed (`buddyRevokeAfter`).
 */
export async function buddyRevokeBefore(db: Db, ctx: HookCtx): Promise<void> {
  if (!revokeReasonOf(ctx)) return;
  const own = await sessionOfRequest(db, ctx);
  const userId = own?.userId ?? (await getSessionFromCtx(ctx).catch(() => null))?.session?.userId ?? null;
  if (userId) (ctx.context as unknown as Record<string, unknown>)[STASH] = userId;
}

/** `hooks.after`: the endpoint succeeded, so the person's buddy grants end too (`password_changed`, `signed_out_everywhere`). */
export async function buddyRevokeAfter(db: Db, ctx: HookCtx): Promise<void> {
  const reason = revokeReasonOf(ctx);
  if (!reason) return;
  const userId = (ctx.context as unknown as Record<string, unknown>)[STASH];
  if (typeof userId !== "string") return;
  const returned = (ctx.context as { returned?: unknown }).returned;
  if (returned instanceof Error || returned instanceof Response) return;
  await revokeBuddyGrants(db, { userId }, reason);
}
