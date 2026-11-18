import type { createDb } from "@orrn/db";
import { auditLog } from "@orrn/db/schema/audit";
import { account, authThrottle, passkey, user } from "@orrn/db/schema/auth";
import { company, membership } from "@orrn/db/schema/tenant";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { and, count, eq, isNotNull, sql } from "drizzle-orm";

import { writeAuthLog } from "./logger";

/**
 * The ways an account signs in, and the two rules on removing them (plan 2026-11-18; spec Design
 * §7-10, Settings > Sign-in). One source for every reader: the magic-link guard, Godseye's owner
 * sign-in (`routers/platform/waitlist.ts`), `auth.me`, `auth.signInMethods` and the hooks below.
 *
 * - A way in is a password (a `credential` account with a password), a passkey, or a linked Google
 *   account. The authenticator app is a second factor, not a way in on its own.
 * - A strong method is the authenticator app (`user.twoFactorEnabled`; a `two_factor` row alone may
 *   be a half-finished enrolment), a passkey, or Google.
 * - LAST_SIGN_IN_METHOD: no removal may leave an account with no way in.
 * - COMPANY_REQUIRES_STRONG_METHOD: while an active plant the person belongs to requires secure
 *   sign-in (`company.settings.requireStrongSignIn`, spec Amendment 2026-11-18 item 3), they may not
 *   remove or turn off their last strong method. Two-factor is otherwise the person's own choice,
 *   owners included.
 *
 * Tested in packages/server/test/auth-sign-in-methods.test.ts and auth-plant-policy.test.ts.
 */
export const LAST_SIGN_IN_METHOD = "LAST_SIGN_IN_METHOD";
export const COMPANY_REQUIRES_STRONG_METHOD = "COMPANY_REQUIRES_STRONG_METHOD";
/** Another removal of this person's sign-in methods is still in flight (council round 1, A2). */
export const SIGN_IN_CHANGE_BUSY = "SIGN_IN_CHANGE_BUSY";

const MESSAGES = {
  [LAST_SIGN_IN_METHOD]: "This is the last way to sign in to this account. Add another one first.",
  [COMPANY_REQUIRES_STRONG_METHOD]:
    "A plant you belong to requires secure sign-in. Keep a passkey, Google or the authenticator app, or add another one first.",
  [SIGN_IN_CHANGE_BUSY]: "Another change to your sign-in is still saving. Try again in a moment.",
} as const;

type Db = ReturnType<typeof createDb>;

export type SignInMethods = { password: boolean; passkeys: number; google: boolean; authenticator: boolean };

export async function signInMethodsFor(db: Db, userId: string): Promise<SignInMethods> {
  const [row, credential, passkeys, google] = await Promise.all([
    db.select({ twoFactorEnabled: user.twoFactorEnabled }).from(user).where(eq(user.id, userId)).get(),
    db
      .select({ id: account.id })
      .from(account)
      .where(and(eq(account.userId, userId), eq(account.providerId, "credential"), isNotNull(account.password)))
      .get(),
    db.select({ n: count() }).from(passkey).where(eq(passkey.userId, userId)).get(),
    db
      .select({ id: account.id })
      .from(account)
      .where(and(eq(account.userId, userId), eq(account.providerId, "google")))
      .get(),
  ]);
  return {
    password: Boolean(credential),
    passkeys: passkeys?.n ?? 0,
    google: Boolean(google),
    authenticator: row?.twoFactorEnabled === true,
  };
}

/** True when the account has a way in (password, passkey or Google). */
export const hasWayIn = (m: SignInMethods) => m.password || m.passkeys > 0 || m.google;
/** True when the account has a strong method (authenticator app, passkey or Google). */
export const hasStrongMethod = (m: SignInMethods) => m.authenticator || m.passkeys > 0 || m.google;

/**
 * True when an active plant the user belongs to requires secure sign-in
 * (`company.settings.requireStrongSignIn`). A suspended plant does not count: the person cannot enter
 * it (tenantContext refuses it), so its policy does not hold them.
 */
export async function plantRequiresStrongSignIn(db: Db, userId: string): Promise<boolean> {
  const row = await db
    .select({ id: membership.id })
    .from(membership)
    .innerJoin(company, eq(company.id, membership.companyId))
    .where(
      and(
        eq(membership.userId, userId),
        eq(company.status, "active"),
        sql`json_extract(${company.settings}, '$.requireStrongSignIn') = 1`,
      ),
    )
    .get();
  return Boolean(row);
}

type GuardCtx = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];

export const PASSKEY_DELETE_PATH = "/passkey/delete-passkey";
export const PASSKEY_REGISTER_PATH = "/passkey/verify-registration";
export const TWO_FACTOR_DISABLE_PATH = "/two-factor/disable";
export const UNLINK_ACCOUNT_PATH = "/unlink-account";
const REMOVAL_PATHS = new Set([PASSKEY_DELETE_PATH, TWO_FACTOR_DISABLE_PATH, UNLINK_ACCOUNT_PATH]);

/**
 * The methods left after this request, or null when the request removes nothing of this user's
 * (an unknown passkey id, a provider the account does not have): the endpoint answers that itself.
 */
async function methodsAfter(db: Db, userId: string, ctx: GuardCtx, before: SignInMethods): Promise<SignInMethods | null> {
  const body = (ctx.body ?? {}) as { id?: unknown; providerId?: unknown; accountId?: unknown };
  if (ctx.path === PASSKEY_DELETE_PATH) {
    if (typeof body.id !== "string") return null;
    const own = await db
      .select({ id: passkey.id })
      .from(passkey)
      .where(and(eq(passkey.id, body.id), eq(passkey.userId, userId)))
      .get();
    return own ? { ...before, passkeys: before.passkeys - 1 } : null;
  }
  if (ctx.path === TWO_FACTOR_DISABLE_PATH) {
    return before.authenticator ? { ...before, authenticator: false } : null;
  }
  // `/unlink-account` removes one account of the provider (the one named by `accountId`, if given).
  if (body.providerId === "credential") return before.password ? { ...before, password: false } : null;
  if (body.providerId === "google") {
    const rows = await db
      .select({ accountId: account.accountId })
      .from(account)
      .where(and(eq(account.userId, userId), eq(account.providerId, "google")))
      .all();
    if (rows.length === 0) return null;
    if (typeof body.accountId === "string" && !rows.some((r) => r.accountId === body.accountId)) return null;
    return { ...before, google: rows.length > 1 };
  }
  return null;
}

/**
 * Council round 1, A2: the guard counts before the plugin writes, so two removals sent at once (two
 * passkey deletes in two tabs, a passkey delete and a Google unlink) could each count the other's
 * method as staying. Removals of one person are serialised instead: the before-hook takes this lock
 * (one `auth_throttle` row, a single atomic upsert that only replaces a lock older than
 * `REMOVAL_LOCK_MS`), the after-hook frees it, and a removal that finds it held is refused with
 * `SIGN_IN_CHANGE_BUSY`. The expiry frees a lock whose request died before its after-hook (a crash
 * that is not an `APIError` skips the after-hooks).
 */
export const REMOVAL_LOCK_MS = 30_000;
const removalLockKey = (userId: string) => `signin-lock:${userId}`;

async function takeRemovalLock(db: Db, userId: string, nowMs: number): Promise<boolean> {
  const stale = sql`${authThrottle.windowStart} <= ${nowMs - REMOVAL_LOCK_MS}`;
  const rows = await db
    .insert(authThrottle)
    .values({ key: removalLockKey(userId), windowStart: nowMs, hits: 1 })
    .onConflictDoUpdate({ target: authThrottle.key, set: { windowStart: nowMs, hits: 1 }, setWhere: stale })
    .returning({ key: authThrottle.key });
  return rows.length > 0;
}

async function freeRemovalLock(db: Db, userId: string): Promise<void> {
  try {
    await db.delete(authThrottle).where(eq(authThrottle.key, removalLockKey(userId)));
  } catch (error) {
    // The expiry frees it anyway.
    writeAuthLog("error", "sign-in change lock not freed", error instanceof Error ? error.name : "unknown");
  }
}

/**
 * Better Auth `hooks.before`: refuses a passkey delete, a two-factor disable or an account unlink
 * that would leave no way in, or leave a member of a plant that requires secure sign-in with no
 * strong method. Holds the person's removal lock from here to `signInAuditAfter`.
 */
export async function signInMethodGuardBody(db: Db, ctx: GuardCtx): Promise<void> {
  if (!ctx.path || !REMOVAL_PATHS.has(ctx.path)) return;
  const session = await getSessionFromCtx(ctx).catch(() => null);
  // No session: the endpoint's own session check answers 401.
  const userId = session?.user?.id;
  if (!userId) return;
  if (!(await takeRemovalLock(db, userId, Date.now()))) {
    throw new APIError("CONFLICT", { code: SIGN_IN_CHANGE_BUSY, message: MESSAGES[SIGN_IN_CHANGE_BUSY] });
  }
  try {
    const before = await signInMethodsFor(db, userId);
    const after = await methodsAfter(db, userId, ctx, before);
    if (!after) return;
    if (hasWayIn(before) && !hasWayIn(after)) {
      throw new APIError("FORBIDDEN", { code: LAST_SIGN_IN_METHOD, message: MESSAGES[LAST_SIGN_IN_METHOD] });
    }
    if (hasStrongMethod(before) && !hasStrongMethod(after) && (await plantRequiresStrongSignIn(db, userId))) {
      throw new APIError("FORBIDDEN", {
        code: COMPANY_REQUIRES_STRONG_METHOD,
        message: MESSAGES[COMPANY_REQUIRES_STRONG_METHOD],
      });
    }
  } catch (error) {
    // Refused here: the endpoint and its after-hooks never run, so the lock is freed now.
    await freeRemovalLock(db, userId);
    throw error;
  }
}

/**
 * Writes one user-level audit row (no plant; `audit_log.company_id` is nullable). Never throws: the
 * sign-in change it records has already happened. Meta carries row ids only, never a credential id,
 * a public key or a Google token.
 */
export async function writeUserAudit(
  db: Db,
  input: { userId: string; action: "auth.passkey.add" | "auth.passkey.remove" | "auth.google.link"; meta?: Record<string, unknown> },
): Promise<void> {
  try {
    await db.insert(auditLog).values({
      id: crypto.randomUUID(),
      companyId: null,
      actorId: input.userId,
      action: input.action,
      subjectType: "user",
      subjectId: input.userId,
      meta: input.meta ?? {},
    });
  } catch (error) {
    writeAuthLog("error", `audit ${input.action} not written`, error instanceof Error ? error.name : "unknown");
  }
}

type AfterCtx = { path?: string; context: { returned?: unknown } } & Partial<GuardCtx>;

/** The endpoint's answer: in-process calls get the object, the HTTP handler a `{ body, _flag: "json" }` wrapper. */
function returnedBody(returned: unknown): Record<string, unknown> | null {
  if (!returned || typeof returned !== "object" || returned instanceof APIError || returned instanceof Response) return null;
  const value = returned as Record<string, unknown>;
  if (value._flag === "json") {
    const body = value.body;
    return body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  }
  return value;
}

/** Better Auth `hooks.after`: audit a passkey added or removed, and free the removal lock. Never throws. */
export async function signInAuditAfter(db: Db, ctx: AfterCtx): Promise<void> {
  if (ctx.path && REMOVAL_PATHS.has(ctx.path)) {
    // The guard took the lock for this request (it runs after every endpoint answer, refusals included).
    // `/two-factor/disable` swaps the session, so the user id is read from the old cookie's session or
    // the new one, whichever is still there.
    const session = await getSessionFromCtx(ctx as GuardCtx).catch(() => null);
    const userId = session?.user?.id ?? (ctx.context as { session?: { user?: { id?: string } } | null }).session?.user?.id;
    if (userId) await freeRemovalLock(db, userId);
  }
  try {
    if (ctx.path === PASSKEY_REGISTER_PATH) {
      const created = returnedBody(ctx.context.returned);
      if (typeof created?.id !== "string" || typeof created.userId !== "string") return;
      await writeUserAudit(db, { userId: created.userId, action: "auth.passkey.add", meta: { passkeyId: created.id } });
      return;
    }
    if (ctx.path === PASSKEY_DELETE_PATH) {
      const answer = returnedBody(ctx.context.returned);
      if (answer?.status !== true) return;
      const session = await getSessionFromCtx(ctx as GuardCtx).catch(() => null);
      const passkeyId = (ctx.body as { id?: unknown } | undefined)?.id;
      if (!session?.user?.id || typeof passkeyId !== "string") return;
      await writeUserAudit(db, { userId: session.user.id, action: "auth.passkey.remove", meta: { passkeyId } });
    }
  } catch (error) {
    writeAuthLog("error", "sign-in audit failed", error instanceof Error ? error.name : "unknown");
  }
}
