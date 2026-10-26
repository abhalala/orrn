import { createFileRoute } from "@tanstack/react-router";

import { DieLifeReport } from "@/features/reports/die-life-report";
import { parseDieLifeSearch } from "@/features/reports/search";

export const Route = createFileRoute("/_tenant/reports/die-life")({
  validateSearch: (raw: Record<string, unknown>) => parseDieLifeSearch(raw),
  component: DieLifeRoute,
});

function DieLifeRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return <DieLifeReport search={search} onSearch={(next) => void navigate({ search: next, replace: true })} />;
}
