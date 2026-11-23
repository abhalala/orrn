import { createFileRoute } from "@tanstack/react-router";

import { ChallanScreen } from "@/features/jobwork/challan-view";

/** `/jobwork/$id/challan`: the A4 delivery challan for job work. */
export const Route = createFileRoute("/_tenant/jobwork/$id/challan")({
  component: ChallanRoute,
});

function ChallanRoute() {
  const { id } = Route.useParams();
  return <ChallanScreen key={id} id={id} />;
}
