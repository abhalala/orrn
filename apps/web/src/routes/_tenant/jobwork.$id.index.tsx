import { createFileRoute } from "@tanstack/react-router";

import { StepScreen } from "@/features/jobwork/step-view";

/** `/jobwork/$id`: one step of any kind (job work, finishing line, draw bench, fabrication). */
export const Route = createFileRoute("/_tenant/jobwork/$id/")({
  component: StepRoute,
});

function StepRoute() {
  const { id } = Route.useParams();
  return <StepScreen key={id} id={id} />;
}
