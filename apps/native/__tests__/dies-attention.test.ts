import { describe, expect, test } from "bun:test";

import {
  attentionReasons,
  filterAttention,
  rankAttention,
  reasonCounts,
  restPageOffsets,
  STALE_READING_DAYS,
  type AttentionCopy,
} from "../features/dies/attention";

const NOW = Date.UTC(2026, 9, 24, 10, 0, 0);
const DAY = 86_400_000;

function copy(over: Partial<AttentionCopy> & { id: string; code: string }): AttentionCopy {
  return { status: "available", tone: "green", position: "in", percentTenths: 11, latestMilli: 5967, latestReadAt: NOW - DAY, ...over };
}

describe("attentionReasons (spec E1 Native: above band, no reading 30 days, at_maker, at_nitriding, open issue, on_trial)", () => {
  test("a copy in band, read yesterday, in the rack needs nothing", () => {
    expect(attentionReasons(copy({ id: "a", code: "12170-1" }), NOW)).toEqual([]);
  });

  test("above band is the server's position, whatever the tone", () => {
    expect(attentionReasons(copy({ id: "a", code: "12170-1", position: "above", tone: "red", percentTenths: 98 }), NOW)).toEqual(["above_band"]);
    expect(attentionReasons(copy({ id: "a", code: "12170-1", position: "below", tone: "under" }), NOW)).toEqual([]);
  });

  test("a reading older than 30 days is stale; exactly 30 days is not", () => {
    expect(STALE_READING_DAYS).toBe(30);
    expect(attentionReasons(copy({ id: "a", code: "x-1", latestReadAt: NOW - 30 * DAY }), NOW)).toEqual([]);
    expect(attentionReasons(copy({ id: "a", code: "x-1", latestReadAt: NOW - 30 * DAY - 1 }), NOW)).toEqual(["stale_reading"]);
  });

  test("a copy never read is due a reading, but not while it is out of the room", () => {
    expect(attentionReasons(copy({ id: "a", code: "x-1", latestMilli: null, latestReadAt: null, tone: "none", position: null, percentTenths: null }), NOW)).toEqual(["never_read"]);
    expect(attentionReasons(copy({ id: "a", code: "x-1", status: "at_maker", latestMilli: null, latestReadAt: null, position: null }), NOW)).toEqual(["at_maker"]);
    expect(attentionReasons(copy({ id: "a", code: "x-1", status: "at_nitriding", latestReadAt: NOW - 90 * DAY }), NOW)).toEqual(["at_nitriding"]);
  });

  test("without a read date in the list, only never-read can be told (no false stale)", () => {
    expect(attentionReasons(copy({ id: "a", code: "x-1", latestReadAt: undefined }), NOW)).toEqual([]);
    expect(attentionReasons(copy({ id: "a", code: "x-1", latestReadAt: null }), NOW)).toEqual([]);
  });

  test("status reasons: nitriding, maker, trial, and an issued copy has an open issue", () => {
    expect(attentionReasons(copy({ id: "a", code: "x-1", status: "at_nitriding" }), NOW)).toEqual(["at_nitriding"]);
    expect(attentionReasons(copy({ id: "a", code: "x-1", status: "at_maker" }), NOW)).toEqual(["at_maker"]);
    expect(attentionReasons(copy({ id: "a", code: "x-1", status: "on_trial" }), NOW)).toEqual(["on_trial"]);
    expect(attentionReasons(copy({ id: "a", code: "x-1", status: "in_use" }), NOW)).toEqual(["open_issue"]);
  });

  test("a copy can carry several reasons", () => {
    const r = attentionReasons(copy({ id: "a", code: "x-1", status: "in_use", position: "above", tone: "red", latestReadAt: NOW - 40 * DAY }), NOW);
    expect(r).toEqual(["above_band", "open_issue", "stale_reading"]);
  });

  test("a retired copy is never on the list", () => {
    expect(attentionReasons(copy({ id: "a", code: "x-1", status: "retired", position: "above", latestMilli: null }), NOW)).toEqual([]);
  });
});

describe("rankAttention", () => {
  const rows = [
    copy({ id: "stale", code: "14701-2", latestReadAt: NOW - 45 * DAY }),
    copy({ id: "issued", code: "14701-1", status: "in_use" }),
    copy({ id: "nitr", code: "2207-1", status: "at_nitriding" }),
    copy({ id: "maker", code: "2207-3", status: "at_maker" }),
    copy({ id: "trial", code: "2207-2", status: "on_trial" }),
    copy({ id: "above-small", code: "12170-2", position: "above", tone: "amber", percentTenths: 91 }),
    copy({ id: "above-big", code: "12170-10", position: "above", tone: "red", percentTenths: 120 }),
    copy({ id: "never", code: "15000-1", latestMilli: null, latestReadAt: null, position: null, tone: "none", percentTenths: null }),
    copy({ id: "fine", code: "9999-1" }),
    copy({ id: "gone", code: "9999-2", status: "retired", position: "above" }),
  ];

  test("above band first (worst drift first), then nitriding, maker, trial, on press, stale, never read", () => {
    expect(rankAttention(rows, NOW).map((r) => r.copy.id)).toEqual(["above-big", "above-small", "nitr", "maker", "trial", "issued", "stale", "never"]);
  });

  test("copies that need nothing and retired copies are left out", () => {
    const ids = rankAttention(rows, NOW).map((r) => r.copy.id);
    expect(ids).not.toContain("fine");
    expect(ids).not.toContain("gone");
  });

  test("ties break on more reasons, then on the copy code in natural order (2207-2 before 14701-1)", () => {
    const tied = [
      copy({ id: "b", code: "14701-1", status: "on_trial" }),
      copy({ id: "a", code: "2207-2", status: "on_trial" }),
      copy({ id: "c", code: "2207-10", status: "on_trial" }),
      copy({ id: "d", code: "9000-1", status: "on_trial", latestMilli: null, latestReadAt: null }),
    ];
    expect(rankAttention(tied, NOW).map((r) => r.copy.id)).toEqual(["d", "a", "c", "b"]);
  });

  test("an empty rack gives an empty list", () => {
    expect(rankAttention([], NOW)).toEqual([]);
  });
});

describe("filters and counts", () => {
  const ranked = rankAttention(
    [
      copy({ id: "a", code: "1-1", status: "in_use", position: "above", tone: "red", percentTenths: 100 }),
      copy({ id: "b", code: "1-2", status: "at_maker" }),
      copy({ id: "c", code: "1-3", status: "in_use" }),
    ],
    NOW,
  );

  test("a reason chip keeps the rows that carry it, 'all' keeps everything", () => {
    expect(filterAttention(ranked, "all")).toHaveLength(3);
    expect(filterAttention(ranked, "open_issue").map((r) => r.copy.id)).toEqual(["a", "c"]);
    expect(filterAttention(ranked, "at_maker").map((r) => r.copy.id)).toEqual(["b"]);
    expect(filterAttention(ranked, "on_trial")).toEqual([]);
  });

  test("a row with two reasons counts under both", () => {
    const counts = reasonCounts(ranked);
    expect(counts.above_band).toBe(1);
    expect(counts.open_issue).toBe(2);
    expect(counts.at_maker).toBe(1);
    expect(counts.never_read).toBe(0);
  });
});

describe("restPageOffsets (m-10: few requests, capped)", () => {
  test("one page holds up to its limit; the rest follow in one batch", () => {
    expect(restPageOffsets(0, 200, 10)).toEqual([]);
    expect(restPageOffsets(200, 200, 10)).toEqual([]);
    expect(restPageOffsets(201, 200, 10)).toEqual([200]);
    expect(restPageOffsets(650, 200, 10)).toEqual([200, 400, 600]);
  });

  test("the cap counts the first page: 10 pages at most, however large the rack", () => {
    expect(restPageOffsets(100_000, 200, 10)).toHaveLength(9);
    expect(restPageOffsets(100_000, 200, 10).at(-1)).toBe(1800);
    expect(restPageOffsets(5, 200, 0)).toEqual([]);
  });
});
