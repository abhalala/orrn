import { createFileRoute } from "@tanstack/react-router";

import { PortalDispatchDetailPage } from "@/features/portal/dispatch-detail-page";

export const Route = createFileRoute("/_portal/portal/dispatches/$id")({
  component: DispatchRoute,
});

function DispatchRoute() {
  const { id } = Route.useParams();
  return <PortalDispatchDetailPage key={id} id={id} />;
}
