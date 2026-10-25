import { createFileRoute } from "@tanstack/react-router";

import { PortalOrderDetailPage } from "@/features/portal/order-detail-page";

export const Route = createFileRoute("/_portal/portal/orders/$id")({
  component: OrderRoute,
});

function OrderRoute() {
  const { id } = Route.useParams();
  return <PortalOrderDetailPage key={id} id={id} />;
}
