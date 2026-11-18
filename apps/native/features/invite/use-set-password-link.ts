import { useT, type MessageKey } from "@orrn/i18n";
import { useMutation } from "@tanstack/react-query";
import { useCallback, useState } from "react";

import { announce } from "@/lib/a11y";
import { feedback } from "@/lib/feedback";
import { trpc } from "@/utils/trpc";

import { setPasswordLinkError } from "./invite-flow";

export type SetPasswordLinkState = { step: "idle" } | { step: "sent" } | { step: "error"; key: MessageKey };

/**
 * "Email me a link to set a password" on the invite screen (plan 2026-11-18, Task 8; council r1, B4).
 * `invite.sendSetPasswordLink` sends only when the typed email is the invite's, and answers the same
 * either way, so the screen never learns whether the email has an account. The link opens the web
 * invite page after the reset. Used by the no-password step and after a failed password.
 */
export function useSetPasswordLink(token: string) {
  const { t } = useT();
  const send = useMutation(trpc.invite.sendSetPasswordLink.mutationOptions());
  const [state, setState] = useState<SetPasswordLinkState>({ step: "idle" });

  const request = useCallback(
    async (email: string): Promise<boolean> => {
      setState({ step: "idle" });
      try {
        await send.mutateAsync({ token, email });
        setState({ step: "sent" });
        announce(t("auth.invite.setPasswordSent"));
        return true;
      } catch (error) {
        const key = setPasswordLinkError(error);
        setState({ step: "error", key });
        announce(t(key), { shownInLiveRegion: true });
        feedback.error();
        return false;
      }
    },
    [send, t, token],
  );
  const reset = useCallback(() => setState({ step: "idle" }), []);

  return { request, reset, state, pending: send.isPending };
}
