import { createFileRoute } from "@tanstack/react-router";

import { parseListsSearch } from "@/features/masters/adm-search";
import { PlantListsPage } from "@/features/masters/plant-lists-page";

/** `?kind=designation|packing_mode|die_category` (departments when missing or unknown). */
export const Route = createFileRoute("/_tenant/masters/lists")({
  validateSearch: parseListsSearch,
  component: ListsRoute,
});

function ListsRoute() {
  const { kind } = Route.useSearch();
  const navigate = Route.useNavigate();
  return <PlantListsPage kind={kind ?? "department"} onKind={(next) => void navigate({ search: next === "department" ? {} : { kind: next }, replace: true })} />;
}
