import { createFileRoute } from "@tanstack/react-router";

import { HistoryScreen } from "@/features/ageing/history-view";
import { parseHistorySearch } from "@/features/ageing/search";

// No `validateSearch` here: the route file stays in the entry chunk, so the page reads its own query in the lazy chunk.
export const Route = createFileRoute("/_tenant/ageing/history")({
  component: HistoryRoute,
});

function HistoryRoute() {
  const search = parseHistorySearch(Route.useSearch() as Record<string, unknown>);
  const navigate = Route.useNavigate();
  return <HistoryScreen search={search} onSearch={(next) => void navigate({ search: next as never, replace: true })} />;
}
