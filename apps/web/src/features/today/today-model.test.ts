import { describe, expect, test } from "bun:test";

import { interpolate } from "@orrn/i18n";
import type { Me } from "@orrn/server/lib/permissions";

import {
  ageingBars,
  clockTime,
  companyClock,
  formatCount,
  formatRupees,
  greetingKey,
  inStock,
  needsStartHere,
  newestFirst,
  productionDayCaption,
  sessionSummary,
  startHereIntroKey,
  startHereSteps,
  tileHint,
  tileLayout,
  todaySections,
  todayTiles,
  trendSeries,
  withLiveToday,
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

  test("Gujarati reads the date in Gujarati script with Latin digits", () => {
    const at = Date.parse("2026-10-03T06:00:00Z");
    const gu = companyClock("Asia/Kolkata", at, "gu").date;
    expect(gu).toMatch(/[\u0A80-\u0AFF]/);
    expect(gu).toMatch(/3/);
    expect(gu).not.toMatch(/[\u0AE6-\u0AEF]/);
    expect(gu).not.toBe(companyClock("Asia/Kolkata", at, "en").date);
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
    // A done step has nothing left to open.
    expect(owner.map((s) => [s.key, s.done, s.to])).toEqual([
      ["die", true, null],
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

  test("packing waits for a die: no link to Pack while no die exists, for anyone", () => {
    const noDie = { dies: false, customers: false, bundles: false, printers: false };
    const owner = startHereSteps(noDie, me("owner"));
    const pack = owner.find((s) => s.key === "pack")!;
    expect(pack).toMatchObject({ to: null, waiting: true, allowed: true });
    // The die step itself is open and linked.
    expect(owner.find((s) => s.key === "die")).toMatchObject({ to: "/dies", waiting: false });
    const operator = startHereSteps(noDie, me("operator")).find((s) => s.key === "pack")!;
    expect(operator).toMatchObject({ to: null, waiting: true });
    // Someone who can't pack anyway reads "An admin sets this up", not "after a die".
    expect(startHereSteps(noDie, me("viewer")).find((s) => s.key === "pack")).toMatchObject({ waiting: false, allowed: false });
  });

  test("steps for switched-off areas are left out, so the plant can still finish", () => {
    const setup = { dies: true, customers: false, bundles: false, printers: false };
    const keys = startHereSteps(setup, me("owner", ["bundles", "dies", "dispatches"])).map((s) => s.key);
    expect(keys).toEqual(["die", "pack", "printer"]);
    // No modules set means every area is on.
    expect(startHereSteps(setup, me("owner", [])).map((s) => s.key)).toEqual(["die", "customer", "pack", "printer"]);
  });

  test("the intro speaks to people who set orrn up, and to those who wait for them", () => {
    const setup = { dies: false, customers: false, bundles: false, printers: false };
    expect(startHereIntroKey(startHereSteps(setup, me("owner")))).toBe("today.startHere.body");
    expect(startHereIntroKey(startHereSteps(setup, me("admin")))).toBe("today.startHere.body");
    // An operator can do one of the steps, a viewer none.
    expect(startHereIntroKey(startHereSteps(setup, me("operator")))).toBe("today.startHere.bodyWaiting");
    expect(startHereIntroKey(startHereSteps(setup, me("viewer")))).toBe("today.startHere.bodyWaiting");
    // An owner with only the printer left still sets things up.
    const almost = { dies: true, customers: true, bundles: false, printers: false };
    expect(startHereIntroKey(startHereSteps(almost, me("owner")))).toBe("today.startHere.body");
  });
});

describe("withLiveToday", () => {
  const days = [
    { date: "2026-10-02", packedKgG: 1_000, dispatchedKgG: 2_000 },
    { date: "2026-10-03", packedKgG: 3_000, dispatchedKgG: 4_000 },
    { date: "2026-10-04", packedKgG: 5_000, dispatchedKgG: 0 },
  ];
  const live = (date: string, packedG: number, dispatchedG: number) => ({ date, packedG, dispatchedG });

  test("today's point follows the live numbers, so the chart's so far equals the KPI blocks", () => {
    expect(withLiveToday(days, live("2026-10-04", 809_800, 1_554_300))).toEqual([
      days[0],
      days[1],
      { date: "2026-10-04", packedKgG: 809_800, dispatchedKgG: 1_554_300 },
    ]);
  });

  test("after midnight the chart moves on a day: oldest out, the new day in, same length", () => {
    const next = withLiveToday(days, live("2026-10-05", 0, 0));
    expect(next.map((d) => d.date)).toEqual(["2026-10-03", "2026-10-04", "2026-10-05"]);
    expect(next.at(-1)).toEqual({ date: "2026-10-05", packedKgG: 0, dispatchedKgG: 0 });
    // Month and year ends roll the same way.
    const dec = [{ date: "2026-12-31", packedKgG: 1, dispatchedKgG: 1 }];
    expect(withLiveToday(dec, live("2027-01-01", 7, 0)).map((d) => d.date)).toEqual(["2027-01-01"]);
  });

  test("older live numbers, a gap of days, or no live numbers leave the chart as it is", () => {
    expect(withLiveToday(days, live("2026-10-03", 9, 9))).toEqual(days);
    expect(withLiveToday(days, live("2026-10-09", 9, 9))).toEqual(days);
    expect(withLiveToday(days, undefined)).toEqual(days);
    expect(withLiveToday([], live("2026-10-04", 9, 9))).toEqual([]);
  });
});

describe("todaySections", () => {
  test("lists follow the company's modules, like the nav", () => {
    expect(todaySections(me("owner"))).toEqual({ dispatches: true, sessions: true });
    expect(todaySections(me("owner", ["bundles", "dies"]))).toEqual({ dispatches: false, sessions: true });
    expect(todaySections(me("owner", ["dispatches", "customers"]))).toEqual({ dispatches: true, sessions: false });
    expect(todaySections(me("viewer", []))).toEqual({ dispatches: true, sessions: true });
  });
});

describe("clockTime", () => {
  test("session times read on the plant's clock, not the device's", () => {
    // 2026-10-04T08:35Z is 14:05 in India and 04:35 in New York (EDT).
    expect(clockTime("Asia/Kolkata")("2026-10-04T08:35:00.000Z")).toBe("14:05");
    expect(clockTime("America/New_York")("2026-10-04T08:35:00.000Z")).toBe("04:35");
    expect(clockTime("UTC")(Date.parse("2026-10-04T23:59:00Z"))).toBe("23:59");
  });

  test("a broken time zone falls back to India", () => {
    expect(clockTime("Not/AZone")("2026-10-04T08:35:00.000Z")).toBe("14:05");
  });
});

describe("sessionSummary", () => {
  test("bundles and kg, or 'all void' when every bundle of the session was voided", () => {
    expect(sessionSummary({ bundles: 14, weightG: 682_400 })).toEqual({
      key: "units.bundlesKg",
      vars: { bundles: "14", kg: "682.4" },
    });
    expect(sessionSummary({ bundles: 0, weightG: 0 })).toEqual({ key: "today.sessionVoided" });
  });
});

describe("newestFirst", () => {
  test("the trend's table starts with today so far, then yesterday, back to 90 days ago", () => {
    const table = {
      columns: [{ key: "date", header: "Day" }],
      rows: [{ date: "2 Oct" }, { date: "3 Oct" }, { date: "4 Oct, so far" }],
    };
    expect(newestFirst(table).rows).toEqual([{ date: "4 Oct, so far" }, { date: "3 Oct" }, { date: "2 Oct" }]);
    expect(newestFirst(table).columns).toBe(table.columns);
    // The kit's own table is left as it was (it is memoised by the chart).
    expect(table.rows[0]).toEqual({ date: "2 Oct" });
  });
});

describe("tileLayout", () => {
  test("columns follow the number of tiles, and an odd last tile fills its phone row", () => {
    expect(tileLayout(4)).toEqual({ grid: "grid-cols-2 md:grid-cols-4", spanLast: false });
    expect(tileLayout(3)).toEqual({ grid: "grid-cols-2 md:grid-cols-3", spanLast: true });
    expect(tileLayout(2)).toEqual({ grid: "grid-cols-2", spanLast: false });
    expect(tileLayout(1)).toEqual({ grid: "grid-cols-1", spanLast: false });
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

describe("productionDayCaption", () => {
  const shift = { id: "s1", name: "Day", seq: 1 };
  const afternoon = Date.UTC(2026, 9, 24, 8, 52); // 14:22 IST on 24 Oct
  const earlyMorning = Date.UTC(2026, 9, 24, 2, 0); // 07:30 IST on 24 Oct

  test("14:22 with Day from 08:00: the production day is the calendar day, no 'before start' note", () => {
    const pd = { day: "2026-10-24", startMs: Date.UTC(2026, 9, 24, 2, 30), shiftsSet: true, shift };
    expect(productionDayCaption(pd, "Asia/Kolkata", "en", afternoon)).toEqual({
      day: "24 Oct",
      from: "08:00",
      calendar: "24 Oct",
      beforeStart: false,
      shiftName: "Day",
    });
  });

  test("07:30 before shift 1 starts: still 23 Oct's production day, and the caption says why", () => {
    const pd = { day: "2026-10-23", startMs: Date.UTC(2026, 9, 23, 2, 30), shiftsSet: true, shift: { id: "s2", name: "Night", seq: 2 } };
    const caption = productionDayCaption(pd, "Asia/Kolkata", "en", earlyMorning);
    expect(caption).toMatchObject({ day: "23 Oct", from: "08:00", calendar: "24 Oct", beforeStart: true, shiftName: "Night" });
  });

  test("no shifts saved: the day starts at midnight, so there is no start time to print", () => {
    const pd = { day: "2026-10-24", startMs: Date.UTC(2026, 9, 23, 18, 30), shiftsSet: false, shift: null };
    const caption = productionDayCaption(pd, "Asia/Kolkata", "en", afternoon);
    expect(caption.from).toBeNull();
    expect(caption.beforeStart).toBe(false);
    expect(caption.shiftName).toBeNull();
  });

  test("Hindi and Gujarati dates keep Latin digits", () => {
    const pd = { day: "2026-10-24", startMs: Date.UTC(2026, 9, 24, 2, 30), shiftsSet: true, shift };
    for (const locale of ["hi", "gu"]) {
      const caption = productionDayCaption(pd, "Asia/Kolkata", locale, afternoon);
      expect(caption.day).toMatch(/^24 /);
      expect(caption.from).toBe("08:00");
    }
  });
});

describe("Today for a viewer and the rate slice", () => {
  test("the KPI-only scope leaves both lists out; the full scope follows the modules", () => {
    expect(todaySections(me("viewer"), "kpis")).toEqual({ dispatches: false, sessions: false });
    expect(todaySections(me("owner"), "full")).toEqual({ dispatches: true, sessions: true });
  });

  test("rupees come from paise with Indian grouping and two decimals", () => {
    expect(formatRupees(12_345_678)).toBe("\u20B91,23,456.78");
    expect(formatRupees(0)).toBe("\u20B90.00");
  });
});
