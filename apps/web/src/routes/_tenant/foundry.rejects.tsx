import { createFileRoute } from "@tanstack/react-router";

import { RejectsScreen } from "@/features/foundry/rejects-view";
import { parseRejectsSearch } from "@/features/foundry/rejects-model";

/** `/foundry/rejects?kind=log|billet&from=&to=` (log by default). */
export const Route = createFileRoute("/_tenant/foundry/rejects")({
  validateSearch: (raw: Record<string, unknown>) => parseRejectsSearch(raw),
  component: RejectsRoute,
});

function RejectsRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return <RejectsScreen search={search} onSearch={(next) => void navigate({ search: next, replace: true })} />;
}
