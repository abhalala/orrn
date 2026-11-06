import type { createDb } from "@orrn/db";
import { invite } from "@orrn/db/schema/tenant";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { eq } from "drizzle-orm";

/**
 * Security review 2026-11-04, HIGH 3. ORRN has no public sign-up: accounts come from an approved
 * access request (Godseye) or an invite (AGENTS.md, D14). `POST /sign-up/email` over HTTP is
 * therefore refused unless the body carries `inviteToken`, the token of a live invite (not
 * accepted, revoked or expired) for exactly that email. The invite pages send it.
 *
 * In-process calls (`auth.api.signUpEmail({ body })` from server code: Godseye staff accounts and
 * the dev seed) carry no request and no headers, and are not refused: they are not reachable
 * from outside. Anything that passes a request or headers counts as outside.
 */
export const SIGN_UP_PATH = "/sign-up/email";
export const SIGN_UP_NEEDS_INVITE = "Accounts are made from an invite. Open the invite link you were sent.";
export const SIGN_UP_INVITE_NOT_VALID = "This invite link has expired or was already used. Ask your admin for a new one.";
export const SIGN_UP_INVITE_EMAIL_MISMATCH = "This invite is for a different email. Use the email the invite was sent to.";

type Db = ReturnType<typeof createDb>;
type GuardCtx = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function refuse(code: string, message: string): never {
  throw new APIError("FORBIDDEN", { code, message });
}

/** Refuses an HTTP sign-up without a live invite for that email; returns for everything else. */
export async function signUpGuardBody(db: Db, ctx: GuardCtx, now: Date = new Date()): Promise<void> {
  if (ctx.path !== SIGN_UP_PATH) return;
  if (!ctx.request && !ctx.headers) return;

  const body = (ctx.body ?? {}) as { email?: unknown; inviteToken?: unknown };
  const token = typeof body.inviteToken === "string" ? body.inviteToken.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!token) refuse("SIGN_UP_NEEDS_INVITE", SIGN_UP_NEEDS_INVITE);

  const row = await db
    .select({ email: invite.email, expiresAt: invite.expiresAt, acceptedAt: invite.acceptedAt, revokedAt: invite.revokedAt })
    .from(invite)
    .where(eq(invite.tokenHash, await sha256Hex(token)))
    .get();
  if (!row || row.acceptedAt || row.revokedAt || row.expiresAt.getTime() < now.getTime()) {
    refuse("SIGN_UP_INVITE_NOT_VALID", SIGN_UP_INVITE_NOT_VALID);
  }
  if (!email || row.email.toLowerCase() !== email) refuse("SIGN_UP_INVITE_EMAIL_MISMATCH", SIGN_UP_INVITE_EMAIL_MISMATCH);
}
