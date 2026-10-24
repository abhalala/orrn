import { createFileRoute } from "@tanstack/react-router";

import { offsetParam, searchTermParam } from "@/features/catalog/search-param";
import { DieRoomBoard } from "@/features/die-room/board";

type DiesSearch = { q?: string; offset?: number };

export const Route = createFileRoute("/_tenant/dies/")({
  validateSearch: (search: Record<string, unknown>): DiesSearch => ({
    q: searchTermParam(search.q),
    offset: offsetParam(search.offset),
  }),
  component: DiesRoute,
});

function DiesRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <DieRoomBoard
      q={search.q ?? ""}
      offset={search.offset ?? 0}
      onSearch={(term) => navigate({ search: { q: term || undefined }, replace: true })}
      onPage={(next) => navigate({ search: (prev: DiesSearch) => ({ ...prev, offset: next || undefined }) })}
    />
  );
}
