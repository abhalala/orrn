import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Link, createFileRoute, redirect } from "@tanstack/react-router";

import { bundleDetailPath } from "@/shell/route-compat";
import { trpcClient } from "@/shared/utils/trpc";

/**
 * `/b/$serial`: what a label QR and the "Scan or search" palette open.
 * TEMPORARY forwarder: resolves the serial and forwards to today's bundle
 * page (`/bundles/$id`). The route map / Stock tasks replace this file with
 * the real bundle screen.
 */
export const Route = createFileRoute("/_tenant/b/$serial")({
  loader: async ({ params }) => {
    let id: string | null = null;
    try {
      // Plain client: a miss is this page's own message, not an error toast.
      const found = await trpcClient.bundle.getBySerial.query({ serial: params.serial });
      id = found.bundle.id;
    } catch {
      return { found: false as const };
    }
    throw redirect({ to: bundleDetailPath({ id, serial: params.serial }) as never, replace: true });
  },
  component: BundleNotFound,
});

function BundleNotFound() {
  const { t } = useT();
  const { serial } = Route.useParams();
  return (
    <>
      <PageHeader title={t("errors.notFoundInCompany")} />
      <p className="m-0 min-w-0 truncate font-mono text-[17px]" title={serial}>
        {serial}
      </p>
      <div>
        <Button asChild variant="secondary">
          <Link to="/today">{t("errors.goToday")}</Link>
        </Button>
      </div>
    </>
  );
}
