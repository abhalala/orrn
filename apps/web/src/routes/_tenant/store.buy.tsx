import { createFileRoute } from "@tanstack/react-router";

import { BuyPage } from "@/features/store-buy/buy-page";
import { parseBuySearch } from "@/features/store-buy/search";

/** `/store/buy?tab=orders|value` (indents when missing). */
export const Route = createFileRoute("/_tenant/store/buy")({
  validateSearch: (raw: Record<string, unknown>) => parseBuySearch(raw),
  component: BuyRoute,
});

function BuyRoute() {
  const { tab } = Route.useSearch();
  const navigate = Route.useNavigate();
  return <BuyPage tab={tab ?? "indents"} onTab={(next) => void navigate({ search: next === "indents" ? {} : { tab: next }, replace: true })} />;
}
