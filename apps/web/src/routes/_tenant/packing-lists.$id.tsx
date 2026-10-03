import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";

import { isNotFound } from "@/shared/lib/session-errors";
import { trpcClient } from "@/shared/utils/trpc";

/**
 * Old `/packing-lists/$id`: a packing list now lives on its dispatch, so this
 * forwards to `/dispatch/$dispatchId` (spec §3.2). Needs `packingList.get` to
 * learn which dispatch the list belongs to.
 */
export const Route = createFileRoute("/_tenant/packing-lists/$id")({
  loader: async ({ params, location }) => {
    let dispatchId: string;
    try {
      // Plain client: a miss is this page's own message, not an error toast.
      dispatchId = (await trpcClient.packingList.get.query({ id: params.id })).dispatchId;
    } catch (error) {
      if (!isNotFound(error)) throw error;
      return null;
    }
    throw redirect({ href: `/dispatch/${encodeURIComponent(dispatchId)}${location.searchStr}`, replace: true });
  },
  component: PackingListNotFound,
});

function PackingListNotFound() {
  const { t } = useT();
  return (
    <EmptyState
      title={t("errors.notFoundInCompany")}
      action={
        <Button asChild variant="secondary">
          <Link to="/dispatch">{t("dispatch.title")}</Link>
        </Button>
      }
    />
  );
}
