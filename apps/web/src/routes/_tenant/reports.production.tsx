import { createFileRoute } from "@tanstack/react-router";

import { ProductionReport } from "@/features/reports/production-report";
import { parseProductionSearch } from "@/features/reports/search";

export const Route = createFileRoute("/_tenant/reports/production")({
  validateSearch: (raw: Record<string, unknown>) => parseProductionSearch(raw),
  component: ProductionRoute,
});

function ProductionRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return <ProductionReport search={search} onSearch={(next) => void navigate({ search: next, replace: true })} />;
}
