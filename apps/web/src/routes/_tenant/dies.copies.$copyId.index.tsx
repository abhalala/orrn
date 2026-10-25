import { createFileRoute } from "@tanstack/react-router";

import { CopyCard } from "@/features/die-room/copy-card";
import { cardTabParam, type CardTab } from "@/features/die-room/die-room-model";

type CardSearch = { tab?: CardTab };

export const Route = createFileRoute("/_tenant/dies/copies/$copyId/")({
  validateSearch: (search: Record<string, unknown>): CardSearch => {
    const tab = cardTabParam(search.tab);
    return tab === "readings" ? {} : { tab };
  },
  component: CopyRoute,
});

function CopyRoute() {
  const { copyId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <CopyCard
      key={copyId}
      copyId={copyId}
      tab={search.tab ?? "readings"}
      onTab={(tab) => navigate({ search: tab === "readings" ? {} : { tab }, replace: true })}
    />
  );
}
