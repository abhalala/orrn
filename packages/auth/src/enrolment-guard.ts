import type { createDb } from "@orrn/db";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";

import { isStrongSession, sessionOfRequest } from "./session-method";
import { hasStrongMethod, plantRequiresStrongSignIn, signInMethodsFor } from "./sign-in-methods";

/**
 * Council round 2 (Claude N-C1): in a plant that requires secure sign-in, a session made with a
 * password alone (or a sign-in link) is refused on every tenant call, but it could still ENROL a strong
 * method: turn on the authenticator app, add a passkey or link Google. Each of those makes (or upgrades)
 * the session to a strong one, so a phished password beat the policy, and left the attacker's own
 * factor on the account.
 *
 * So these requests are refused with `STRONG_SIGN_IN_NEEDED` when all three hold: the request's session
 * is not strong, the person already has a strong method, and an active plant they belong to requires
 * secure sign-in. A person with no strong method yet may still add their first one from a weak session:
 * that is the "Secure your sign-in" step's whole purpose. Anyone outside a strict plant is unaffected.
 *
 * The paths, from the two-factor and passkey plugins' endpoint lists (Better Auth 1.6.9):
 * - `/two-factor/enable` (makes the secret), `/two-factor/verify-totp` with a session (turns it on and
 *   remakes the session; without a session it is the code after a password, the strong sign-in itself),
 *   `/two-factor/get-totp-uri` and `/two-factor/generate-backup-codes` (hand out the existing secret or
 *   new backup codes, either of which signs in strongly later);
 * - `/passkey/generate-register-options` and `/passkey/verify-registration`;
 * - `/link-social` (Google); the redirect flow's callback is checked again where the link is written
 *   (`google-guard.ts`, `assertEnrolmentAllowed`).
 * Tested in packages/server/test/strong-sign-in-enforcement.test.ts.
 *
 * Council round 3 (Claude M1): the same rule holds for REMOVING a strong method (passkey delete, Google
 * unlink, authenticator off), so a phished password cannot strip the person's methods either. The
 * removals call this from `signInRemovalBody` (sign-in-removal.ts) with `removing: true`, which only
 * changes the server sentence. Tested in packages/server/test/auth-sign-in-methods.test.ts.
 */
export const STRONG_SIGN_IN_NEEDED = "STRONG_SIGN_IN_NEEDED";
const MESSAGE = "A plant you belong to needs a passkey, Google or your authenticator code. Sign in with one of them, then add this.";
const REMOVE_MESSAGE = "A plant you belong to needs a passkey, Google or your authenticator code. Sign in with one of them, then remove this.";

const ENROLMENT_PATHS = new Set([
  "/two-factor/enable",
  "/two-factor/verify-totp",
  "/two-factor/get-totp-uri",
  "/two-factor/generate-backup-codes",
  "/passkey/generate-register-options",
  "/passkey/verify-registration",
  "/link-social",
]);

type Db = ReturnType<typeof createDb>;
type Ctx = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];

/**
 * Refuses an enrolment (or, with `removing`, the removal of a strong method) from a weak session by a
 * person who has a strong method, in a strict plant.
 */
export async function assertEnrolmentAllowed(db: Db, input: { userId: string; signInMethod: unknown; removing?: boolean }): Promise<void> {
  if (isStrongSession(input.signInMethod)) return;
  if (!(await plantRequiresStrongSignIn(db, input.userId))) return;
  if (!hasStrongMethod(await signInMethodsFor(db, input.userId))) return;
  throw new APIError("FORBIDDEN", { code: STRONG_SIGN_IN_NEEDED, message: input.removing ? REMOVE_MESSAGE : MESSAGE });
}

/** Better Auth `hooks.before`. No session: the endpoint answers (401, or the code after a password). */
export async function enrolmentGuardBody(db: Db, ctx: Ctx): Promise<void> {
  if (!ctx.path || !ENROLMENT_PATHS.has(ctx.path)) return;
  const own = await sessionOfRequest(db, ctx);
  const current = own ?? (await getSessionFromCtx(ctx).catch(() => null))?.session ?? null;
  if (!current?.userId) return;
  await assertEnrolmentAllowed(db, { userId: current.userId, signInMethod: (current as { signInMethod?: unknown }).signInMethod });
}
