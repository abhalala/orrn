import { createFileRoute } from "@tanstack/react-router";

import { OrdersReport } from "@/features/reports/orders-report";
import { parseOrdersReportSearch } from "@/features/reports/search";

export const Route = createFileRoute("/_tenant/reports/orders")({
  validateSearch: (raw: Record<string, unknown>) => parseOrdersReportSearch(raw),
  component: OrdersRoute,
});

function OrdersRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return <OrdersReport search={search} onSearch={(next) => void navigate({ search: next, replace: true })} />;
}
