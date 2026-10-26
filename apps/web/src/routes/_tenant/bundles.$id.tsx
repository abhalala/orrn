import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";

import { isNotFound } from "@/shared/lib/session-errors";
import { bundleDetailPath } from "@/shared/lib/paths";
import { trpcClient } from "@/shared/utils/trpc";

/**
 * Old `/bundles/$id`: forwards to `/b/$serial`. Needs the server because the
 * old URL carries the bundle's id and the new one its number (spec §3.2).
 */
export const Route = createFileRoute("/_tenant/bundles/$id")({
  loader: async ({ params, location }) => {
    let serial: string;
    try {
      // Plain client: a miss is this page's own message, not an error toast.
      serial = (await trpcClient.bundle.getBundle.query({ id: params.id })).bundle.serial;
    } catch (error) {
      if (!isNotFound(error)) throw error;
      return null;
    }
    throw redirect({ href: `${bundleDetailPath({ serial })}${location.searchStr}`, replace: true });
  },
  component: BundleNotFound,
});

function BundleNotFound() {
  const { t } = useT();
  return (
    <EmptyState
      title={t("errors.notFoundInCompany")}
      action={
        <Button asChild variant="secondary">
          <Link to="/today">{t("errors.goToday")}</Link>
        </Button>
      }
    />
  );
}
