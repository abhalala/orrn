import { createFileRoute } from "@tanstack/react-router";

import { ReasonsPage } from "@/features/masters/reasons-page";
import { parseReasonsSearch } from "@/features/masters/search";

/** `?kind=qc_reject|void|...` (downtime when missing or unknown). */
export const Route = createFileRoute("/_tenant/masters/reasons")({
  validateSearch: parseReasonsSearch,
  component: ReasonsRoute,
});

function ReasonsRoute() {
  const { kind } = Route.useSearch();
  const navigate = Route.useNavigate();
  return <ReasonsPage kind={kind ?? "downtime"} onKind={(next) => void navigate({ search: next === "downtime" ? {} : { kind: next }, replace: true })} />;
}
