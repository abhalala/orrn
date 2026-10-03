import { createFileRoute } from "@tanstack/react-router";

import { LotDetailPage } from "@/features/purchase/lot-detail-page";

export const Route = createFileRoute("/_tenant/purchase/$id")({
  component: LotRoute,
});

function LotRoute() {
  const { id } = Route.useParams();
  // Keyed by id: moving between lots starts each page fresh (sheets closed, no stale pop).
  return <LotDetailPage key={id} id={id} />;
}
