import { describe, expect, test } from "bun:test";

import { volumeBars } from "./volume-data";

describe("volumeBars", () => {
  const months = [
    { month: "2025-11", kgG: 0, dispatches: 0 },
    { month: "2025-12", kgG: 1_234_500, dispatches: 3 },
    { month: "2026-10", kgG: 52_400, dispatches: 1 },
  ];

  test("kg per month, labelled by month, the last (open) month marked partial", () => {
    const bars = volumeBars(months, "en");
    expect(bars.map((b) => [b.key, b.label, b.short, b.value, b.partial])).toEqual([
      ["2025-11", "Nov 2025", "Nov", 0, false],
      ["2025-12", "Dec 2025", "Dec", 1234.5, false],
      ["2026-10", "Oct 2026", "Oct", 52.4, true],
    ]);
  });

  test("each bar carries its month (mid-month UTC) so the axis can add the year where it crosses one", () => {
    const bars = volumeBars(months, "en");
    expect(bars.map((b) => b.t?.toISOString())).toEqual([
      "2025-11-15T00:00:00.000Z",
      "2025-12-15T00:00:00.000Z",
      "2026-10-15T00:00:00.000Z",
    ]);
  });

  test("an empty answer is no bars", () => {
    expect(volumeBars([], "en")).toEqual([]);
  });
});
