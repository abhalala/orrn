import { describe, expect, test } from "bun:test";

import { interpolate } from "@orrn/i18n";
import type { Me } from "@orrn/server/lib/permissions";

import {
  ageingBars,
  companyClock,
  formatCount,
  greetingKey,
  inStock,
  needsStartHere,
  startHereSteps,
  tileHint,
  todayTiles,
  trendSeries,
  type TodayData,
} from "./today-model";

type Role = NonNullable<Me["company"]>["role"];

function me(role: Role, modules?: string[]): Me {
  return {
    user: { id: "u1", name: "Ravi Patel", email: "ravi@orrn.local" },
    company: { id: "c1", name: "Co", slug: "co", status: "active", plan: null, role, modules },
    isPlatformAdmin: false,
    platformRole: null,
  } as Me;
}

const none = { bundles: 0, weightG: 0 };

describe("greetingKey", () => {
  test("morning before noon, afternoon until 5 pm, evening after", () => {
    expect(greetingKey(0)).toBe("today.greetingMorning");
    expect(greetingKey(11)).toBe("today.greetingMorning");
    expect(greetingKey(12)).toBe("today.greetingAfternoon");
    expect(greetingKey(16)).toBe("today.greetingAfternoon");
    expect(greetingKey(17)).toBe("today.greetingEvening");
    expect(greetingKey(23)).toBe("today.greetingEvening");
  });
});

describe("companyClock", () => {
  test("hour and date are read on the plant's wall clock, not the device's", () => {
    // 2026-10-03T20:00Z is 01:30 on Sunday 4 Oct in India, still Saturday evening in UTC.
    const at = Date.parse("2026-10-03T20:00:00Z");
    const india = companyClock("Asia/Kolkata", at, "en");
    expect(india.hour).toBe(1);
    expect(india.date).toBe("Sunday, 4 October");
    const utc = companyClock("UTC", at, "en");
    expect(utc.hour).toBe(20);
    expect(utc.date).toBe("Saturday, 3 October");
  });

  test("Hindi keeps Latin digits; a broken time zone falls back to India", () => {
    const at = Date.parse("2026-10-03T06:00:00Z");
    expect(companyClock("Asia/Kolkata", at, "hi").date).toMatch(/3/);
    expect(companyClock("Not/AZone", at, "en")).toEqual(companyClock("Asia/Kolkata", at, "en"));
  });
});

describe("formatCount", () => {
  test("counts use Indian grouping and still pick the right plural", () => {
    expect(formatCount(1284)).toBe("1,284");
    expect(formatCount(100000)).toBe("1,00,000");
    expect(formatCount(1)).toBe("1");
    const bundles = "{count} {count:bundle|bundles}";
    expect(interpolate(bundles, { count: formatCount(1284) })).toBe("1,284 bundles");
    expect(interpolate(bundles, { count: formatCount(1) })).toBe("1 bundle");
    expect(interpolate(bundles, { count: formatCount(0) })).toBe("0 bundles");
  });
});

describe("inStock", () => {
  test("in stock is available plus held; dispatched and void are not stock", () => {
    expect(
      inStock({
        available: { bundles: 10, weightG: 250_000 },
        reserved: { bundles: 2, weightG: 52_400 },
        dispatched: { bundles: 99, weightG: 9_999_000 },
        void: { bundles: 3, weightG: 75_000 },
      }),
    ).toEqual({ bundles: 12, kg: 302.4 });
  });
});

describe("trendSeries", () => {
  const days = [
    { date: "2026-10-01", packedKgG: 6_420_500, dispatchedKgG: 3_105_000 },
    { date: "2026-10-02", packedKgG: 0, dispatchedKgG: 1_200_250 },
    { date: "2026-10-03", packedKgG: 1_000, dispatchedKgG: 0 },
  ];

  test("two series in kg on calendar days; today, the last day, is partial in both", () => {
    const series = trendSeries(days, { packed: "Packed", dispatched: "Dispatched" });
    expect(series.map((s) => [s.key, s.label])).toEqual([
      ["packed", "Packed"],
      ["dispatched", "Dispatched"],
    ]);
    const [packed, dispatched] = series;
    expect(packed!.points.map((p) => p.v)).toEqual([6420.5, 0, 1]);
    expect(dispatched!.points.map((p) => p.v)).toEqual([3105, 1200.25, 0]);
    // Calendar days as UTC midnight, formatted in UTC so the label is always that day.
    expect(packed!.points[0]!.t.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(packed!.points.map((p) => Boolean(p.partial))).toEqual([false, false, true]);
    expect(dispatched!.points.map((p) => Boolean(p.partial))).toEqual([false, false, true]);
  });

  test("no days, no points", () => {
    expect(trendSeries([], { packed: "P", dispatched: "D" }).every((s) => s.points.length === 0)).toBe(true);
  });
});

describe("ageingBars", () => {
  test("one bar per bucket, oldest last, kg from grams", () => {
    const bars = ageingBars(
      [
        { key: "0-15", minDays: 0, maxDays: 15, bundles: 4, kgG: 18_412_600 },
        { key: "16-30", minDays: 16, maxDays: 30, bundles: 2, kgG: 9_650_200 },
        { key: "31-60", minDays: 31, maxDays: 60, bundles: 1, kgG: 0 },
        { key: "60+", minDays: 61, maxDays: null, bundles: 1, kgG: 3_871_400 },
      ],
      (key) => ({ label: `L ${key}`, short: `S ${key}` }),
    );
    expect(bars).toEqual([
      { key: "0-15", label: "L 0-15", short: "S 0-15", value: 18_412.6 },
      { key: "16-30", label: "L 16-30", short: "S 16-30", value: 9_650.2 },
      { key: "31-60", label: "L 31-60", short: "S 31-60", value: 0 },
      { key: "60+", label: "L 60+", short: "S 60+", value: 3_871.4 },
    ]);
  });
});

describe("start here", () => {
  const done = { dies: true, customers: true, bundles: true, printers: true };

  test("shown while the plant has no die or no bundle yet", () => {
    expect(needsStartHere(done)).toBe(false);
    expect(needsStartHere({ ...done, dies: false })).toBe(true);
    expect(needsStartHere({ ...done, bundles: false })).toBe(true);
    // A missing customer or printer alone doesn't hide the day's numbers.
    expect(needsStartHere({ ...done, customers: false, printers: false })).toBe(false);
  });

  test("four steps in order, each linked only for people who can do it", () => {
    const setup = { dies: true, customers: false, bundles: false, printers: false };
    const owner = startHereSteps(setup, me("owner"));
    expect(owner.map((s) => [s.key, s.done, s.to])).toEqual([
      ["die", true, "/dies"],
      ["customer", false, "/customers"],
      ["pack", false, "/pack/new"],
      ["printer", false, "/printing"],
    ]);
    const viewer = startHereSteps(setup, me("viewer"));
    expect(viewer.map((s) => [s.key, s.to])).toEqual([
      ["die", null],
      ["customer", null],
      ["pack", null],
      ["printer", null],
    ]);
    // An operator packs but can't add dies, customers or printers.
    expect(startHereSteps(setup, me("operator")).map((s) => s.to)).toEqual([null, null, "/pack/new", null]);
  });
});

describe("todayTiles", () => {
  const keys = (m: Me) => todayTiles(m).map((t) => t.key);

  test("owner: Pack, Dispatch, Stock, Guides", () => {
    expect(keys(me("owner"))).toEqual(["pack", "dispatch", "stock", "guides"]);
  });

  test("viewer sees no action tiles at all, only numbers (spec section 3 Today)", () => {
    expect(keys(me("viewer"))).toEqual([]);
  });

  test("people who can neither pack nor work a dispatch get no tiles either", () => {
    expect(keys(me("accountant"))).toEqual([]);
    expect(keys(me("foundry"))).toEqual([]);
  });

  test("office starts dispatches but does not pack: Dispatch, Stock, Guides", () => {
    expect(keys(me("office"))).toEqual(["dispatch", "stock", "guides"]);
  });

  test("operator scans into dispatches, so keeps the Dispatch tile", () => {
    expect(keys(me("operator"))).toEqual(["pack", "dispatch", "stock", "guides"]);
  });

  test("company modules hide tiles for switched-off areas", () => {
    // With bundles and dispatches switched off nothing is left to act on, so no tiles.
    expect(keys(me("owner", ["customers", "dies"]))).toEqual([]);
    expect(keys(me("owner", ["bundles"]))).toEqual(["pack", "stock", "guides"]);
  });

  test("Pack starts a session; Dispatch opens the list", () => {
    const byKey = Object.fromEntries(todayTiles(me("owner")).map((t) => [t.key, t.to]));
    expect(byKey).toEqual({ pack: "/pack/new", dispatch: "/dispatch", stock: "/stock", guides: "/guides" });
  });
});

describe("tileHint", () => {
  const tile = (key: string) => todayTiles(me("owner")).find((t) => t.key === key)!;

  test("Dispatch carries the open count, grouped, or says none are open", () => {
    expect(tileHint(tile("dispatch"), 14)).toEqual({ key: "today.tiles.dispatchHint", vars: { count: "14" } });
    expect(tileHint(tile("dispatch"), 1284)).toEqual({ key: "today.tiles.dispatchHint", vars: { count: "1,284" } });
    expect(tileHint(tile("dispatch"), 0)).toEqual({ key: "today.tiles.dispatchHintNone" });
  });

  test("while the count is unknown (loading or failed) Dispatch still has a line, so tile titles line up", () => {
    expect(tileHint(tile("dispatch"), undefined)).toEqual({ key: "today.tiles.dispatchHintAny" });
  });

  test("other tiles keep their own hint", () => {
    expect(tileHint(tile("pack"), 3)).toEqual({ key: "today.tiles.packHint" });
    expect(tileHint(tile("stock"), undefined)).toEqual({ key: "today.tiles.stockHint" });
    expect(tileHint(tile("guides"), 0)).toEqual({ key: "today.tiles.guidesHint" });
  });
});

describe("TodayData shape", () => {
  test("setup is part of the payload type", () => {
    const sample: Pick<TodayData, "setup" | "packedToday"> = {
      setup: { dies: false, customers: false, bundles: false, printers: false },
      packedToday: none,
    };
    expect(needsStartHere(sample.setup)).toBe(true);
  });
});
