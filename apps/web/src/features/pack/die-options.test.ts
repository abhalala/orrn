import { describe, expect, test } from "bun:test";

import { dieListView, recentDieIds, RECENT_MAX, type DieOption } from "./die-options";

const die = (n: number, over: Partial<DieOption> = {}): DieOption => ({
  id: `d${n}`,
  series: "PATTI",
  sectionCode: String(10_000 + n),
  name: null,
  weightMinG: 2400,
  weightMaxG: 2600,
  status: "active",
  ...over,
});

/** The plant catalogue: ~1,000 sections, the picker loads the first 100. */
const catalogue = Array.from({ length: 1047 }, (_, i) => die(i + 1));
const firstPage = { items: catalogue.slice(0, 100), total: catalogue.length };

describe("recentDieIds (dies of the latest sessions, newest first)", () => {
  test("distinct, newest first, at most five", () => {
    const sessions = ["d7", "d7", "d3", "d900", "d3", "d1", "d2", "d5", "d6"].map((dieId) => ({ dieId }));
    expect(recentDieIds(sessions)).toEqual(["d7", "d3", "d900", "d1", "d2"]);
    expect(RECENT_MAX).toBe(5);
  });

  test("no sessions yet, or the list didn't load", () => {
    expect(recentDieIds(undefined)).toEqual([]);
    expect(recentDieIds([])).toEqual([]);
  });
});

describe("dieListView (what the die picker shows)", () => {
  test("a die packed yesterday but outside the first 100 still leads under Recent", () => {
    const yesterday = catalogue[899]!; // d900, far outside the first page
    const view = dieListView({ query: "", page: firstPage, searched: undefined, recent: [yesterday, catalogue[2]] });
    expect(view.recent.map((d) => d.id)).toEqual(["d900", "d3"]);
    // Recent dies are not listed twice.
    expect(view.rest.some((d) => d.id === "d3")).toBe(false);
    expect(view.rest).toHaveLength(99);
  });

  test("says how many dies exist when the list holds only the first page", () => {
    const view = dieListView({ query: "", page: firstPage, searched: undefined, recent: [] });
    expect(view.more).toEqual({ shown: 100, total: 1047 });
  });

  test("no 'more' line when every die is listed", () => {
    const small = { items: catalogue.slice(0, 12), total: 12 };
    expect(dieListView({ query: "", page: small, searched: undefined, recent: [] }).more).toBeNull();
  });

  test("archived, deleted or not-yet-loaded recent dies are left out of Recent", () => {
    const view = dieListView({
      query: "",
      page: firstPage,
      searched: undefined,
      recent: [die(2000, { status: "archived" }), undefined, catalogue[4]],
    });
    expect(view.recent.map((d) => d.id)).toEqual(["d5"]);
  });

  test("the list is in section order (the floor reads codes, not insert order)", () => {
    const page = { items: [die(30), die(4), die(200)], total: 3 };
    const view = dieListView({ query: "", page, searched: undefined, recent: [] });
    expect(view.rest.map((d) => d.sectionCode)).toEqual(["10004", "10030", "10200"]);
  });

  test("a search shows its own matches, no Recent group, and its own 'more' line", () => {
    const searched = { items: catalogue.slice(0, 100), total: 412 };
    const view = dieListView({ query: "10", page: firstPage, searched, recent: [catalogue[899]] });
    expect(view.recent).toEqual([]);
    expect(view.rest).toHaveLength(100);
    expect(view.more).toEqual({ shown: 100, total: 412 });
  });

  test("nothing loaded yet", () => {
    const view = dieListView({ query: "", page: undefined, searched: undefined, recent: [] });
    expect(view).toEqual({ recent: [], rest: [], more: null });
  });
});
