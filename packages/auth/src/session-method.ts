import type { createDb } from "@orrn/db";
import { session } from "@orrn/db/schema/auth";
import { and, eq } from "drizzle-orm";

/**
 * How a session was made (council round 1, A4; spec "Amendment 2: enforcement"). A plant that
 * requires secure sign-in (`company.settings.requireStrongSignIn`) accepts a session only when it was
 * made with a strong method: a passkey, Google or the authenticator code (a backup code counts as the
 * code). A password alone, a sign-in link or anything else does not. `companyProcedure` reads it.
 *
 * Better Auth 1.6.9 paths that make a session:
 * - `/passkey/verify-authentication` (the passkey plugin's sign-in);
 * - `/callback/:id` (Google redirect flow) and `/sign-in/social` (Google id token);
 * - `/two-factor/verify-totp` and `/two-factor/verify-backup-code` (the code after a password, and
 *   turning the authenticator app on, which remakes the session);
 * - `/sign-in/email` and `/sign-up/email` (password);
 * - `/magic-link/verify` (a sign-in link).
 * `/two-factor/verify-otp` is an emailed one-time code (not set up in ORRN): it is not the
 * authenticator app, so it never counts. Any other path that makes a session (two-factor off, which
 * remakes it) keeps the value Better Auth carried over from the session it replaced, else "other".
 */
export const SIGN_IN_METHODS = ["passkey", "google", "totp", "password", "magicLink", "other"] as const;
export type SignInMethod = (typeof SIGN_IN_METHODS)[number];

/** The methods a plant that requires secure sign-in accepts. */
export const STRONG_SIGN_IN_METHODS = ["passkey", "google", "totp"] as const satisfies readonly SignInMethod[];

const STRONG: ReadonlySet<string> = new Set<SignInMethod>(STRONG_SIGN_IN_METHODS);

/** True for a session made with a passkey, Google or the authenticator code. */
export const isStrongSession = (method: unknown): boolean => typeof method === "string" && STRONG.has(method);

const BY_PATH: Readonly<Record<string, SignInMethod>> = {
  "/passkey/verify-authentication": "passkey",
  "/callback/:id": "google",
  "/sign-in/social": "google",
  "/two-factor/verify-totp": "totp",
  "/two-factor/verify-backup-code": "totp",
  "/sign-in/email": "password",
  "/sign-up/email": "password",
  "/magic-link/verify": "magicLink",
};

/** The method a session made on `path` gets, or null when the path does not decide it. */
export function signInMethodForPath(path: string | undefined | null): SignInMethod | null {
  return (path && BY_PATH[path]) || null;
}

type Db = ReturnType<typeof createDb>;
type HookCtx = { path?: string } | null | undefined;

/**
 * `databaseHooks.session.create.before`: stamps the method. A path that decides it wins (a
 * remade session after the authenticator code is "totp" even though it was carried from a password
 * session). Otherwise the carried value stays, and a session with none is "other".
 */
export function stampSignInMethod(data: Record<string, unknown>, ctx: HookCtx): { data: { signInMethod: SignInMethod } } {
  const decided = signInMethodForPath(ctx?.path);
  const carried = typeof data.signInMethod === "string" && (SIGN_IN_METHODS as readonly string[]).includes(data.signInMethod)
    ? (data.signInMethod as SignInMethod)
    : null;
  return { data: { signInMethod: decided ?? carried ?? "other" } };
}

/**
 * The person just proved a strong method inside this session (added a passkey, linked Google): this
 * session counts as made with it from now on. Only the session's own user is changed. Never throws.
 */
export async function upgradeSession(db: Db, input: { sessionId: string; userId: string; method: SignInMethod }): Promise<void> {
  try {
    await db
      .update(session)
      .set({ signInMethod: input.method })
      .where(and(eq(session.id, input.sessionId), eq(session.userId, input.userId)));
  } catch (error) {
    console.error("session sign-in method not upgraded", error instanceof Error ? error.name : "unknown");
  }
}

/** Paths that make a session as part of an enrolment when the request already holds a session of the person. */
const REMAKE_WHEN_SIGNED_IN: ReadonlySet<string> = new Set(["/two-factor/verify-totp", "/two-factor/verify-backup-code"]);

type DbHookCtx = {
  path?: string;
  headers?: Headers;
  request?: Request;
  context?: { authCookies?: { sessionToken?: { name?: string } } };
} | null | undefined;

/** The live session row the request's session cookie names, for this user. The value is `<token>.<signature>`. */
async function liveSessionOfCookie(db: Db, ctx: DbHookCtx, userId: unknown): Promise<{ createdAt: Date } | null> {
  const name = ctx?.context?.authCookies?.sessionToken?.name;
  const header = ctx?.headers?.get("cookie") ?? ctx?.request?.headers.get("cookie") ?? "";
  if (!name || !header || typeof userId !== "string") return null;
  for (const part of header.split(";")) {
    const at = part.indexOf("=");
    if (at === -1 || part.slice(0, at).trim() !== name) continue;
    const raw = decodeURIComponent(part.slice(at + 1).trim());
    const token = raw.includes(".") ? raw.slice(0, raw.lastIndexOf(".")) : raw;
    if (!token) return null;
    const row = await db
      .select({ createdAt: session.createdAt, expiresAt: session.expiresAt })
      .from(session)
      .where(and(eq(session.token, token), eq(session.userId, userId)))
      .get();
    return row && row.expiresAt.getTime() > Date.now() ? { createdAt: row.createdAt } : null;
  }
  return null;
}

/**
 * `databaseHooks.session.create.before` (delta round, D-L4): the method (`stampSignInMethod`), and `createdAt` kept from
 * the session a request remakes. Better Auth stamps every new session `createdAt = now`, also the ones it remakes from
 * the request's own session without a sign-in: turning the authenticator app on (`/two-factor/verify-totp` with a
 * session), turning it off, a password change that signs out elsewhere. `createdAt` is what the buddy's 10-minute fresh
 * sign-in check reads (`buddy.grant.create` / `renew`), so a held session must not get a fresh one by enrolling or
 * removing a factor. A real sign-in (a path in `BY_PATH`, the code after a password without a session) stays fresh, even
 * when the browser was signed in already. Only the request's own live session of the same person is carried; the
 * cookie's signature is not needed, because carrying can only make a session older. Never throws.
 */
export async function stampSession(
  db: Db,
  data: Record<string, unknown>,
  ctx: DbHookCtx,
): Promise<{ data: { signInMethod: SignInMethod; createdAt?: Date } }> {
  const stamped = stampSignInMethod(data, ctx);
  const path = ctx?.path ?? "";
  try {
    const realSignInPath = signInMethodForPath(path) !== null && !REMAKE_WHEN_SIGNED_IN.has(path);
    if (realSignInPath) return stamped;
    const held = await liveSessionOfCookie(db, ctx, data.userId);
    if (!held) return stamped;
    return { data: { ...stamped.data, createdAt: held.createdAt } };
  } catch (error) {
    console.error("session createdAt not carried", error instanceof Error ? error.name : "unknown");
    return stamped;
  }
}

type AfterCtx = {
  path?: string;
  context: { returned?: unknown; newSession?: { session: { id: string; userId: string }; user: { id: string; twoFactorEnabled?: boolean | null } } | null };
};

export const PASSKEY_ADDED_PATH = "/passkey/verify-registration";

/**
 * Better Auth `hooks.after` (runs before the plugins' own after-hooks). Never throws.
 * - A passkey added in this session upgrades it to "passkey".
 * - A password sign-in that keeps its session although the account has the authenticator app on is a
 *   device the person marked as trusted after typing the code ("Trust this device"); the two-factor
 *   plugin's after-hook keeps that session, so it counts as "totp". When the device is not trusted,
 *   the plugin deletes the session right after and nothing is left to count.
 */
export async function sessionMethodAfter(
  db: Db,
  ctx: AfterCtx,
  currentSession: () => Promise<{ id: string; userId: string } | null>,
): Promise<void> {
  try {
    if (ctx.path === PASSKEY_ADDED_PATH) {
      const created = returnedObject(ctx.context.returned);
      if (typeof created?.id !== "string" || typeof created.userId !== "string") return;
      const current = await currentSession();
      if (!current || current.userId !== created.userId) return;
      await upgradeSession(db, { sessionId: current.id, userId: created.userId, method: "passkey" });
      return;
    }
    if (ctx.path === "/sign-in/email") {
      const made = ctx.context.newSession;
      if (!made?.user.twoFactorEnabled) return;
      await upgradeSession(db, { sessionId: made.session.id, userId: made.user.id, method: "totp" });
    }
  } catch (error) {
    console.error("session sign-in method after-hook failed", error instanceof Error ? error.name : "unknown");
  }
}

/** The endpoint's answer: in-process calls get the object, the HTTP handler a `{ body, _flag: "json" }` wrapper. */
function returnedObject(returned: unknown): Record<string, unknown> | null {
  if (!returned || typeof returned !== "object" || returned instanceof Response) return null;
  const value = returned as Record<string, unknown>;
  if (value._flag === "json") {
    const body = value.body;
    return body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  }
  return value;
}

type CookieCtx = {
  getSignedCookie?: (name: string, secret: string) => Promise<string | null | false>;
  context?: { secret?: string; authCookies?: { sessionToken?: { name?: string } } };
};

/**
 * The live session the request's own session cookie names, read straight from the signed cookie and
 * the `session` row. Better Auth's `getSessionFromCtx` answered null inside the Google callback's GET,
 * so the hooks that upgrade a session use this instead. Null when there is no cookie, it is not signed
 * with our secret, or the session has ended.
 */
export async function sessionOfRequest(db: Db, ctx: unknown): Promise<{ id: string; userId: string; signInMethod: string | null } | null> {
  try {
    const c = ctx as CookieCtx | null;
    const name = c?.context?.authCookies?.sessionToken?.name;
    const secret = c?.context?.secret;
    if (!c?.getSignedCookie || !name || !secret) return null;
    const token = await c.getSignedCookie(name, secret);
    if (!token) return null;
    const row = await db
      .select({ id: session.id, userId: session.userId, expiresAt: session.expiresAt, signInMethod: session.signInMethod })
      .from(session)
      .where(eq(session.token, token))
      .get();
    return row && row.expiresAt.getTime() > Date.now() ? { id: row.id, userId: row.userId, signInMethod: row.signInMethod ?? null } : null;
  } catch {
    return null;
  }
}
