import { describe, expect, test } from "bun:test";

import { formatShare } from "@orrn/ui/charts";

import { customerShare, formatSharePct, leaderboardRows, movementOf } from "./leaderboard";

const row = (over: Partial<Parameters<typeof leaderboardRows>[0][number]> = {}) => ({
  customerId: "c1",
  name: "KD Extrusion",
  kgG: 995_200,
  sharePct: 55.1,
  rank: 1,
  previousRank: 3 as number | null,
  ...over,
});

describe("movementOf (leaderboard chips)", () => {
  test("climbing the table is a positive movement", () => {
    // Was 3rd, now 1st: up 2.
    expect(movementOf(1, 3)).toBe(2);
  });

  test("falling is negative", () => {
    expect(movementOf(4, 2)).toBe(-2);
  });

  test("same rank is 0, not New", () => {
    expect(movementOf(2, 2)).toBe(0);
  });

  test("no rank in the previous period is New (null)", () => {
    expect(movementOf(5, null)).toBeNull();
  });
});

describe("leaderboardRows", () => {
  test("kg in the bars, the server's share and the movement, in the server's order", () => {
    const rows = leaderboardRows([
      row(),
      row({ customerId: "c2", name: "Royal Aluminium", kgG: 812_000, sharePct: 44.9, rank: 2, previousRank: null }),
    ]);
    expect(rows).toEqual([
      { key: "c1", label: "KD Extrusion", value: 995.2, share: 55.1, movement: 2 },
      { key: "c2", label: "Royal Aluminium", value: 812, share: 44.9, movement: null },
    ]);
  });
});

describe("formatSharePct", () => {
  test("reads exactly like the chart kit's share column", () => {
    for (const n of [0, 0.04, 12.35, 55.05, 99.95, 100]) expect(formatSharePct(n)).toBe(formatShare(n));
  });
});

describe("customerShare (the customer page's share tile)", () => {
  const board = {
    rows: [row({ customerId: "c1", kgG: 995_200, sharePct: 55.1 })],
    totalKgG: 1_807_200,
  };

  test("unknown while the leaderboard has not answered", () => {
    expect(customerShare("c1", 995_200, undefined)).toBeNull();
  });

  test("a customer on the leaderboard reads the leaderboard's own share, so both screens agree", () => {
    // 995.2 / 1807.2 = 55.068..., which plain rounding would show as 55.1 too; force a case where
    // the largest-remainder share differs from plain rounding.
    const skewed = { rows: [row({ customerId: "c1", kgG: 995_200, sharePct: 55.0 })], totalKgG: 1_807_200 };
    expect(customerShare("c1", 995_200, skewed)).toBe(55.0);
    expect(customerShare("c1", 995_200, board)).toBe(55.1);
  });

  test("a customer outside the top rows is their kg over the period's total", () => {
    expect(customerShare("c9", 180_720, board)).toBeCloseTo(10, 6);
  });

  test("nothing dispatched in the period is 0%, not a division by zero", () => {
    expect(customerShare("c9", 0, { rows: [], totalKgG: 0 })).toBe(0);
  });
});
