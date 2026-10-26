import { createFileRoute } from "@tanstack/react-router";

import { AgeingReport } from "@/features/ageing/report-view";
import { parseAgeingReportSearch } from "@/features/ageing/search";

export const Route = createFileRoute("/_tenant/reports/ageing")({
  component: AgeingReportRoute,
});

function AgeingReportRoute() {
  const search = parseAgeingReportSearch(Route.useSearch() as Record<string, unknown>);
  const navigate = Route.useNavigate();
  return <AgeingReport search={search} onSearch={(next) => void navigate({ search: next as never, replace: true })} />;
}
