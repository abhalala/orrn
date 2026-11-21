import type { createDb } from "@orrn/db";
import { account, passkey, twoFactor, user } from "@orrn/db/schema/auth";
import { company, membership } from "@orrn/db/schema/tenant";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { expireCookie, setSessionCookie } from "better-auth/cookies";
import { and, eq, isNotNull, ne, or, sql, type SQL } from "drizzle-orm";

import { revokeBuddyGrants } from "./buddy-revoke";
import { assertEnrolmentAllowed } from "./enrolment-guard";
import { sessionOfRequest } from "./session-method";
import {
  COMPANY_REQUIRES_STRONG_METHOD,
  LAST_SIGN_IN_METHOD,
  SIGN_IN_CHANGE_BUSY,
  SIGN_IN_CHANGE_MESSAGES,
  signInMethodsFor,
  hasStrongMethod,
  hasWayIn,
  plantRequiresStrongSignIn,
  writeUserAudit,
} from "./sign-in-methods";

/**
 * Council round 2 (GPT I1): removing a sign-in method is checked AT the write, not before it.
 *
 * The rules (LAST_SIGN_IN_METHOD, COMPANY_REQUIRES_STRONG_METHOD) used to be checked in the before-hook
 * and the plugin wrote afterwards, so two removals could each count the other's method as staying; a
 * short lock narrowed that, but a request stalled past the lock could still write. Now the before-hook
 * does the removal itself, as ONE conditional statement whose WHERE clause holds the rules against the
 * rows as they are at that moment, and answers with the endpoint's own body (Better Auth 1.6.9
 * `runBeforeHooks` returns a hook's non-`{ context }` result as the response; the endpoint and the
 * after-hooks do not run). Whatever runs in between, the last way in and a strict plant's last strong
 * method cannot go. Tested in packages/server/test/sign-in-method-removal-race.test.ts.
 *
 * - `/passkey/delete-passkey`: `DELETE FROM passkey WHERE id AND user_id AND <another way in> AND
 *   (<no strict plant> OR <another strong method>)`, then the `auth.passkey.remove` audit row.
 * - `/unlink-account`: the same on the one `account` row the endpoint would pick (credential or google).
 * - `/two-factor/disable`: the password checked as the plugin checks it, then one batch: `UPDATE user
 *   SET two_factor_enabled = 0 WHERE ... (<no strict plant> OR <another strong method>)` and the
 *   `two_factor` row deleted only if the flag is 0 after that; then what the plugin does: a new session
 *   carried from this one (cookie set), this one deleted, the trusted-device record and cookie cleared.
 *
 * The hook falls through to the endpoint only when the endpoint cannot remove anything: no session
 * (401), or a passkey that is not this person's (the endpoint's own not-found / unauthorized answer).
 *
 * Delta round (orrn buddy D-L4): a strong method removed (a passkey, the authenticator app, Google) ends the person's
 * buddy grants in every plant (`secure_sign_in_off`), right after the removal's own write. The grant kept the sign-in
 * method of the session that made it, and that method may be the one just removed.
 *
 * Council round 3 (Claude M1): before removing a STRONG method (any passkey, Google, the authenticator),
 * the session itself must be strong when the person has a strong method and a plant of theirs is strict:
 * the enrolment guard's rule (`assertEnrolmentAllowed`, `STRONG_SIGN_IN_NEEDED`). A password unlink is
 * not strong and is not checked. Tested in packages/server/test/auth-sign-in-methods.test.ts.
 */
type Db = ReturnType<typeof createDb>;
type Ctx = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];

export const PASSKEY_DELETE_PATH = "/passkey/delete-passkey";
export const TWO_FACTOR_DISABLE_PATH = "/two-factor/disable";
export const UNLINK_ACCOUNT_PATH = "/unlink-account";

const MESSAGES = SIGN_IN_CHANGE_MESSAGES;

const refusal = (code: keyof typeof MESSAGES) =>
  new APIError(code === SIGN_IN_CHANGE_BUSY ? "CONFLICT" : "FORBIDDEN", { code, message: MESSAGES[code] });

/** A strict (active) plant this user belongs to, evaluated inside the statement. */
const strictPlant = (userId: string): SQL => sql`exists (
  select 1 from ${membership} inner join ${company} on ${company.id} = ${membership.companyId}
  where ${membership.userId} = ${userId} and ${company.status} = 'active'
    and json_extract(${company.settings}, '$.requireStrongSignIn') = 1)`;

/** The rows that stay, for the conditions: everything of the user's except the one being removed. */
type Except = { passkeyId?: string; accountId?: string };

function otherWayIn(userId: string, except: Except): SQL {
  const accounts = and(
    eq(account.userId, userId),
    except.accountId ? ne(account.id, except.accountId) : undefined,
    or(and(eq(account.providerId, "credential"), isNotNull(account.password)), eq(account.providerId, "google")),
  );
  const keys = and(eq(passkey.userId, userId), except.passkeyId ? ne(passkey.id, except.passkeyId) : undefined);
  return sql`(exists (select 1 from ${account} where ${accounts}) or exists (select 1 from ${passkey} where ${keys}))`;
}

function otherStrong(userId: string, except: Except & { authenticator?: boolean }): SQL {
  const google = and(eq(account.userId, userId), eq(account.providerId, "google"), except.accountId ? ne(account.id, except.accountId) : undefined);
  const keys = and(eq(passkey.userId, userId), except.passkeyId ? ne(passkey.id, except.passkeyId) : undefined);
  const parts = [
    sql`exists (select 1 from ${account} where ${google})`,
    sql`exists (select 1 from ${passkey} where ${keys})`,
  ];
  if (!except.authenticator) parts.push(sql`coalesce((select ${user.twoFactorEnabled} from ${user} where ${user.id} = ${userId}), 0) = 1`);
  return sql`(${sql.join(parts, sql` or `)})`;
}

/** The condition a removal must meet at the write: what it takes away must not be the last of it. */
function keepsRules(userId: string, target: { wayIn: boolean; strong: boolean }, except: Except & { authenticator?: boolean }): SQL {
  const parts: SQL[] = [];
  if (target.wayIn) parts.push(otherWayIn(userId, except));
  if (target.strong) parts.push(sql`(not ${strictPlant(userId)} or ${otherStrong(userId, except)})`);
  return parts.length ? sql`(${sql.join(parts, sql` and `)})` : sql`1 = 1`;
}

/** Which rule refused a removal, judged on the rows as they are now; null when neither does (it changed). */
async function whichRefusal(
  db: Db,
  userId: string,
  target: { wayIn: boolean; strong: boolean },
  remove: (m: Awaited<ReturnType<typeof signInMethodsFor>>) => Awaited<ReturnType<typeof signInMethodsFor>>,
): Promise<keyof typeof MESSAGES | null> {
  const before = await signInMethodsFor(db, userId);
  const after = remove(before);
  if (target.wayIn && !hasWayIn(after)) return LAST_SIGN_IN_METHOD;
  if (target.strong && !hasStrongMethod(after) && (await plantRequiresStrongSignIn(db, userId))) return COMPANY_REQUIRES_STRONG_METHOD;
  return null;
}

/** The endpoint's body as the answer: a Response (with any cookies set here) over HTTP, the object in process. */
function answer(ctx: Ctx, body: Record<string, unknown>): Response | Record<string, unknown> {
  if (!ctx.request) return body;
  // better-call's middleware context collects the cookies set above in `responseHeaders` (not typed).
  const headers = new Headers((ctx as unknown as { responseHeaders?: Headers }).responseHeaders ?? undefined);
  headers.set("content-type", "application/json");
  return new Response(JSON.stringify(body), { status: 200, headers });
}

type Removal = Response | Record<string, unknown> | undefined;

/** How the request's session was made: the live row first (an upgrade writes it), else what Better Auth read. */
type Caller = { userId: string; signInMethod: unknown };

/** Council r3 M1: a weak session in a strict plant may not remove a strong method (see the top). */
async function assertStrongRemovalAllowed(db: Db, ctx: Ctx, caller: Caller): Promise<void> {
  const own = await sessionOfRequest(db, ctx);
  const signInMethod = own && own.userId === caller.userId ? own.signInMethod : caller.signInMethod;
  await assertEnrolmentAllowed(db, { userId: caller.userId, signInMethod, removing: true });
}

async function deletePasskey(db: Db, ctx: Ctx, caller: Caller): Promise<Removal> {
  const userId = caller.userId;
  const id = (ctx.body as { id?: unknown } | undefined)?.id;
  if (typeof id !== "string") return undefined;
  const target = { wayIn: true, strong: true };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const row = await db.select({ userId: passkey.userId }).from(passkey).where(eq(passkey.id, id)).get();
    // Gone, or someone else's: the endpoint answers (not found / unauthorized) and can delete nothing of theirs.
    if (!row || row.userId !== userId) return undefined;
    await assertStrongRemovalAllowed(db, ctx, caller);
    const deleted = await db
      .delete(passkey)
      .where(and(eq(passkey.id, id), eq(passkey.userId, userId), keepsRules(userId, target, { passkeyId: id })))
      .returning({ id: passkey.id });
    if (deleted.length > 0) {
      await writeUserAudit(db, { userId, action: "auth.passkey.remove", meta: { passkeyId: id } });
      await revokeBuddyGrants(db, { userId }, "secure_sign_in_off");
      return answer(ctx, { status: true });
    }
    const code = await whichRefusal(db, userId, target, (m) => ({ ...m, passkeys: Math.max(0, m.passkeys - 1) }));
    if (code) throw refusal(code);
  }
  throw refusal(SIGN_IN_CHANGE_BUSY);
}

/** Better Auth's `freshSessionMiddleware`, which `/unlink-account` uses. */
function assertFresh(ctx: Ctx, createdAt: Date | string | number): void {
  const freshAge = ctx.context.sessionConfig.freshAge;
  if (freshAge === 0) return;
  if (Date.now() - new Date(createdAt).getTime() >= freshAge * 1000) {
    throw new APIError("FORBIDDEN", { code: "SESSION_NOT_FRESH", message: "Session is not fresh" });
  }
}

async function unlinkAccount(db: Db, ctx: Ctx, caller: Caller, createdAt: Date): Promise<Removal> {
  const userId = caller.userId;
  const body = (ctx.body ?? {}) as { providerId?: unknown; accountId?: unknown };
  const providerId = body.providerId;
  if (providerId !== "credential" && providerId !== "google") return undefined;
  assertFresh(ctx, createdAt);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    // The row the endpoint would pick: by provider, and by `accountId` when given.
    const rows = await db
      .select({ id: account.id, accountId: account.accountId, password: account.password })
      .from(account)
      .where(and(eq(account.userId, userId), eq(account.providerId, providerId)))
      .all();
    const row = rows.find((r) => (typeof body.accountId === "string" ? r.accountId === body.accountId : true));
    if (!row) throw new APIError("BAD_REQUEST", { code: "ACCOUNT_NOT_FOUND", message: "Account not found" });
    const target = { wayIn: providerId === "google" || Boolean(row.password), strong: providerId === "google" };
    if (target.strong) await assertStrongRemovalAllowed(db, ctx, caller);
    const deleted = await db
      .delete(account)
      .where(and(eq(account.id, row.id), eq(account.userId, userId), keepsRules(userId, target, { accountId: row.id })))
      .returning({ id: account.id });
    if (deleted.length > 0) {
      if (target.strong) await revokeBuddyGrants(db, { userId }, "secure_sign_in_off");
      return answer(ctx, { status: true });
    }
    const code = await whichRefusal(db, userId, target, (m) =>
      providerId === "google" ? { ...m, google: rows.length > 1 } : { ...m, password: false },
    );
    if (code) throw refusal(code);
  }
  throw refusal(SIGN_IN_CHANGE_BUSY);
}

const TRUST_DEVICE_COOKIE_NAME = "trust_device";
const TRUST_DEVICE_MAX_AGE = 30 * 24 * 60 * 60;

async function disableTwoFactor(
  db: Db,
  ctx: Ctx,
  current: { session: Record<string, unknown> & { token: string; signInMethod?: unknown }; user: { id: string } },
): Promise<Removal> {
  const userId = current.user.id;
  // As the plugin: the password is required (`allowPasswordless` is off) and checked against the credential.
  const password = (ctx.body as { password?: unknown } | undefined)?.password;
  const invalid = () => new APIError("BAD_REQUEST", { code: "INVALID_PASSWORD", message: "Invalid password" });
  if (typeof password !== "string" || !password) throw invalid();
  const credential = (await ctx.context.internalAdapter.findAccounts(userId))?.find((a) => a.providerId === "credential");
  if (!credential?.password || !(await ctx.context.password.verify({ hash: credential.password, password }))) throw invalid();
  await assertStrongRemovalAllowed(db, ctx, { userId, signInMethod: current.session.signInMethod });

  const target = { wayIn: false, strong: true };
  const off = sql`coalesce(${user.twoFactorEnabled}, 0) = 0`;
  const [updated] = await db.batch([
    db
      .update(user)
      .set({ twoFactorEnabled: false, updatedAt: new Date() })
      .where(and(eq(user.id, userId), or(off, keepsRules(userId, target, { authenticator: true }))))
      .returning({ id: user.id }),
    db
      .delete(twoFactor)
      .where(and(eq(twoFactor.userId, userId), sql`coalesce((select ${user.twoFactorEnabled} from ${user} where ${user.id} = ${userId}), 0) = 0`)),
  ]);
  if (updated.length === 0) {
    throw refusal((await whichRefusal(db, userId, target, (m) => ({ ...m, authenticator: false }))) ?? SIGN_IN_CHANGE_BUSY);
  }
  await revokeBuddyGrants(db, { userId }, "secure_sign_in_off");

  // What the plugin does after its write: a new session carried from this one, then this one deleted.
  const updatedUser = await ctx.context.internalAdapter.findUserById(userId);
  if (!updatedUser) throw new APIError("UNAUTHORIZED", { code: "UNAUTHORIZED", message: "Unauthorized" });
  const made = await ctx.context.internalAdapter.createSession(userId, false, current.session as never);
  await setSessionCookie(ctx, { session: made, user: updatedUser });
  await ctx.context.internalAdapter.deleteSession(current.session.token);
  const trustCookie = ctx.context.createAuthCookie(TRUST_DEVICE_COOKIE_NAME, { maxAge: TRUST_DEVICE_MAX_AGE });
  const trusted = await ctx.getSignedCookie(trustCookie.name, ctx.context.secret);
  if (trusted) {
    const [, trustId] = trusted.split("!");
    if (trustId) await ctx.context.internalAdapter.deleteVerificationByIdentifier(trustId);
    expireCookie(ctx, trustCookie);
  }
  return answer(ctx, { status: true });
}

/**
 * Better Auth `hooks.before`: does a removal itself (see above) and returns the answer, which ends the
 * request; undefined lets the endpoint answer.
 */
export async function signInRemovalBody(db: Db, ctx: Ctx): Promise<Removal> {
  if (ctx.path !== PASSKEY_DELETE_PATH && ctx.path !== UNLINK_ACCOUNT_PATH && ctx.path !== TWO_FACTOR_DISABLE_PATH) return undefined;
  const current = await getSessionFromCtx(ctx).catch(() => null);
  // No session: the endpoint's own session check answers 401.
  if (!current?.user?.id || !current.session) return undefined;
  const caller: Caller = { userId: current.user.id, signInMethod: (current.session as { signInMethod?: unknown }).signInMethod };
  if (ctx.path === PASSKEY_DELETE_PATH) return deletePasskey(db, ctx, caller);
  if (ctx.path === UNLINK_ACCOUNT_PATH) return unlinkAccount(db, ctx, caller, current.session.createdAt);
  return disableTwoFactor(db, ctx, current as never);
}
