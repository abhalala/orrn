import { createFileRoute } from "@tanstack/react-router";

import { AgeingReport } from "@/features/ageing/report-view";
import { parseAgeingReportSearch } from "@/features/ageing/search";

export const Route = createFileRoute("/_tenant/reports/ageing")({
  validateSearch: (raw: Record<string, unknown>) => parseAgeingReportSearch(raw),
  component: AgeingReportRoute,
});

function AgeingReportRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return <AgeingReport search={search} onSearch={(next) => void navigate({ search: next, replace: true })} />;
}
