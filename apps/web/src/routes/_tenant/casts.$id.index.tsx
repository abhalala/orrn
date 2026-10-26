import { createFileRoute } from "@tanstack/react-router";

import { CastScreen } from "@/features/foundry/cast-view";
import { parseCastSearch } from "@/features/foundry/search";

/** `/casts/$id?tab=trace&bundle=26J1842`. */
export const Route = createFileRoute("/_tenant/casts/$id/")({
  validateSearch: (raw: Record<string, unknown>) => parseCastSearch(raw),
  component: CastRoute,
});

function CastRoute() {
  const { id } = Route.useParams();
  const { tab, bundle } = Route.useSearch();
  const navigate = Route.useNavigate();
  return <CastScreen key={id} id={id} tab={tab ?? "melts"} bundle={bundle} onTab={(next) => void navigate({ search: next === "melts" ? {} : { tab: next, ...(bundle ? { bundle } : {}) }, replace: true })} />;
}
