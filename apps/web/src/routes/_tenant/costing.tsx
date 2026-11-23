import { createFileRoute } from "@tanstack/react-router";

import { CostingPage } from "@/features/costing/costing-page";
import { parseCostingSearch } from "@/features/costing/search";

/** `/costing?tab=outlook|cost|profit|capacity|forecast|dies|settings` (XE parity lane COST); outlook when missing. */
export const Route = createFileRoute("/_tenant/costing")({
  validateSearch: (raw: Record<string, unknown>) => parseCostingSearch(raw),
  component: CostingRoute,
});

function CostingRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return <CostingPage search={search} onSearch={(next) => void navigate({ search: next, replace: true })} />;
}
