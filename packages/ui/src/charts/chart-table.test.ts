import { describe, expect, test } from "bun:test";

import type { Translate } from "@orrn/i18n";

import { rankedTable, scrollEdges } from "./chart-table";

const t = ((key: string) => key) as unknown as Translate;

describe("rankedTable", () => {
  test("the name column keeps a readable width so long names wrap by words, not one word a line", () => {
    const table = rankedTable(
      [{ key: "a", label: "KD Extrusion Private Limited, Rajkot", value: 995.2, share: 55.1, movement: null }],
      { t, format: (v) => `${v} kg`, valueHeader: "kg" },
    );
    expect(table.columns[0]).toMatchObject({ key: "name", minRem: 9 });
    // Figures keep their own width; only the name column asks for one.
    expect(table.columns.slice(1).every((c) => c.minRem === undefined)).toBe(true);
  });
});

describe("scrollEdges", () => {
  test("nothing hidden when the table fits", () => {
    expect(scrollEdges({ scrollLeft: 0, scrollWidth: 309, clientWidth: 309 })).toEqual({ start: false, end: false });
  });

  test("columns hidden to the right until scrolled to the end", () => {
    expect(scrollEdges({ scrollLeft: 0, scrollWidth: 402, clientWidth: 309 })).toEqual({ start: false, end: true });
    expect(scrollEdges({ scrollLeft: 40, scrollWidth: 402, clientWidth: 309 })).toEqual({ start: true, end: true });
    expect(scrollEdges({ scrollLeft: 93, scrollWidth: 402, clientWidth: 309 })).toEqual({ start: true, end: false });
  });

  test("sub-pixel scroll positions (zoomed or high-density screens) count as the edge", () => {
    expect(scrollEdges({ scrollLeft: 0.5, scrollWidth: 402, clientWidth: 309 }).start).toBe(false);
    expect(scrollEdges({ scrollLeft: 92.6, scrollWidth: 402, clientWidth: 309 }).end).toBe(false);
  });
});
