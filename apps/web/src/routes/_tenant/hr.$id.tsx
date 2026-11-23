import { createFileRoute } from "@tanstack/react-router";

import { PersonPage } from "@/features/hr/person-page";

export const Route = createFileRoute("/_tenant/hr/$id")({
  component: PersonRoute,
});

function PersonRoute() {
  const { id } = Route.useParams();
  // Keyed by id: moving between two people starts the page fresh (sheets closed, first tab).
  return <PersonPage key={id} id={id} />;
}
