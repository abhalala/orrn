import { useT, type MessageKey } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { useState, type Ref } from "react";

import { homeTarget } from "@/shared/lib/home";
import { useMe, type Me } from "@/shared/lib/me";
import { queryClient, trpc } from "@/shared/utils/trpc";

import { FormAlert } from "../form-alert";
import { finishesOnboardingHere } from "./finishes-onboarding";

/**
 * Last stage: one green block (the screen's loud element, with a single pop)
 * and the way in. People who can't change company settings finish their
 * onboarding here (`auth.completeOnboarding` with no company fields); owners
 * and admins already did in the company step. Then home, decided afresh.
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
    </div>
  );
}
