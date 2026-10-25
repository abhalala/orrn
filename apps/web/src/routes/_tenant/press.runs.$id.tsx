import { createFileRoute } from "@tanstack/react-router";

import { StationScreen } from "@/features/press/station";

export const Route = createFileRoute("/_tenant/press/runs/$id")({
  component: StationRoute,
});

function StationRoute() {
  const { id } = Route.useParams();
  return <StationScreen key={id} runId={id} />;
}
