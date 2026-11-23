import { createFileRoute } from "@tanstack/react-router";

import { PoPrintScreen } from "@/features/store-buy/po-print";

/** The A4 purchase order, rendered in the browser (the route chunk loads on open only). */
export const Route = createFileRoute("/_tenant/store/po/$id/print")({
  component: PoPrintRoute,
});

function PoPrintRoute() {
  const { id } = Route.useParams();
  return <PoPrintScreen key={id} id={id} />;
}
