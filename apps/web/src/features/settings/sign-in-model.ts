import type { MessageKey } from "@orrn/i18n";

import type { AuthClientError } from "@/features/auth/auth-errors";

/**
 * Pure rules for Settings > Sign-in (plan 2026-11-18, Task 5). `canRemove` repeats the server's guard
 * (`signInRemovalBody`, packages/auth/src/sign-in-removal.ts) so a button can be disabled with the
 * reason shown before anyone presses it; the server stays the judge and its refusal is mapped to the same
 * words (`signInChangeErrorKey`).
 */

/** The ways an account signs in, as the server counts them (`SignInMethods`). */
export type Methods = { password: boolean; passkeys: number; google: boolean; authenticator: boolean };

export type RemoveTarget = "passkey" | "google" | "authenticator";

export type RemoveVerdict = { ok: true } | { ok: false; code: "LAST_SIGN_IN_METHOD" | "COMPANY_REQUIRES_STRONG_METHOD" };

/** A way in: a password, a passkey or Google. The authenticator app is a second factor only. */
const hasWayIn = (m: Methods) => m.password || m.passkeys > 0 || m.google;
/** A strong method: the authenticator app, a passkey or Google. */
const hasStrong = (m: Methods) => m.authenticator || m.passkeys > 0 || m.google;

/** What is left after removing one of `target`, or null when the account has none to remove. */
function after(m: Methods, target: RemoveTarget): Methods | null {
  if (target === "passkey") return m.passkeys > 0 ? { ...m, passkeys: m.passkeys - 1 } : null;
  if (target === "google") return m.google ? { ...m, google: false } : null;
  return m.authenticator ? { ...m, authenticator: false } : null;
}

/**
 * May the person remove one of `target`? `requiredByPlant`: an active plant of theirs requires secure
 * sign-in (`auth.signInMethods`). The last way in is checked first, as on the server.
 */
export function canRemove(methods: Methods, target: RemoveTarget, requiredByPlant: boolean): RemoveVerdict {
  const left = after(methods, target);
  if (!left) return { ok: true };
  if (hasWayIn(methods) && !hasWayIn(left)) return { ok: false, code: "LAST_SIGN_IN_METHOD" };
  if (requiredByPlant && hasStrong(methods) && !hasStrong(left)) return { ok: false, code: "COMPANY_REQUIRES_STRONG_METHOD" };
  return { ok: true };
}

/** `auth.signInMethods` (which lists the passkeys) as the counts `canRemove` reads. */
export function methodCounts(listed: { password: boolean; google: boolean; authenticator: boolean; passkeys: readonly unknown[] }): Methods {
  return { password: listed.password, google: listed.google, authenticator: listed.authenticator, passkeys: listed.passkeys.length };
}

/** The words for a refusal `canRemove` predicts. */
export const REMOVE_REASON: Record<Exclude<RemoveVerdict, { ok: true }>["code"], MessageKey> = {
  LAST_SIGN_IN_METHOD: "settings.signIn.reasonLast",
  COMPANY_REQUIRES_STRONG_METHOD: "settings.signIn.reasonPlant",
};

/**
 * A failed rename, remove, unlink or authenticator change, as words. Better Auth answers `{ code, status }`;
 * its message is English server text and is never shown.
 */
export function signInChangeErrorKey(error: AuthClientError): MessageKey {
  if (!error) return "errors.generic";
  if (error instanceof Error) return error instanceof TypeError ? "errors.network" : "errors.generic";
  const code = error.code ?? "";
  if (error.status === 0) return "errors.network";
  if (error.status === 429 || code.startsWith("TOO_MANY")) return "auth.errors.tooMany";
  if (code === "LAST_SIGN_IN_METHOD" || code === "COMPANY_REQUIRES_STRONG_METHOD") return REMOVE_REASON[code];
  if (code === "SESSION_NOT_FRESH") return "auth.errors.signInAgain";
  // Council r1 A2: another removal of this person's methods is still in flight.
  if (code === "SIGN_IN_CHANGE_BUSY") return "settings.signIn.busy";
  if (code === "INVALID_PASSWORD") return "welcome.twoFactor.wrongPassword";
  // Council round 2 (N-C1): adding a strong method from a weak session in a strict plant.
  if (code === "STRONG_SIGN_IN_NEEDED") return "auth.login.strongSignInNeededPlant";
  return "errors.generic";
}
