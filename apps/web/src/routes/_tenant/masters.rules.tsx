import { createFileRoute } from "@tanstack/react-router";

import { parseRulesSearch } from "@/features/masters/adm-search";
import { PlantRulesPage } from "@/features/masters/plant-rules-page";

/** `?tab=approvals|insurance` (number formats when missing or unknown). */
export const Route = createFileRoute("/_tenant/masters/rules")({
  validateSearch: parseRulesSearch,
  component: RulesRoute,
});

function RulesRoute() {
  const { tab } = Route.useSearch();
  const navigate = Route.useNavigate();
  return <PlantRulesPage tab={tab ?? "formats"} onTab={(next) => void navigate({ search: next === "formats" ? {} : { tab: next }, replace: true })} />;
}
