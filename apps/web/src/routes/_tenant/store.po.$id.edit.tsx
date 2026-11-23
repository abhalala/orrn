import { createFileRoute } from "@tanstack/react-router";

import { PoFormPage } from "@/features/store-buy/po-form-page";

/** Change a draft purchase order. */
export const Route = createFileRoute("/_tenant/store/po/$id/edit")({
  component: PoEditRoute,
});

function PoEditRoute() {
  const { id } = Route.useParams();
  return <PoFormPage key={id} id={id} />;
}
