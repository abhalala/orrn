import { useT } from "@orrn/i18n";
import { toast } from "sonner";

import { SIGN_OUT_REFUSAL, signOutAndReset } from "./sign-out";

/**
 * Sign out from a button. M2 (final explore): when it cannot happen (offline, or the request never
 * reached the server) the person is told so and stays signed in; nothing is silent.
 */
export function useSignOutAndReset(): (onDone: () => void) => void {
  const { t } = useT();
  return (onDone) =>
    void signOutAndReset(onDone).then((result) => {
      if (result !== "signed_out") toast.error(t(SIGN_OUT_REFUSAL[result]), { id: "sign-out-refused" });
    });
}
