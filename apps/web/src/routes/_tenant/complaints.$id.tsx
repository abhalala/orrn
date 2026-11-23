import { createFileRoute } from "@tanstack/react-router";

import { ComplaintDetailPage } from "@/features/complaints/complaint-detail-page";

export const Route = createFileRoute("/_tenant/complaints/$id")({
  component: ComplaintRoute,
});

function ComplaintRoute() {
  const { id } = Route.useParams();
  return <ComplaintDetailPage key={id} id={id} />;
}
