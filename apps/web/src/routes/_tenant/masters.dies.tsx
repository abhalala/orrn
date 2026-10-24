import { createFileRoute } from "@tanstack/react-router";

import { DieCopiesPage } from "@/features/masters/die-copies-page";
import { parseDieCopiesSearch } from "@/features/masters/search";

/** `?section=<section id>&status=available|in_use|at_nitriding|retired&offset=50`. */
export const Route = createFileRoute("/_tenant/masters/dies")({
  validateSearch: parseDieCopiesSearch,
  component: DieCopiesRoute,
});

function DieCopiesRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return <DieCopiesPage search={search} onSearch={(next) => void navigate({ search: next })} />;
}
