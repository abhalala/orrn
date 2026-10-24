import type { createDb } from "@orrn/db";
import { APIError, createAuthMiddleware } from "better-auth/api";

/**
 * FP-PF-08 (C27): a magic link never stands in for the second factor. A link is a full session
 * without a password or an authenticator code, so it may only sign in an account that has
 * neither: an owner approved from the waitlist who has not set a password yet (Godseye issues
 * those links server-side and refuses owners with a password, T27). Any other account gets the
 * link refused at `/magic-link/verify` and the token deleted, and so does a stale owner link once
 * the password exists.
 *
 * D14: the public `POST /sign-in/magic-link` is refused outright. No web or native screen asks for
 * a link, and Godseye writes owner links straight into `verification`; an open endpoint would only
 * let password-less owners mint links forever and let anyone send mail to any address. With
 * `disableSignUp: true` (index.ts) a link for an unknown email creates nothing.
 */
export const MAGIC_LINK_REFUSED = "This account signs in with its password and authenticator code";
export const MAGIC_LINK_REQUEST_REFUSED = "Sign-in links are sent by ORRN only. Sign in with your password and authenticator code";

/** The paths the guard acts on (Better Auth `ctx.path`: the endpoint path, no query). */
export const MAGIC_LINK_REQUEST_PATH = "/sign-in/magic-link";
export const MAGIC_LINK_VERIFY_PATH = "/magic-link/verify";

/** Better Auth's magic-link `storeToken: "hashed"` form: SHA-256, base64url, no padding. */
export async function hashMagicLinkToken(token: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));
  let binary = "";
  for (const byte of digest) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

type Db = ReturnType<typeof createDb>;

/** True when `email` may sign in by link: no account yet, or no password and no second factor. */
export async function magicLinkAllowed(db: Db, email: string): Promise<boolean> {
  const found = await db.query.user.findFirst({
    columns: { id: true, twoFactorEnabled: true },
    where: (u, { eq }) => eq(u.email, email.trim().toLowerCase()),
  });
  if (!found) return true;
  if (found.twoFactorEnabled) return false;
  const credential = await db.query.account.findFirst({
    columns: { id: true },
    where: (a, { and, eq, isNotNull }) => and(eq(a.userId, found.id), eq(a.providerId, "credential"), isNotNull(a.password)),
  });
  return !credential;
}

/**
 * Better Auth `hooks.before`: refuse the public link request, and refuse `/magic-link/verify` for
 * accounts with a password or 2FA. The token is looked up as stored plain (the default, and what
 * Godseye writes) and, failing that, as stored hashed, so changing `storeToken` cannot let a link
 * slip past the guard while the plugin still finds it.
 */
export function magicLinkSecondFactorGuard(db: Db) {
  return createAuthMiddleware(async (ctx) => {
    if (ctx.path === MAGIC_LINK_REQUEST_PATH) {
      throw new APIError("FORBIDDEN", { message: MAGIC_LINK_REQUEST_REFUSED });
    }
    if (ctx.path !== MAGIC_LINK_VERIFY_PATH) return;
    const token = typeof ctx.query?.token === "string" ? ctx.query.token : null;
    if (!token) return;
    let identifier = token;
    let stored = await ctx.context.internalAdapter.findVerificationValue(identifier);
    if (!stored) {
      identifier = await hashMagicLinkToken(token);
      stored = await ctx.context.internalAdapter.findVerificationValue(identifier);
    }
    // Neither form exists: the plugin (plain or hashed storage) finds nothing either and answers
    // INVALID_TOKEN itself.
    if (!stored) return;
    let email: unknown;
    try {
      email = (JSON.parse(stored.value) as { email?: unknown }).email;
    } catch {
      return;
    }
    if (typeof email !== "string" || (await magicLinkAllowed(db, email))) return;
    await ctx.context.internalAdapter.deleteVerificationByIdentifier(identifier);
    throw new APIError("FORBIDDEN", { message: MAGIC_LINK_REFUSED });
  });
}
