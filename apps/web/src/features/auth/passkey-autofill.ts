import type { AuthenticationResponseJSON, PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";

/**
 * Saved passkeys in the email field's autofill (conditional mediation) on /login, with the auth client and
 * the browser passed in so bun tests the order (`sign-in-form.tsx` binds the real ones).
 *
 * The same three steps as `@better-auth/passkey`'s `signIn.passkey({ autoFill: true })`: the challenge
 * (`/passkey/generate-authenticate-options`), the browser request (`startAuthentication` with
 * `useBrowserAutofill`), then `/passkey/verify-authentication` with the response minus
 * `clientExtensionResults`, then the session signal. Done here because the plugin's one call cannot be
 * stopped between the challenge and the browser request: a cleanup that ran while the challenge was in
 * flight found no ceremony to cancel, and the browser request started afterwards and outlived the page
 * (council r1, B5; Gemini I2). Now each step first checks the form still wants it.
 *
 * One window stays inside `startAuthentication` (its own await before it makes the abort signal); its
 * check for an `autocomplete="… webauthn"` field closes it when the page or the step goes, as that field
 * goes with them.
 */

type AuthError = { code?: string; status?: number; message?: string } | null | undefined;
type Answer = { data: unknown; error: AuthError };

export type PasskeyAutofillDeps = {
  /** The browser can offer saved passkeys from autofill (`passkeySupport().conditional`). */
  conditional: Promise<boolean>;
  fetchOptions(): Promise<Answer>;
  start(options: PublicKeyCredentialRequestOptionsJSON): Promise<AuthenticationResponseJSON>;
  verify(response: Omit<AuthenticationResponseJSON, "clientExtensionResults">): Promise<Answer>;
  /** The auth client's `$sessionSignal`, as the plugin sends after every verify. */
  signedIn(): void;
  /** `WebAuthnAbortService.cancelCeremony()`. */
  cancel(): void;
};

/**
 * `signedIn`: a picked passkey signed in. `refused`: the server refused the picked passkey (the form
 * decides which codes it shows). A failed challenge or a cancelled browser request reports nothing.
 */
export type PasskeyAutofillResult = { kind: "signedIn" } | { kind: "refused"; error: NonNullable<AuthError> };

/** Starts the ceremony; the returned function stops it (the effect's cleanup). */
export function startPasskeyAutofill(deps: PasskeyAutofillDeps, onResult: (result: PasskeyAutofillResult) => void): () => void {
  let live = true;

  void (async () => {
    if (!(await deps.conditional) || !live) return;
    let options: Answer;
    try {
      options = await deps.fetchOptions();
    } catch {
      return;
    }
    // Stopped while the challenge was in flight: the browser request must not start.
    if (!live || !options.data) return;

    let response: AuthenticationResponseJSON;
    try {
      response = await deps.start(options.data as PublicKeyCredentialRequestOptionsJSON);
    } catch {
      // Cancelled (the step changed, the page went, or the passkey button took over): nothing to say.
      return;
    }
    if (!live) return;

    const { clientExtensionResults: _results, ...body } = response;
    let verified: Answer;
    try {
      verified = await deps.verify(body);
    } catch {
      return;
    }
    deps.signedIn();
    if (!live) return;
    if (verified.error) return onResult({ kind: "refused", error: verified.error });
    if (verified.data) onResult({ kind: "signedIn" });
  })();

  return () => {
    live = false;
    deps.cancel();
  };
}
