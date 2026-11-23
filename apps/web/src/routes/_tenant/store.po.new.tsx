import { createFileRoute } from "@tanstack/react-router";

import { PoFormPage } from "@/features/store-buy/po-form-page";
import { parsePoNewSearch } from "@/features/store-buy/search";

/** `/store/po/new?indent=<id>`: a new purchase order, filled from an approved indent when given. */
export const Route = createFileRoute("/_tenant/store/po/new")({
  validateSearch: (raw: Record<string, unknown>) => parsePoNewSearch(raw),
  component: PoNewRoute,
});

function PoNewRoute() {
  const { indent } = Route.useSearch();
  return <PoFormPage key={indent ?? ""} indentId={indent} />;
}
