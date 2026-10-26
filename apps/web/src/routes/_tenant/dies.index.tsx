import { createFileRoute } from "@tanstack/react-router";

import { offsetParam, searchTermParam } from "@/features/catalog/search-param";
import {
  boardKindParam,
  boardOwnerParam,
  boardSortParam,
  boardTileParam,
  type BoardKind,
  type BoardOwner,
  type BoardSort,
  type BoardTile,
} from "@/features/die-room/board-model";
import { DieRoomBoard } from "@/features/die-room/board";

type DiesSearch = { q?: string; offset?: number; tile?: BoardTile; kind?: BoardKind; owner?: BoardOwner; sort?: BoardSort };

export const Route = createFileRoute("/_tenant/dies/")({
  validateSearch: (search: Record<string, unknown>): DiesSearch => ({
    q: searchTermParam(search.q),
    offset: offsetParam(search.offset),
    tile: boardTileParam(search.tile),
    kind: boardKindParam(search.kind),
    owner: boardOwnerParam(search.owner),
    // "newest" is the default and stays out of the address.
    sort: boardSortParam(search.sort) === "newest" ? undefined : boardSortParam(search.sort),
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
      tile={search.tile}
      kind={search.kind}
      owner={search.owner}
      sort={search.sort ?? "newest"}
      onSearch={(term) => navigate({ search: (prev: DiesSearch) => ({ ...prev, q: term || undefined, offset: undefined }), replace: true })}
      onPage={(next) => navigate({ search: (prev: DiesSearch) => ({ ...prev, offset: next || undefined }) })}
      onFilter={(patch) => navigate({ search: (prev: DiesSearch) => ({ ...prev, ...patch }), replace: true })}
      onClear={() => navigate({ search: (prev: DiesSearch) => ({ q: prev.q }), replace: true })}
    />
  );
}
