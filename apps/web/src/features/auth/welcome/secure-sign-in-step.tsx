import { useT } from "@orrn/i18n";
import type { Ref } from "react";

import { TwoFactorStep } from "./two-factor-step";

/**
 * "Secure your sign-in" (owner amendment 2026-11-18, item 3): the mandatory step when the active plant
 * requires secure sign-in and the person has no passkey, Google or authenticator app. Today it sets up
 * the authenticator app (`TwoFactorStep`); the passkey option belongs inside this component (plan Task 5),
 * so the stepper never needs to know which method was chosen.
 */
export function SecureSignInStep({
  userId,
  password,
  plantName,
  onDone,
  headingRef,
}: {
  userId: string;
  /** The password just set in the password step, if any (two-factor setup needs it). */
  password: string | null;
  /** The plant whose policy asks for it. */
  plantName: string;
  onDone(): void;
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  const { t } = useT();
  return (
    <TwoFactorStep
      headingRef={headingRef}
      userId={userId}
      password={password}
      onDone={onDone}
      title={t("welcome.secure.title")}
      lead={t("welcome.secure.required", { company: plantName })}
    />
  );
}
