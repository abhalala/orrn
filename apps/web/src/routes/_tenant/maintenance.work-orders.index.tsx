import { createFileRoute } from "@tanstack/react-router";

import { parseWoSearch, type WoSearch } from "@/features/maintenance/search";
import { WorkOrdersPage } from "@/features/maintenance/work-orders-page";

/** The list's status filter lives in the URL: `?status=done` (open work orders are the default and are left out). */
export const Route = createFileRoute("/_tenant/maintenance/work-orders/")({
  validateSearch: (search: Record<string, unknown>): WoSearch => parseWoSearch(search),
  component: WorkOrdersRoute,
});

function WorkOrdersRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return <WorkOrdersPage search={search} onSearch={(next) => void navigate({ search: next as never, replace: true })} />;
}
