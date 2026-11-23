import { createFileRoute } from "@tanstack/react-router";

import { CastPlanScreen } from "@/features/foundry/cast-plan-view";
import { parsePlanSearch } from "@/features/foundry/cast-plan-model";

/** `/foundry/plan?from=&to=` (plant days; today to today + 6 days by default). */
export const Route = createFileRoute("/_tenant/foundry/plan")({
  validateSearch: (raw: Record<string, unknown>) => parsePlanSearch(raw),
  component: PlanRoute,
});

function PlanRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return <CastPlanScreen search={search} onSearch={(next) => void navigate({ search: next, replace: true })} />;
}
