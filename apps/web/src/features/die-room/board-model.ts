/**
 * The `/dies` board's URL state and tiles (FP-DR-01/17): which copy status, kind, owner and sort
 * the list shows. Plain functions (route files import this, so no zod); the server does the
 * filtering and sorting, nothing here counts or ranks a die.
 */
import { COPY_STATUSES, type CopyStatus } from "./die-room-model";

export const BOARD_SORTS = ["newest", "code", "band", "copies"] as const;
export type BoardSort = (typeof BOARD_SORTS)[number];

export const BOARD_KINDS = ["hollow", "solid", "semi"] as const;
export type BoardKind = (typeof BOARD_KINDS)[number];

export const BOARD_OWNERS = ["plant", "customer"] as const;
export type BoardOwner = (typeof BOARD_OWNERS)[number];

/** A tile: a copy status (the copies in it) or the sections that have no copies. */
export type BoardTile = Exclude<CopyStatus, "retired"> | "none";
export const BOARD_TILES: readonly BoardTile[] = ["on_trial", "available", "in_use", "at_nitriding", "at_maker", "none"];

export type BoardFilters = {
  q: string;
  /** The pressed tile: the copies in that status, or sections with no live copies. */
  tile?: BoardTile;
  kind?: BoardKind;
  owner?: BoardOwner;
  sort: BoardSort;
};

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

export const boardSortParam = (v: unknown) => oneOf(v, BOARD_SORTS);
export const boardKindParam = (v: unknown) => oneOf(v, BOARD_KINDS);
export const boardOwnerParam = (v: unknown) => oneOf(v, BOARD_OWNERS);
/** `?tile=` is a copy status, or `none` for sections without copies. */
export const boardTileParam = (v: unknown): BoardTile | undefined => oneOf(v, [...COPY_STATUSES.filter((s) => s !== "retired"), "none"] as const);

/** The `die.list` input for these filters (the server filters and sorts). */
export function boardListInput(f: BoardFilters, page: { limit: number; offset: number }) {
  return {
    ...(f.q ? { search: f.q } : {}),
    ...(f.tile && f.tile !== "none" ? { copyStatus: f.tile } : {}),
    ...(f.tile === "none" ? { copies: "none" as const } : {}),
    ...(f.kind ? { profileKind: f.kind } : {}),
    ...(f.owner ? { owner: f.owner } : {}),
    sort: f.sort,
    limit: page.limit,
    offset: page.offset,
  };
}

/**
 * A copy-status tile counts copies, so pressing it lists those copies (`dieInstance.list`), not the
 * sections that hold them: the list total is the tile's count. Null for no tile or "Dies without
 * copies" (that tile counts sections; the board lists sections).
 */
export function copyListInput(f: BoardFilters, page: { limit: number; offset: number }): { status: CopyStatus; search?: string; limit: number; offset: number } | null {
  if (!f.tile || f.tile === "none") return null;
  // dieInstance.list takes a copy search of up to 40 characters.
  const search = f.q.trim().slice(0, 40);
  return { status: f.tile, ...(search ? { search } : {}), limit: page.limit, offset: page.offset };
}

/** A tile pressed again clears it. Returns the search patch (a tile resets the page). */
export function tilePatch(current: BoardTile | undefined, tile: BoardTile): { tile: BoardTile | undefined; offset: undefined } {
  return { tile: current === tile ? undefined : tile, offset: undefined };
}

/** True when any filter beyond the search term is on. */
export function hasBoardFilters(f: BoardFilters): boolean {
  return Boolean(f.tile || f.kind || f.owner || f.sort !== "newest");
}

/** The count a tile shows, from `die.boardCounts`. */
export function tileCount(
  tile: BoardTile,
  counts: { sectionsWithoutCopies: number; copies: Record<CopyStatus, number> },
): number {
  return tile === "none" ? counts.sectionsWithoutCopies : counts.copies[tile];
}
