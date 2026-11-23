import { createFileRoute } from "@tanstack/react-router";

import { QuotesPage } from "@/features/pricing/docs/quotes-page";
import { parseQuotesSearch, type QuotesSearch } from "@/features/pricing/docs/search";

/** The quotes list: `?status=draft|sent|converted|cancelled|expired&customer=<id>&offset=50`. */
export const Route = createFileRoute("/_tenant/pricing/quotes/")({
  validateSearch: (search: Record<string, unknown>): QuotesSearch => parseQuotesSearch(search),
  component: QuotesRoute,
});

function QuotesRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return <QuotesPage search={search} onSearch={(next) => void navigate({ search: next as never, replace: true })} />;
}
