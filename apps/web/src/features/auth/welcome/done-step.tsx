import { useT, type MessageKey } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Check, KeyRound } from "lucide-react";
import { useId, useState, type Ref } from "react";

import { homeTarget } from "@/shared/lib/home";
import { useMe, type Me } from "@/shared/lib/me";
import { queryClient, trpc } from "@/shared/utils/trpc";

import { FormAlert } from "../form-alert";
import { addPasskeyHere } from "../passkey-actions";
import { passkeySupport } from "../passkey-support";
import { MethodError } from "../sign-in-again";
import { offerPasskeyOnDone } from "../welcome-steps";
import { finishesOnboardingHere } from "./finishes-onboarding";

/**
 * Last stage: one green block (the screen's loud element, with a single pop)
 * and the way in. People who can't change company settings finish their
 * onboarding here (`auth.completeOnboarding` with no company fields); owners
 * and admins already did in the company step. Then home, decided afresh.
 *
 * Under the way in, an optional "Add a passkey" for anyone without one whose device can make one (plan
 * Task 5; `offerPasskeyOnDone`). It sits below the main button and never holds anyone here.
 */
export function DoneStep({
  initialMe,
  joinedOnly,
  headingRef,
}: {
  initialMe: Me;
  /** Nothing else was asked: greet them into the company instead of "you're set up". */
  joinedOnly: boolean;
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  const { t } = useT();
  const navigate = useNavigate();
  const { data } = useMe();
  const me = (data as Me | undefined) ?? initialMe;
  const finish = useMutation(trpc.auth.completeOnboarding.mutationOptions());
  const [failed, setFailed] = useState(false);
  const [opening, setOpening] = useState(false);

  const company = me.company;
  const roleName = company ? t(`roles.${company.role}` as MessageKey) : "";
  const title = joinedOnly && company ? t("welcome.done.joinedTitle", { company: company.name }) : t("welcome.done.title");
  // The joined title already names the company, so the line carries only the role.
  const line = !company
    ? t("welcome.done.body")
    : joinedOnly
      ? t("welcome.done.joinedAs", { role: roleName })
      : t("welcome.done.as", { company: company.name, role: roleName });
  const goLabel = company ? t("welcome.done.go") : me.isPlatformAdmin && me.platformRole ? t("welcome.done.goAdmin") : t("welcome.done.goOther");

  async function go() {
    setFailed(false);
    setOpening(true);
    try {
      if (finishesOnboardingHere(me)) await finish.mutateAsync({});
      await queryClient.invalidateQueries(trpc.auth.me.queryFilter());
      const fresh = (await queryClient.fetchQuery(trpc.auth.me.queryOptions())) as Me;
      await navigate({ to: homeTarget(fresh), replace: true });
    } catch {
      setFailed(true);
      setOpening(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div
        role="status"
        className="orrn-block orrn-block-green orrn-block-hero orrn-block-sheen animate-pop flex min-h-[200px] flex-col justify-between gap-8 p-6"
      >
        <span aria-hidden="true" className="relative flex size-12 items-center justify-center rounded-full bg-tone-green-on/20">
          <Check className="size-7" strokeWidth={2} />
        </span>
        <span className="relative flex flex-col gap-2">
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="m-0 font-display text-[34px] font-extrabold leading-[1.02] tracking-[-0.04em] break-words sm:text-[44px]"
          >
            {title}
          </h1>
          <span className="text-[16px] font-medium leading-6 break-words">{line}</span>
        </span>
      </div>
      {failed ? <FormAlert>{t("errors.generic")}</FormAlert> : null}
      <Button size="lg" className="w-full" loading={opening} onClick={() => void go()}>
        {opening ? t("welcome.done.opening") : goLabel}
      </Button>
      <PasskeyOffer me={me} />
    </div>
  );
}

/** The optional passkey on the closing screen. Once added it says so and stays out of the way. */
function PasskeyOffer({ me }: { me: Me }) {
  const { t } = useT();
  const [available] = useState(() => passkeySupport().available);
  // Decided once, so the card does not vanish under the person the moment the passkey lands in `auth.me`.
  const [offered] = useState(() => offerPasskeyOnDone(me, available));
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const titleId = useId();
  const bodyId = useId();
  if (!offered) return null;

  async function add() {
    if (adding) return;
    setError(null);
    setAdding(true);
    const failure = await addPasskeyHere();
    setAdding(false);
    if (failure) setError(failure);
    else setAdded(true);
  }

  return (
    <section
      aria-labelledby={titleId}
      data-testid="done-passkey-offer"
      className="flex flex-col gap-3 rounded-card border border-border bg-card p-4 sm:p-5"
    >
      <div className="flex flex-col gap-1">
        <h2 id={titleId} className="m-0 text-[17px] font-semibold leading-6">
          {t("welcome.done.passkeyTitle")}
        </h2>
        <p id={bodyId} className="m-0 text-[14px] leading-5 text-muted-foreground break-words">
          {t("welcome.done.passkeyBody")}
        </p>
      </div>
      {added ? (
        <FormAlert tone="blue">{t("welcome.done.passkeyAdded")}</FormAlert>
      ) : (
        <Button variant="secondary" className="self-start" loading={adding} aria-describedby={bodyId} onClick={() => void add()}>
          {adding ? null : <KeyRound aria-hidden="true" />}
          {t("welcome.done.passkeyAdd")}
        </Button>
      )}
      {error ? <MethodError error={error} next="/welcome" /> : null}
    </section>
  );
}
