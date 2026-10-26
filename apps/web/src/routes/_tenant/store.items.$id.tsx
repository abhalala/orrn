import { createFileRoute } from "@tanstack/react-router";

import { StoreItemPage } from "@/features/store/item-page";

export const Route = createFileRoute("/_tenant/store/items/$id")({
  component: StoreItemRoute,
});

function StoreItemRoute() {
  const { id } = Route.useParams();
  // Keyed so moving between items starts each page fresh (sheet closed, entries paging reset).
  return <StoreItemPage key={id} id={id} />;
}
