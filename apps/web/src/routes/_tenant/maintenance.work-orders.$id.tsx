import { createFileRoute } from "@tanstack/react-router";

import { WorkOrderPage } from "@/features/maintenance/work-order-page";

export const Route = createFileRoute("/_tenant/maintenance/work-orders/$id")({
  component: WorkOrderRoute,
});

function WorkOrderRoute() {
  const { id } = Route.useParams();
  return <WorkOrderPage key={id} id={id} />;
}
