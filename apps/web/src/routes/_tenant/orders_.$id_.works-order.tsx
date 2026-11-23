import { createFileRoute } from "@tanstack/react-router";

import { WorksOrderPage } from "@/features/pricing/docs/works-order-page";

/**
 * `/orders/$id/works-order`: what to make for a confirmed order, printable, with no prices. Not nested under
 * `/orders/$id` (trailing underscores), like `/pack/$id/labels`.
 */
export const Route = createFileRoute("/_tenant/orders_/$id_/works-order")({
  component: WorksOrderRoute,
});

function WorksOrderRoute() {
  const { id } = Route.useParams();
  return <WorksOrderPage key={id} orderId={id} />;
}
