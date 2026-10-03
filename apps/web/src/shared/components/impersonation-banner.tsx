import { useT } from "@orrn/i18n";
import { ImpersonationBanner as SharedImpersonationBanner } from "@orrn/ui/components/impersonation-banner";
import { useMutation } from "@tanstack/react-query";

import { clearImpersonation } from "../lib/impersonation";
import { useMe } from "../lib/me";
import { queryClient, trpc } from "../utils/trpc";

/**
 * Web wrapper around the shared Tamagui ImpersonationBanner from @orrn/ui.
 * Stop revokes the active grant, clears sessionStorage, and reloads.
 */
export function ImpersonationBanner() {
  const { t } = useT();
  const { data: me } = useMe();

  const revokeMutation = useMutation({
    ...trpc.platform.impersonationRevokeGrant.mutationOptions(),
  });

  if (!me?.impersonation) return null;

  return (
    <SharedImpersonationBanner
      companyName={me.company?.name ?? me.impersonation.companyId}
      message={t("admin.access.banner", { company: me.company?.name ?? me.impersonation.companyId })}
      stopLabel={t("admin.access.stop")}
      onStop={() => {
        const grantId = me.impersonation?.grantId;
        const finish = () => {
          clearImpersonation();
          queryClient.clear();
          window.location.reload();
        };
        if (grantId) {
          revokeMutation.mutate(
            { id: grantId },
            {
              onSettled: finish,
            },
          );
        } else {
          finish();
        }
      }}
    />
  );
}
