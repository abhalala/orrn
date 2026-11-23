import { createFileRoute } from "@tanstack/react-router";

import { PlanActualReport } from "@/features/reports/reg-plan-actual";
import { parsePlanActualSearch } from "@/features/reports/reg-search";

export const Route = createFileRoute("/_tenant/reports/plan-actual")({
  validateSearch: (raw: Record<string, unknown>) => parsePlanActualSearch(raw),
  component: PlanActualReportRoute,
});

function PlanActualReportRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return <PlanActualReport search={search} onSearch={(next) => void navigate({ search: next, replace: true })} />;
}
