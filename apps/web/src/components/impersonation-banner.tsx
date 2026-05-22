import { ImpersonationBanner as SharedImpersonationBanner } from "@orrn/ui/components/impersonation-banner";

import { useMe } from "@/lib/me";
import { queryClient } from "@/utils/trpc";

/**
 * Web wrapper around the shared Tamagui ImpersonationBanner from @orrn/ui.
 * Reads `me` from React Query and exposes a "Stop" handler that clears the
 * cached `auth.me` and reloads so the next request runs without the
 * `x-orrn-impersonate-company` header.
 */
export function ImpersonationBanner() {
  const { data: me } = useMe();
  if (!me?.impersonation) return null;
  return (
    <SharedImpersonationBanner
      companyName={me.company?.name ?? me.impersonation.companyId}
      stopLabel="Stop impersonating"
      onStop={() => {
        queryClient.removeQueries({ queryKey: ["auth.me"] });
        window.location.reload();
      }}
    />
  );
}
