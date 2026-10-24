import { useT } from "@orrn/i18n";
import { useQueryClient } from "@tanstack/react-query";

import { trpc } from "@/shared/utils/trpc";

import { refusalText } from "./die-room-model";

/** Reload everything the die room shows after a change (copies, sections, approvals). */
export function useRefreshDieRoom() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: trpc.dieInstance.pathKey() }),
      queryClient.invalidateQueries({ queryKey: trpc.die.pathKey() }),
      queryClient.invalidateQueries({ queryKey: trpc.approval.pathKey() }),
    ]);
}

/** A server refusal as the sentence to show. */
export function useRefusal() {
  const { t } = useT();
  return (error: unknown) => refusalText(error, { forbidden: t("errors.forbidden"), generic: t("errors.generic") });
}
