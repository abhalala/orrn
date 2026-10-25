import { createFileRoute } from "@tanstack/react-router";

import { BatchScreen } from "@/features/ageing/batch-view";

export const Route = createFileRoute("/_tenant/ageing/batch/$id")({
  component: BatchRoute,
});

function BatchRoute() {
  const { id } = Route.useParams();
  return <BatchScreen id={id} />;
}
