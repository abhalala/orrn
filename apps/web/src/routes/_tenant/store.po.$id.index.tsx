import { createFileRoute } from "@tanstack/react-router";

import { PoDetailPage } from "@/features/store-buy/po-detail-page";

export const Route = createFileRoute("/_tenant/store/po/$id/")({
  component: PoDetailRoute,
});

function PoDetailRoute() {
  const { id } = Route.useParams();
  return <PoDetailPage key={id} id={id} />;
}
