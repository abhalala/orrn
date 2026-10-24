import { createFileRoute } from "@tanstack/react-router";

import { StoreItemsPage } from "@/features/store/items-page";

/** `?add=true` opens the Add item sheet (linked from the empty store). */
export const Route = createFileRoute("/_tenant/store/items/")({
  validateSearch: (search: Record<string, unknown>): { add?: boolean } =>
    search.add === true || search.add === "true" ? { add: true } : {},
  component: StoreItemsRoute,
});

function StoreItemsRoute() {
  const { add } = Route.useSearch();
  return <StoreItemsPage startAdding={add === true} />;
}
