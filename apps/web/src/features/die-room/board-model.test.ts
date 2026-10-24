import { describe, expect, test } from "bun:test";

import {
  boardKindParam,
  boardListInput,
  boardOwnerParam,
  boardSortParam,
  boardTileParam,
  hasBoardFilters,
  tileCount,
  tilePatch,
} from "./board-model";
import { statusTone } from "./die-room-model";

describe("board URL params", () => {
  test("only known values pass; anything else is the default", () => {
    expect(boardTileParam("on_trial")).toBe("on_trial");
    expect(boardTileParam("none")).toBe("none");
    expect(boardTileParam("retired")).toBeUndefined();
    expect(boardTileParam(3)).toBeUndefined();
    expect(boardSortParam("band")).toBe("band");
    expect(boardSortParam("drift")).toBeUndefined();
    expect(boardKindParam("hollow")).toBe("hollow");
    expect(boardKindParam("round")).toBeUndefined();
    expect(boardOwnerParam("customer")).toBe("customer");
    expect(boardOwnerParam("")).toBeUndefined();
  });
});

describe("board list input", () => {
  test("a status tile asks for sections with a copy in that status", () => {
    expect(boardListInput({ q: "", tile: "on_trial", sort: "newest" }, { limit: 50, offset: 0 })).toEqual({
      copyStatus: "on_trial",
      sort: "newest",
      limit: 50,
      offset: 0,
    });
  });

  test("the no-copies tile, search, kind, owner and sort all travel to the server", () => {
    expect(boardListInput({ q: "12170", tile: "none", kind: "hollow", owner: "customer", sort: "copies" }, { limit: 50, offset: 100 })).toEqual({
      search: "12170",
      copies: "none",
      profileKind: "hollow",
      owner: "customer",
      sort: "copies",
      limit: 50,
      offset: 100,
    });
  });
});

describe("tiles", () => {
  test("a tile pressed again clears it; pressing another replaces it; either goes back to page one", () => {
    expect(tilePatch(undefined, "on_trial")).toEqual({ tile: "on_trial", offset: undefined });
    expect(tilePatch("on_trial", "on_trial")).toEqual({ tile: undefined, offset: undefined });
    expect(tilePatch("on_trial", "available")).toEqual({ tile: "available", offset: undefined });
  });

  test("counts come from the server: copies by status, dies without copies", () => {
    const counts = {
      sectionsWithoutCopies: 4,
      copies: { available: 10, in_use: 2, at_nitriding: 1, at_maker: 0, retired: 3, on_trial: 5 },
    };
    expect(tileCount("on_trial", counts)).toBe(5);
    expect(tileCount("none", counts)).toBe(4);
    expect(tileCount("available", counts)).toBe(10);
  });

  test("filters are on when any is set or the sort is not the default", () => {
    expect(hasBoardFilters({ q: "x", sort: "newest" })).toBe(false);
    expect(hasBoardFilters({ q: "", sort: "code" })).toBe(true);
    expect(hasBoardFilters({ q: "", tile: "none", sort: "newest" })).toBe(true);
  });

  test("on trial reads as a warning tone, like a copy at the maker", () => {
    expect(statusTone("on_trial")).toBe("amber");
  });
});
