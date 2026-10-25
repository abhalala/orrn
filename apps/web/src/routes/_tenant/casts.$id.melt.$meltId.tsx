import { createFileRoute } from "@tanstack/react-router";

import { MeltScreen } from "@/features/foundry/melt-view";
import { parseMeltSearch } from "@/features/foundry/search";

/** `/casts/$id/melt/$meltId?step=charge`: `$meltId` is a melt of the cast or `new`. */
export const Route = createFileRoute("/_tenant/casts/$id/melt/$meltId")({
  validateSearch: (raw: Record<string, unknown>) => parseMeltSearch(raw),
  component: MeltRoute,
});

function MeltRoute() {
  const { id, meltId } = Route.useParams();
  const { step } = Route.useSearch();
  const navigate = Route.useNavigate();
  return <MeltScreen key={`${id}/${meltId}`} castId={id} meltId={meltId} step={step ?? "times"} onStep={(next) => void navigate({ search: next === "times" ? {} : { step: next }, replace: true })} />;
}
