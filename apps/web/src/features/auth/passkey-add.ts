import type { MessageKey } from "@orrn/i18n";

import type { AuthClientError } from "./auth-errors";

/**
 * Adding a passkey (plan 2026-11-18, Task 5): the "Secure your sign-in" step, the closing screen's optional
 * prompt and Settings > Sign-in share these. Pure: the browser and the auth client come in as arguments
 * (`passkey-actions.ts` binds them).
 */

/** The device the passkey lives on, as its name in the Settings list. Proper names, the same in every language. */
export function defaultPasskeyName(userAgent: string): string | undefined {
  if (/iPhone/.test(userAgent)) return "iPhone";
  if (/iPad/.test(userAgent)) return "iPad";
  if (/Android/.test(userAgent)) return "Android";
  if (/CrOS/.test(userAgent)) return "Chromebook";
  if (/Macintosh|Mac OS X/.test(userAgent)) return "Mac";
  if (/Windows/.test(userAgent)) return "Windows";
  if (/Linux/.test(userAgent)) return "Linux";
  return undefined;
}

/**
 * Why adding a passkey failed, as words. The passkey client turns a closed sheet into
 * `ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY` (NotAllowedError) or `ERROR_CEREMONY_ABORTED`; the server asks for
 * a session younger than a day (`SESSION_NOT_FRESH`, the plugin's fresh-session rule). Server text is never shown.
 */
export function passkeyAddErrorKey(error: AuthClientError): MessageKey {
  if (!error) return "auth.errors.passkeyAddFailed";
  if (error instanceof Error) return error instanceof TypeError ? "errors.network" : "auth.errors.passkeyAddFailed";
  const code = error.code ?? "";
  if (error.status === 0) return "errors.network";
  if (error.status === 429 || code.startsWith("TOO_MANY")) return "auth.errors.tooMany";
  if (code === "ERROR_CEREMONY_ABORTED" || code === "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY") return "auth.errors.passkeyAddCancelled";
  if (code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED") return "auth.errors.passkeyExists";
  if (code === "SESSION_NOT_FRESH") return "auth.errors.signInAgain";
  // Council round 2 (N-C1): a weak session in a strict plant, for a person who already has a strong method.
  if (code === "STRONG_SIGN_IN_NEEDED") return "auth.login.strongSignInNeededPlant";
  return "auth.errors.passkeyAddFailed";
}

type AddPasskey = (opts: { name?: string }) => Promise<{ data: unknown; error: AuthClientError }>;

/**
 * Registers a passkey: first ends any passkey request still open in this tab (the sign-in page's autofill
 * request, Task 4), since the browser runs one at a time, then asks for the new one. Null when it was added,
 * else the message to show.
 */
export async function addPasskeyWith(add: AddPasskey, cancelPending: () => void, name: string | undefined): Promise<MessageKey | null> {
  cancelPending();
  try {
    const { data, error } = await add(name ? { name } : {});
    if (error || !data) return passkeyAddErrorKey(error);
    return null;
  } catch (thrown) {
    return passkeyAddErrorKey(thrown as Error);
  }
}
