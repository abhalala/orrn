import { createFileRoute } from "@tanstack/react-router";

import { QueueScreen } from "@/features/press/queue-view";
import { parseQueueSearch } from "@/features/press/search";

export const Route = createFileRoute("/_tenant/press/lines/$id")({
  validateSearch: (raw: Record<string, unknown>) => parseQueueSearch(raw),
  component: QueueRoute,
});

function QueueRoute() {
  const { id } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return <QueueScreen lineId={id} search={search} onSearch={(next) => void navigate({ search: next, replace: true })} />;
}
