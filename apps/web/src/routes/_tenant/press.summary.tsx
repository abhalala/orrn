import { createFileRoute } from "@tanstack/react-router";

import { parseSummarySearch } from "@/features/press/search";
import { SummaryScreen } from "@/features/press/summary-view";

export const Route = createFileRoute("/_tenant/press/summary")({
  validateSearch: (raw: Record<string, unknown>) => parseSummarySearch(raw),
  component: SummaryRoute,
});

function SummaryRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return <SummaryScreen search={search} onSearch={(next) => void navigate({ search: next, replace: true })} />;
}
