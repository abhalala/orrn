import { createFileRoute } from "@tanstack/react-router";

import { parseYieldSearch } from "@/features/foundry/search";
import { FoundryYieldReport } from "@/features/foundry/yield-report";

export const Route = createFileRoute("/_tenant/reports/foundry-yield")({
  validateSearch: (raw: Record<string, unknown>) => parseYieldSearch(raw),
  component: YieldRoute,
});

function YieldRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return <FoundryYieldReport search={search} onSearch={(next) => void navigate({ search: next, replace: true })} />;
}
