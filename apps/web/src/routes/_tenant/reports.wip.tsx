import { createFileRoute } from "@tanstack/react-router";

import { WipReport } from "@/features/reports/reg-wip";
import { parseWipSearch } from "@/features/reports/reg-search";

export const Route = createFileRoute("/_tenant/reports/wip")({
  validateSearch: (raw: Record<string, unknown>) => parseWipSearch(raw),
  component: WipRoute,
});

function WipRoute() {
  const search = Route.useSearch();
  return <WipReport search={search} />;
}
