import { useT, type MessageKey } from "@orrn/i18n";
import { Button, type ButtonVariant } from "@orrn/ui/components/button";
import { Dialog } from "@orrn/ui/components/dialog";
import { useEffect, useState } from "react";

import { authClient } from "@/shared/lib/auth-client";

import { GoogleMark } from "./alt-sign-in";
import { startGoogleLink } from "./google-link";

/**
 * "Link Google" for the signed-in person (Settings > Sign-in, "Secure your sign-in"). Google comes back to
 * `path`. Linking Google to an account whose email was never confirmed removes its password, passkeys and
 * authenticator app first (packages/auth google-guard.ts), so then it asks before leaving for Google.
 */
export function GoogleLinkButton({
  path,
  emailVerified,
  variant = "secondary",
  size,
  className,
  describedBy,
  onError,
}: {
  path: string;
  /** From `auth.signInMethods`; the button waits while it is unknown. */
  emailVerified: boolean | undefined;
  variant?: ButtonVariant;
  size?: "md" | "lg";
  className?: string;
  describedBy?: string;
  onError(key: MessageKey | null): void;
}) {
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);

  // Back from Google's page, the browser may show this page from its cache with the button still busy.
  useEffect(() => {
    const restored = (event: PageTransitionEvent) => {
      if (event.persisted) setBusy(false);
    };
    window.addEventListener("pageshow", restored);
    return () => window.removeEventListener("pageshow", restored);
  }, []);

  async function go() {
    setAsking(false);
    onError(null);
    setBusy(true);
    const failure = await startGoogleLink((body) => authClient.linkSocial(body), window.location.origin, path);
    // On success the page is leaving for Google; keep the button busy until it does.
    if (failure) {
      onError(failure);
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={size}
        className={className}
        loading={busy}
        disabled={emailVerified === undefined}
        aria-describedby={describedBy}
        data-testid="link-google"
        onClick={() => (emailVerified === false ? setAsking(true) : void go())}
      >
        {busy ? null : <GoogleMark />}
        {t("settings.signIn.linkGoogle")}
      </Button>
      <Dialog
        open={asking}
        onOpenChange={setAsking}
        title={t("settings.signIn.linkTitle")}
        description={t("settings.signIn.linkWipes")}
        actions={
          <>
            <Button variant="secondary" onClick={() => setAsking(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={() => void go()}>{t("settings.signIn.linkGoogle")}</Button>
          </>
        }
      />
    </>
  );
}
