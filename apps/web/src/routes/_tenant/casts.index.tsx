import { createFileRoute } from "@tanstack/react-router";

import { CastsScreen } from "@/features/foundry/casts-view";
import { parseCastsSearch } from "@/features/foundry/search";

/** `/casts?status=open&q=K31`. */
export const Route = createFileRoute("/_tenant/casts/")({
  validateSearch: (raw: Record<string, unknown>) => parseCastsSearch(raw),
  component: CastsRoute,
});

function CastsRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return <CastsScreen search={search} onSearch={(next) => void navigate({ search: next, replace: true })} />;
}
