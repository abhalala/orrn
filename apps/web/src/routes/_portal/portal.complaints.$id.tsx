import { createFileRoute } from "@tanstack/react-router";

import { PortalComplaintDetailPage } from "@/features/complaints/portal-complaints";

export const Route = createFileRoute("/_portal/portal/complaints/$id")({
  component: ComplaintRoute,
});

function ComplaintRoute() {
  const { id } = Route.useParams();
  return <PortalComplaintDetailPage key={id} id={id} />;
}
