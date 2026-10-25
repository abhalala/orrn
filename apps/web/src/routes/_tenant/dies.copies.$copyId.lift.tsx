import { createFileRoute } from "@tanstack/react-router";

import { LiftPage } from "@/features/die-room/lift-panel";

export const Route = createFileRoute("/_tenant/dies/copies/$copyId/lift")({
  component: Lift,
});

function Lift() {
  const { copyId } = Route.useParams();
  return <LiftPage key={copyId} copyId={copyId} />;
}
