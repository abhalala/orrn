import { createFileRoute } from "@tanstack/react-router";

import { ReportScreen } from "@/features/press/report-view";
import { parseReportSearch } from "@/features/press/search";

export const Route = createFileRoute("/_tenant/press/report")({
  validateSearch: (raw: Record<string, unknown>) => parseReportSearch(raw),
  component: ReportRoute,
});

function ReportRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return <ReportScreen search={search} onSearch={(next) => void navigate({ search: next, replace: true })} />;
}
