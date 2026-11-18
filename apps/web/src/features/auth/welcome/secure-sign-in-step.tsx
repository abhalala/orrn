import { useT, type MessageKey } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { KeyRound, Smartphone } from "lucide-react";
import { useId, useState, type Ref } from "react";

import { INLINE_ERROR_META } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

import { GoogleLinkButton } from "../google-link-button";
import { addPasskeyHere } from "../passkey-actions";
import { passkeySupport } from "../passkey-support";
import { MethodError } from "../sign-in-again";
import { secureSignInChoices, type SecureSignInChoice } from "../welcome-steps";
import { StepHeading } from "./step-heading";
import { TwoFactorStep } from "./two-factor-step";

/**
 * "Secure your sign-in" (owner amendment 2026-11-18, item 3; plan Task 5): the mandatory step when the
 * active plant requires secure sign-in and the person has no passkey, Google or authenticator app. It offers
 * a passkey first when this device can make one, then the authenticator app, then Google when the stage has
 * it. Any one of them finishes the step; the stepper only hears `onDone`. With the authenticator app as the
 * only choice it opens straight on it, as before. The authenticator flow mounts only once picked, because it
 * makes a new secret as soon as it has the password. A Google link leaves for Google and comes back to
 * /welcome, which works the steps out afresh (`linkError`: the `?error=` of a link that failed).
 */
export function SecureSignInStep({
  userId,
  email,
  password,
  plantName,
  linkError,
  onDone,
  headingRef,
}: {
  userId: string;
  email: string;
  /** The password just set in the password step, if any (two-factor setup needs it). */
  password: string | null;
  /** The plant whose policy asks for it. */
  plantName: string;
  linkError: MessageKey | null;
  onDone(): void;
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  const { t } = useT();
  const [passkeyAvailable] = useState(() => passkeySupport().available);
  // A failed read only hides Google: the other choices still work.
  const methods = useQuery({ ...trpc.auth.methods.queryOptions(), staleTime: Infinity, retry: false, meta: INLINE_ERROR_META });
  const google = methods.data?.google === true;
  const own = useQuery({ ...trpc.auth.signInMethods.queryOptions(), enabled: google, meta: INLINE_ERROR_META });
  const choices = secureSignInChoices({ passkey: passkeyAvailable, google });
  const [picked, setPicked] = useState<SecureSignInChoice | null>(null);
  const [error, setError] = useState<MessageKey | null>(linkError);
  const [adding, setAdding] = useState(false);
  const hintIds = { passkey: useId(), authenticator: useId(), google: useId() };

  const lead = t("welcome.secure.required", { company: plantName });

  // Without a passkey the choices hang on Google: wait for the answer rather than open the authenticator
  // flow (and make a secret) and then swap it for the list.
  if (!passkeyAvailable && methods.isPending) {
    return (
      <div role="status" aria-busy="true" className="flex flex-col gap-5">
        <span className="sr-only">{t("common.loading")}</span>
        <Skeleton className="h-10 w-3/4" />
        <Skeleton className="h-14 w-full" />
      </div>
    );
  }

  if (picked === "authenticator" || choices.length === 1) {
    return (
      <TwoFactorStep
        headingRef={headingRef}
        userId={userId}
        password={password}
        onDone={onDone}
        title={t("welcome.secure.title")}
        lead={lead}
        footer={
          choices.length > 1 ? (
            <Button variant="ghost" className="self-center text-muted-foreground" onClick={() => setPicked(null)}>
              {t("welcome.secure.otherWay")}
            </Button>
          ) : null
        }
      />
    );
  }

  async function addPasskey() {
    if (adding) return;
    setError(null);
    setAdding(true);
    const failure = await addPasskeyHere();
    setAdding(false);
    if (failure) setError(failure);
    else onDone();
  }

  const hint = (choice: SecureSignInChoice) =>
    choice === "passkey"
      ? t("welcome.secure.passkeyHint")
      : choice === "authenticator"
        ? t("welcome.secure.authenticatorHint")
        : t("welcome.secure.googleHint", { email });

  return (
    <div className="flex flex-col gap-6" data-testid="secure-sign-in-choices">
      <StepHeading headingRef={headingRef} title={t("welcome.secure.title")} />
      <div className="-mt-3 flex max-w-[52ch] flex-col gap-1">
        <p data-testid="secure-sign-in-lead" className="m-0 text-[15px] leading-6 font-medium text-foreground">
          {lead}
        </p>
        <p className="m-0 text-[15px] leading-6 text-muted-foreground">{t("welcome.secure.choose")}</p>
      </div>
      <ul className="m-0 flex list-none flex-col gap-5 p-0">
        {choices.map((choice, index) => {
          const variant = index === 0 ? "primary" : "secondary";
          return (
            <li key={choice} className="flex flex-col gap-2">
              {choice === "passkey" ? (
                <Button
                  size="lg"
                  variant={variant}
                  className="w-full"
                  loading={adding}
                  aria-describedby={hintIds.passkey}
                  data-testid="secure-passkey"
                  onClick={() => void addPasskey()}
                >
                  {adding ? null : <KeyRound aria-hidden="true" />}
                  {t("welcome.secure.passkey")}
                </Button>
              ) : choice === "authenticator" ? (
                <Button
                  size="lg"
                  variant={variant}
                  className="w-full"
                  disabled={adding}
                  aria-describedby={hintIds.authenticator}
                  data-testid="secure-authenticator"
                  onClick={() => setPicked("authenticator")}
                >
                  <Smartphone aria-hidden="true" />
                  {t("welcome.secure.authenticator")}
                </Button>
              ) : (
                <GoogleLinkButton
                  path="/welcome"
                  size="lg"
                  variant={variant}
                  className="w-full"
                  // A failed read asks first, with the warning, rather than leave the button off for good.
                  emailVerified={own.isError ? false : own.data?.emailVerified}
                  methods={
                    own.data
                      ? { password: own.data.password, passkeys: own.data.passkeys.length, authenticator: own.data.authenticator }
                      : undefined
                  }
                  disabled={adding}
                  describedBy={hintIds.google}
                  onError={setError}
                />
              )}
              <p id={hintIds[choice]} className="m-0 text-center text-[14px] leading-5 text-muted-foreground break-words">
                {hint(choice)}
              </p>
            </li>
          );
        })}
      </ul>
      {error ? <MethodError error={error} next="/welcome" /> : null}
    </div>
  );
}
