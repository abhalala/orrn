import { createFileRoute } from "@tanstack/react-router";

import { MaterialsReport } from "@/features/reports/reg-materials";
import { parseRegRange } from "@/features/reports/reg-search";

export const Route = createFileRoute("/_tenant/reports/materials")({
  validateSearch: (raw: Record<string, unknown>) => parseRegRange(raw),
  component: MaterialsReportRoute,
});

function MaterialsReportRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return <MaterialsReport search={search} onSearch={(next) => void navigate({ search: next, replace: true })} />;
}
