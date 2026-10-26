import { createFileRoute } from "@tanstack/react-router";

import { parseBookSearch, type BookSearch } from "@/features/orders/book-view";
import { OrdersPage } from "@/features/orders/orders-page";

/** The order book's filters live in the URL: `?show=late&city=Surat&stage=in_stock&from=2026-10-01`. */
export const Route = createFileRoute("/_tenant/orders/")({
  validateSearch: (search: Record<string, unknown>): BookSearch => parseBookSearch(search),
  component: OrdersRoute,
});

function OrdersRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return <OrdersPage search={search} onSearch={(next) => void navigate({ search: next as never, replace: true })} />;
}
