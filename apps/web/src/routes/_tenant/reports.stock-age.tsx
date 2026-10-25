import { createFileRoute } from "@tanstack/react-router";

import { StockAgeReport } from "@/features/reports/stock-age-report";
import { parseStockAgeSearch } from "@/features/reports/search";

export const Route = createFileRoute("/_tenant/reports/stock-age")({
  validateSearch: (raw: Record<string, unknown>) => parseStockAgeSearch(raw),
  component: StockAgeRoute,
});

function StockAgeRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return <StockAgeReport search={search} onSearch={(next) => void navigate({ search: next, replace: true })} />;
}
