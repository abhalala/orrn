import { createFileRoute } from "@tanstack/react-router";

import { PlanDetailPage } from "@/features/orders/plan-detail-page";

export const Route = createFileRoute("/_tenant/orders/plan/$id")({
  component: PlanRoute,
});

function PlanRoute() {
  const { id } = Route.useParams();
  return <PlanDetailPage key={id} id={id} />;
}
