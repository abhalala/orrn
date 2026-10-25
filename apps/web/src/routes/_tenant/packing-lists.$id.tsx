import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { PageHeader } from "@orrn/ui/components/page-header";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";

import { PackingListView } from "@/features/dispatch/packing-list-view";
import { isNotFound } from "@/shared/lib/session-errors";
import { trpc } from "@/shared/utils/trpc";

/**
 * `/packing-lists/$id`: one packing list by its own id, any revision. A sent revision, or a combined
 * list (which no single dispatch page shows), is reached here; the dispatch page shows the current
 * revision of its own list. Revisions and combine live in the view.
 */
export const Route = createFileRoute("/_tenant/packing-lists/$id")({
  component: PackingListPage,
});

function PackingListPage() {
  const { t } = useT();
  const { id } = Route.useParams();
  const list = useQuery({ ...trpc.packingList.get.queryOptions({ id }), retry: (n, e) => !isNotFound(e) && n < 2 });
  if (list.isError && isNotFound(list.error)) {
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
  return (
    <>
      <PageHeader
        title={list.data?.code ?? t("packingList.title")}
        back={list.data ? { to: `/dispatch/${list.data.dispatchId}`, label: t("packingList.v2.backToDispatch") } : { to: "/dispatch", label: t("dispatch.title") }}
      />
      <PackingListView listId={id} />
    </>
  );
}
