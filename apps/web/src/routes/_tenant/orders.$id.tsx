import { createFileRoute } from "@tanstack/react-router";

import { OrderDetailPage } from "@/features/orders/order-detail-page";

export const Route = createFileRoute("/_tenant/orders/$id")({
  component: OrderRoute,
});

function OrderRoute() {
  const { id } = Route.useParams();
  // Keyed by id: moving between orders starts each page fresh (sheets closed, no stale errors).
  return <OrderDetailPage key={id} id={id} />;
}
