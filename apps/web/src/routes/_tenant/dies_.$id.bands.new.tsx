import { createFileRoute } from "@tanstack/react-router";

import { NewBandPage } from "@/features/die-room/band-form";

export const Route = createFileRoute("/_tenant/dies_/$id/bands/new")({
  component: NewBand,
});

function NewBand() {
  const { id } = Route.useParams();
  return <NewBandPage key={id} id={id} />;
}
