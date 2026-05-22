import { Button } from "@orrn/ui/components/button";

import { useMe } from "@/lib/me";
import { queryClient } from "@/utils/trpc";

/**
 * Renders a sticky red banner whenever the request context shows we're acting
 * inside an impersonation session. The "Stop impersonating" button just clears
 * the cached `auth.me` and reloads — the actual impersonation header is set by
 * the platform/admin UI (M9) so a reload reverts to the admin's own identity.
 */
export function ImpersonationBanner() {
  const { data: me } = useMe();
  if (!me?.impersonation) return null;

  return (
    <div className="w-full bg-red-600 text-white px-4 py-2 flex items-center justify-between text-sm sticky top-0 z-50">
      <div>
        <span className="font-semibold">Impersonating</span>{" "}
        {me.company ? me.company.name : me.impersonation.companyId} — all actions during this
        session are audited.
      </div>
      <Button
        variant="outline"
        size="sm"
        className="bg-white text-red-700 border-white hover:bg-red-50"
        onClick={() => {
          // Reload after dropping the cached me so we re-fetch as ourselves.
          // The actual impersonation header is controlled by the platform-admin
          // UI (M9); for now reloading from anywhere without that header is
          // enough to exit the session.
          queryClient.removeQueries({ queryKey: ["auth.me"] });
          window.location.reload();
        }}
      >
        Stop impersonating
      </Button>
    </div>
  );
}
