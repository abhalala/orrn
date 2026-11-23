import { createFileRoute } from "@tanstack/react-router";

import { RecutsReport } from "@/features/reports/reg-recuts";
import { parseRecutsSearch } from "@/features/reports/reg-search";

export const Route = createFileRoute("/_tenant/reports/recuts")({
  validateSearch: (raw: Record<string, unknown>) => parseRecutsSearch(raw),
  component: RecutsReportRoute,
});

function RecutsReportRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return <RecutsReport search={search} onSearch={(next) => void navigate({ search: next, replace: true })} />;
}
