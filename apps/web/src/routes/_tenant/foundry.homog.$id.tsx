import { createFileRoute } from "@tanstack/react-router";

import { HomogBatchScreen } from "@/features/foundry/homog-batch-view";

/** `/foundry/homog/$id`: one homogenizing batch. */
export const Route = createFileRoute("/_tenant/foundry/homog/$id")({
  component: HomogBatchRoute,
});

function HomogBatchRoute() {
  const { id } = Route.useParams();
  return <HomogBatchScreen key={id} id={id} />;
}
