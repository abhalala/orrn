import { createFileRoute } from "@tanstack/react-router";

import { StoreEntryForm } from "@/features/store/entry-form";
import { storeEntrySearch } from "@/features/store/search";

/** `?item=<id>` picks the item (from its page). */
export const Route = createFileRoute("/_tenant/store/exchange")({
  validateSearch: storeEntrySearch,
  component: StoreRoute,
});

function StoreRoute() {
  const { item } = Route.useSearch();
  return <StoreEntryForm key={item ?? ""} mode="exchange" initialItemId={item} />;
}
