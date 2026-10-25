import { createFileRoute } from "@tanstack/react-router";

import { HistoryScreen } from "@/features/ageing/history-view";
import { parseHistorySearch } from "@/features/ageing/search";

export const Route = createFileRoute("/_tenant/ageing/history")({
  validateSearch: (raw: Record<string, unknown>) => parseHistorySearch(raw),
  component: HistoryRoute,
});

function HistoryRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return <HistoryScreen search={search} onSearch={(next) => void navigate({ search: next, replace: true })} />;
}
