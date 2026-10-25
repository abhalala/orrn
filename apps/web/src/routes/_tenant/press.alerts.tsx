import { createFileRoute } from "@tanstack/react-router";

import { AlertsScreen } from "@/features/press/alerts-view";
import { parseAlertsSearch } from "@/features/press/search";

export const Route = createFileRoute("/_tenant/press/alerts")({
  validateSearch: (raw: Record<string, unknown>) => parseAlertsSearch(raw),
  component: AlertsRoute,
});

function AlertsRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return <AlertsScreen search={search} onSearch={(next) => void navigate({ search: next, replace: true })} />;
}
