/**
 * What this browser can do with passkeys (plan 2026-11-18). `available`: WebAuthn exists, so the
 * "Sign in with a passkey" button may show; a browser without it (an old Android WebView, Firefox with
 * WebAuthn turned off) never sees a button that cannot work. `conditional`: the browser can offer saved
 * passkeys from the email field's autofill (conditional mediation); false when it cannot say.
 */
export type PasskeySupport = { available: boolean; conditional: Promise<boolean> };

type CredentialCtor = { isConditionalMediationAvailable?: () => Promise<boolean> };

export function passkeySupport(win: Window | undefined = typeof window === "undefined" ? undefined : window): PasskeySupport {
  const ctor = (win as { PublicKeyCredential?: unknown } | undefined)?.PublicKeyCredential;
  if (typeof ctor !== "function") return { available: false, conditional: Promise.resolve(false) };
  const check = (ctor as CredentialCtor).isConditionalMediationAvailable;
  const conditional =
    typeof check === "function"
      ? Promise.resolve()
          .then(() => check.call(ctor))
          .then((yes) => yes === true)
          .catch(() => false)
      : Promise.resolve(false);
  return { available: true, conditional };
}
