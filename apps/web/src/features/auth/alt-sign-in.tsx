import { useT, type MessageKey } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { useQuery } from "@tanstack/react-query";
import { KeyRound } from "lucide-react";
import { useEffect, useState } from "react";

import { authClient } from "@/shared/lib/auth-client";
import { INLINE_ERROR_META } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

import { signInErrorKey } from "./auth-errors";
import { FormAlert } from "./form-alert";
import { startGoogleSignIn } from "./google-sign-in";
import { passkeySupport } from "./passkey-support";

export type AltSignInProps = {
  /** Page to return to after sign-in; Google carries it through the redirect. */
  next?: string;
  /** The same finish as the password sign-in (`useFinishSignIn`, or the invite page's accept). */
  finish: () => Promise<void>;
  /** The message to show (owned by the form, so a password attempt clears it). */
  error: MessageKey | null;
  onError: (key: MessageKey | null) => void;
  /** A passkey attempt ended without signing in: the form starts the email field's autofill again. */
  onPasskeyEnded?: () => void;
  /** The password step is working: these wait. */
  disabled?: boolean;
};

/** Google's "G", the mark its sign-in guidelines ask for, on a white disc so it reads on any pill. */
function GoogleMark() {
  return (
    <span aria-hidden="true" className="inline-flex size-6 items-center justify-center rounded-full bg-white">
      <svg viewBox="0 0 48 48" className="size-4">
        <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
        <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
        <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
        <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
      </svg>
    </span>
  );
}

/**
 * "Sign in with a passkey" and "Continue with Google" (plan 2026-11-18). The owner's ruling (R5): they
 * stand level with the email + password form, same size and style as its button, under an "or". Each
 * shows only where it can work: the passkey button when the browser has WebAuthn, Google when the stage
 * has it configured (`auth.methods`). A cancelled passkey sheet or a refused Google account is an inline,
 * announced message; the form stays usable. Nothing here is a toast.
 */
export function AltSignIn({ next, finish, error, onError, onPasskeyEnded, disabled = false }: AltSignInProps) {
  const { t } = useT();
  const [passkeyAvailable] = useState(() => passkeySupport().available);
  // A failed read only hides Google (the other ways in still work): no global error toast on sign-in.
  const methods = useQuery({ ...trpc.auth.methods.queryOptions(), staleTime: Infinity, retry: false, meta: INLINE_ERROR_META });
  const google = methods.data?.google === true;
  const [busy, setBusy] = useState<"passkey" | "google" | null>(null);

  // Back from Google's page, the browser may show this page from its cache with the button still busy.
  useEffect(() => {
    const restored = (event: PageTransitionEvent) => {
      if (event.persisted) setBusy(null);
    };
    window.addEventListener("pageshow", restored);
    return () => window.removeEventListener("pageshow", restored);
  }, []);

  async function signInWithPasskey() {
    if (busy) return;
    onError(null);
    setBusy("passkey");
    let signedIn = false;
    try {
      const { data, error: failure } = await authClient.signIn.passkey();
      if (failure || !data) {
        onError(signInErrorKey(failure));
        return;
      }
      signedIn = true;
      await finish();
    } catch (thrown) {
      onError(signInErrorKey(thrown as Error));
    } finally {
      setBusy(null);
      if (!signedIn) onPasskeyEnded?.();
    }
  }

  async function continueWithGoogle() {
    if (busy) return;
    onError(null);
    setBusy("google");
    const failure = await startGoogleSignIn((body) => authClient.signIn.social(body), { origin: window.location.origin, next });
    // On success the page is leaving for Google; keep the button busy until it does.
    if (failure) {
      onError(signInErrorKey(failure));
      setBusy(null);
    }
  }

  const anyButton = passkeyAvailable || google;
  if (!anyButton && !error) return null;

  return (
    <div data-slot="alt-sign-in" className="flex flex-col gap-4">
      {anyButton ? (
        <div className="flex items-center gap-3 text-[14px] text-muted-foreground" aria-hidden="true">
          <span className="h-px flex-1 bg-border" />
          {t("auth.login.or")}
          <span className="h-px flex-1 bg-border" />
        </div>
      ) : null}
      {passkeyAvailable ? (
        <Button
          type="button"
          size="lg"
          className="w-full"
          data-testid="sign-in-passkey"
          loading={busy === "passkey"}
          disabled={disabled || busy === "google"}
          onClick={() => void signInWithPasskey()}
        >
          {busy === "passkey" ? null : <KeyRound aria-hidden="true" />}
          {t("auth.login.passkey")}
        </Button>
      ) : null}
      {google ? (
        <Button
          type="button"
          size="lg"
          className="w-full"
          data-testid="sign-in-google"
          loading={busy === "google"}
          disabled={disabled || busy === "passkey"}
          onClick={() => void continueWithGoogle()}
        >
          {busy === "google" ? null : <GoogleMark />}
          {t("auth.login.google")}
        </Button>
      ) : null}
      {error ? (
        <FormAlert>
          <span data-testid="alt-sign-in-error">{t(error)}</span>
        </FormAlert>
      ) : null}
    </div>
  );
}
