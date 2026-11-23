import { createFileRoute } from "@tanstack/react-router";

import { BilletsScreen } from "@/features/foundry/billets-view";
import { parseBilletsSearch } from "@/features/foundry/billets-model";

/** `/foundry/billets?tab=cut|issue` (stock by default). */
export const Route = createFileRoute("/_tenant/foundry/billets")({
  validateSearch: (raw: Record<string, unknown>) => parseBilletsSearch(raw),
  component: BilletsRoute,
});

function BilletsRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return <BilletsScreen search={search} onSearch={(next) => void navigate({ search: next, replace: true })} />;
}
