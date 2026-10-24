import type { createDb } from "@orrn/db";
import { APIError, createAuthMiddleware } from "better-auth/api";

/**
 * FP-PF-08 (C27): a magic link never stands in for the second factor. A link is a full session
 * without a password or an authenticator code, so it may only sign in an account that has
 * neither: an owner approved from the waitlist who has not set a password yet (Godseye issues
 * those links server-side and refuses owners with a password, T27). Anyone else, including a
 * request to the public `/sign-in/magic-link` endpoint for a password + TOTP user, gets the link
 * refused at `/magic-link/verify` and the token deleted.
 */
export const MAGIC_LINK_REFUSED = "This account signs in with its password and authenticator code";

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

/** Better Auth `hooks.before`: refuse `/magic-link/verify` for accounts with a password or 2FA. */
export function magicLinkSecondFactorGuard(db: Db) {
  return createAuthMiddleware(async (ctx) => {
    if (ctx.path !== "/magic-link/verify") return;
    const token = typeof ctx.query?.token === "string" ? ctx.query.token : null;
    if (!token) return;
    const stored = await ctx.context.internalAdapter.findVerificationValue(token);
    if (!stored) return;
    let email: unknown;
    try {
      email = (JSON.parse(stored.value) as { email?: unknown }).email;
    } catch {
      return;
    }
    if (typeof email !== "string" || (await magicLinkAllowed(db, email))) return;
    await ctx.context.internalAdapter.deleteVerificationByIdentifier(token);
    throw new APIError("FORBIDDEN", { message: MAGIC_LINK_REFUSED });
  });
}
