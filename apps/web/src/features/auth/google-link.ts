import type { MessageKey } from "@orrn/i18n";

/**
 * Linking Google to the signed-in account (plan 2026-11-18, Task 5): from Settings > Sign-in, and from
 * "Secure your sign-in" when the plant has Google. Better Auth sends the person back to the page that asked;
 * a failure comes back to the same page with `?error=CODE` appended.
 */
export function googleLinkUrls(origin: string, path: string): { callbackURL: string; errorCallbackURL: string } {
  // Only a path on the web origin: `//host` or a full URL would leave it.
  const safe = path.startsWith("/") && !path.startsWith("//") && !path.startsWith("/\\") ? path : "/";
  const url = new URL(safe, origin).toString();
  return { callbackURL: url, errorCallbackURL: url };
}

/**
 * The `?error=` of a link that failed, as words. Better Auth's own codes for linking (`email_doesn't_match`,
 * `account_already_linked_to_different_user`), the staff refusal (google-guard.ts), and every other code
 * as the generic link failure. The code itself is never shown.
 */
export function googleLinkErrorKey(code: string | undefined): MessageKey | null {
  if (!code) return null;
  if (code === "email_doesn't_match") return "auth.errors.googleLinkOtherEmail";
  if (code === "account_already_linked_to_different_user") return "auth.errors.googleLinkTaken";
  if (code === "GOOGLE_NOT_FOR_STAFF") return "auth.errors.googleNotForStaff";
  if (code === "STRONG_SIGN_IN_NEEDED") return "auth.login.strongSignInNeededPlant";
  return "auth.errors.googleLinkFailed";
}

type LinkSocial = (body: { provider: "google"; callbackURL: string; errorCallbackURL: string }) => Promise<{ data: unknown; error: unknown }>;

/**
 * Starts linking Google; on success Better Auth's client moves the page to Google, which comes back to
 * `path`. A start that fails comes back as the generic link failure (its text is never shown).
 */
export async function startGoogleLink(link: LinkSocial, origin: string, path: string): Promise<MessageKey | null> {
  try {
    const { error } = await link({ provider: "google", ...googleLinkUrls(origin, path) });
    if (!error) return null;
    // Council round 2 (N-C1): a weak session in a strict plant, for a person who already has a strong method.
    return (error as { code?: unknown }).code === "STRONG_SIGN_IN_NEEDED" ? "auth.login.strongSignInNeededPlant" : "auth.errors.googleLinkFailed";
  } catch {
    return "auth.errors.googleLinkFailed";
  }
}

/** What the account has now, from `auth.signInMethods` (passkeys as a count). */
export type LinkMethods = { password: boolean; passkeys: number; authenticator: boolean };
export type LinkRemoval = { key: MessageKey; count?: number };

/**
 * Council round 1, A9: linking Google to an account whose email was never confirmed removes the password,
 * every passkey and the authenticator app, and signs out every other device (google-guard.ts
 * `onGoogleLink`). The warning lists only what this account has; other devices always go. When the list
 * is unknown (it did not load), it names everything that could go.
 */
export function linkRemovals(methods: LinkMethods | undefined): LinkRemoval[] {
  const m = methods ?? { password: true, passkeys: 2, authenticator: true };
  const out: LinkRemoval[] = [];
  if (m.password) out.push({ key: "settings.signIn.linkWipesPassword" });
  if (m.passkeys > 0) out.push({ key: "settings.signIn.linkWipesPasskeys", count: m.passkeys });
  if (m.authenticator) out.push({ key: "settings.signIn.linkWipesAuthenticator" });
  out.push({ key: "settings.signIn.linkWipesDevices" });
  return out;
}
