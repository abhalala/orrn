import { describe, expect, test } from "bun:test";

import {
  costingOn,
  daysBetween,
  driftProjection,
  dueEstimate,
  forecastMonths,
  intervalsG,
  kgPerHour,
  marginOf,
  masterBilletPaise,
  median,
  minutesFor,
  pickCost,
  putRateVersion,
  ratesOn,
  readCostingSettings,
  runCost,
  scaleByPct,
  weekIndex,
  weekLoads,
  weekMinutes,
  weekStart,
  weightedPerKg,
  DEFAULT_COSTING_SETTINGS,
  type StageRateVersion,
} from "./costing";

describe("costing module gate (opt-in)", () => {
  test("an empty list leaves costing off; only a list naming it turns it on", () => {
    expect(costingOn([])).toBe(false);
    expect(costingOn(null)).toBe(false);
    expect(costingOn(undefined)).toBe(false);
    expect(costingOn(["orders", "press"])).toBe(false);
    expect(costingOn(["orders", "Costing"])).toBe(true);
  });
});

describe("settings", () => {
  test("defaults and bad values fall back; versions sort by date", () => {
    const s = readCostingSettings({
      lowMarginBp: 1200,
      workDaysPerWeek: 9,
      hoursPerDay: "x",
      rates: [
        { from: "2026-11-01", stages: { extrusion: { basis: "hour", paise: 150_000 }, casting: { basis: "bad", paise: 1 } } },
        { from: "2026-10-01", stages: { packing: { basis: "kg", paise: 200 } } },
        { from: "nope", stages: {} },
      ],
      lineDowntimeHours: { P1: 8, P2: 999 },
    });
    expect(s.lowMarginBp).toBe(1200);
    expect(s.workDaysPerWeek).toBe(DEFAULT_COSTING_SETTINGS.workDaysPerWeek);
    expect(s.hoursPerDay).toBe(DEFAULT_COSTING_SETTINGS.hoursPerDay);
    expect(s.rates.map((r) => r.from)).toEqual(["2026-10-01", "2026-11-01"]);
    expect(s.rates[1]!.stages).toEqual({ extrusion: { basis: "hour", paise: 150_000, kgPerHour: null } });
    expect(s.lineDowntimeHours).toEqual({ P1: 8 });
  });

  test("the version on a day is the latest one on or before it; a new version replaces the same date", () => {
    const v: StageRateVersion[] = [
      { from: "2026-10-01", stages: {} },
      { from: "2026-11-01", stages: {} },
    ];
    expect(ratesOn(v, "2026-09-30")).toBeNull();
    expect(ratesOn(v, "2026-10-15")!.from).toBe("2026-10-01");
    expect(ratesOn(v, "2026-11-01")!.from).toBe("2026-11-01");
    const next = putRateVersion(v, { from: "2026-10-01", stages: { packing: { basis: "kg", paise: 1, kgPerHour: null } } });
    expect(next).toHaveLength(2);
    expect(next[0]!.stages.packing!.paise).toBe(1);
  });
});

describe("row 16: cost per kg of a run", () => {
  const rates: StageRateVersion = {
    from: "2026-11-01",
    stages: {
      casting: { basis: "kg", paise: 800, kgPerHour: null },
      extrusion: { basis: "hour", paise: 120_000, kgPerHour: null },
      ageing: { basis: "kg", paise: 300, kgPerHour: null },
      finishing: { basis: "hour", paise: 60_000, kgPerHour: 500 },
      packing: { basis: "kg", paise: 200, kgPerHour: null },
    },
  };

  test("worked example: metal from the cast, press yield, stage rates", () => {
    // 1000 kg billets in, 850 kg good: 100 kg butt, 40 kg ends, 10 kg rejects. 4 h of press.
    const c = runCost({
      inputG: 1_000_000,
      goodG: 850_000,
      discardG: 100_000,
      endsG: 40_000,
      rejectG: 10_000,
      runMinutes: 240,
      metal: { basis: "cast", paisePerBilletKg: 22_000 },
      rates,
    });
    expect(c.recoveryBp).toBe(8500);
    // 220 × 1000 / 850 = 258.82 → 25 882 paise
    expect(c.metalPaisePerKg).toBe(25_882);
    expect(c.losses).toEqual([
      { kind: "butt", g: 100_000, paisePerKg: 2_588 },
      { kind: "ends", g: 40_000, paisePerKg: 1_035 },
      { kind: "rejects", g: 10_000, paisePerKg: 259 },
    ]);
    const by = Object.fromEntries(c.stages.map((s) => [s.stage, s.paisePerKg]));
    // casting 8 per billet kg × 1000/850 = 9.41; extrusion 1200/h × 4 h / 850 kg = 5.65; finishing 600/h ÷ 500 kg/h = 1.20
    expect(by).toEqual({ casting: 941, extrusion: 565, ageing: 300, finishing: 120, packing: 200 });
    expect(c.totalPaisePerKg).toBe(25_882 + 941 + 565 + 300 + 120 + 200);
    expect(c.missing).toEqual([]);
  });

  test("a stage with no rate counts as zero and is listed; unknown metal gives no total", () => {
    const c = runCost({ inputG: 1000, goodG: 800, discardG: 200, endsG: 0, rejectG: 0, runMinutes: null, metal: { basis: "none", paisePerBilletKg: null }, rates: null });
    expect(c.metalPaisePerKg).toBeNull();
    expect(c.totalPaisePerKg).toBeNull();
    expect(c.missing).toEqual(["metal", "casting", "extrusion", "ageing", "finishing", "packing"]);
    const d = runCost({ inputG: 1_000_000, goodG: 800_000, discardG: 200_000, endsG: 0, rejectG: 0, runMinutes: null, metal: { basis: "cast", paisePerBilletKg: 20_000 }, rates: null });
    expect(d.totalPaisePerKg).toBe(25_000);
    expect(d.missing).toEqual(["casting", "extrusion", "ageing", "finishing", "packing"]);
  });

  test("an hour rate without trusted run time uses the section speed, else gives no total", () => {
    const base = { inputG: 1_000_000, goodG: 900_000, discardG: 100_000, endsG: 0, rejectG: 0, runMinutes: null, metal: { basis: "cast" as const, paisePerBilletKg: 20_000 } };
    const only: StageRateVersion = { from: "2026-01-01", stages: { extrusion: { basis: "hour", paise: 100_000, kgPerHour: null } } };
    const a = runCost({ ...base, rates: only, fallbackKgPerHour: 250 });
    expect(a.stages.find((s) => s.stage === "extrusion")).toMatchObject({ paisePerKg: 400, note: "section_speed" });
    const b = runCost({ ...base, rates: only });
    expect(b.stages.find((s) => s.stage === "extrusion")).toMatchObject({ paisePerKg: null, note: "no_time" });
    expect(b.totalPaisePerKg).toBeNull();
  });

  test("a section speed that rounded to 0 kg/h does not block the typed throughput", () => {
    const base = { inputG: 1_000_000, goodG: 900_000, discardG: 100_000, endsG: 0, rejectG: 0, runMinutes: null, metal: { basis: "cast" as const, paisePerBilletKg: 20_000 } };
    const typed: StageRateVersion = { from: "2026-01-01", stages: { extrusion: { basis: "hour", paise: 100_000, kgPerHour: 500 } } };
    const c = runCost({ ...base, rates: typed, fallbackKgPerHour: 0 });
    expect(c.stages.find((s) => s.stage === "extrusion")).toMatchObject({ paisePerKg: 200, note: "section_speed" });
    expect(c.totalPaisePerKg).not.toBeNull();
    // A positive section speed still comes first.
    expect(runCost({ ...base, rates: typed, fallbackKgPerHour: 250 }).stages.find((s) => s.stage === "extrusion")!.paisePerKg).toBe(400);
  });

  test("fractional press minutes are kept: a 90 s run is 1.5 min, not 2", () => {
    const only: StageRateVersion = { from: "2026-01-01", stages: { extrusion: { basis: "hour", paise: 120_000, kgPerHour: null } } };
    const c = runCost({ inputG: 12_000, goodG: 10_000, discardG: 2_000, endsG: 0, rejectG: 0, runMinutes: 1.5, metal: { basis: "cast", paisePerBilletKg: 20_000 }, rates: only });
    // 1200 Rs/h × 1.5 min ÷ 60 ÷ 10 kg = 3 Rs/kg
    expect(c.stages.find((s) => s.stage === "extrusion")!.paisePerKg).toBe(300);
  });

  const RUN_MASTER = {
    discardG: 0,
    endsG: 0,
    rejectG: 0,
    runMinutes: null,
    metal: { basis: "master" as const, paisePerBilletKg: 15_789, listPaisePerKg: 25_000, meltYieldBp: 9_500, boughtShareBp: 6_000 },
    rates: null,
  };

  test("metal from the price master: bought share and melt yield, melt loss listed", () => {
    // Rs 250 list, 60 % of the charge is bought scrap, 95 % melt yield: 250 × 0.6 / 0.95 = 157.89
    expect(masterBilletPaise(25_000, 9_500, 6_000)).toBe(15_789);
    expect(masterBilletPaise(25_000, null, null)).toBe(25_000);
    const c = runCost({
      inputG: 1_000_000,
      goodG: 1_000_000,
      discardG: 0,
      endsG: 0,
      rejectG: 0,
      runMinutes: null,
      metal: { basis: "master", paisePerBilletKg: 15_789, listPaisePerKg: 25_000, meltYieldBp: 9_500, boughtShareBp: 6_000 },
      rates: null,
    });
    // Melt loss on the bought share, as the press losses: 250 × 0.6 × 0.05 ÷ 0.95 = 7.89 per billet kg.
    expect(c.losses[0]).toEqual({ kind: "melt", g: null, paisePerKg: 789 });
    // Per good kg like its neighbours: at 80 % recovery it is × 1.25.
    const d = runCost({ ...RUN_MASTER, inputG: 1_000_000, goodG: 800_000 });
    expect(d.losses[0]).toEqual({ kind: "melt", g: null, paisePerKg: 986 });
  });

  test("an hourly casting rate is scaled for press losses like the per-kg rate (80 % recovery)", () => {
    const base = { inputG: 1_000_000, goodG: 800_000, discardG: 200_000, endsG: 0, rejectG: 0, runMinutes: null, metal: { basis: "none" as const, paisePerBilletKg: null } };
    // Rs 10 per billet kg, as a per-kg rate and as Rs 100 an hour at 10 kg an hour.
    const perKg = runCost({ ...base, rates: { from: "2026-01-01", stages: { casting: { basis: "kg", paise: 1_000, kgPerHour: null } } } });
    const hourly = runCost({ ...base, rates: { from: "2026-01-01", stages: { casting: { basis: "hour", paise: 10_000, kgPerHour: 10 } } } });
    expect(perKg.stages.find((s) => s.stage === "casting")!.paisePerKg).toBe(1_250);
    expect(hourly.stages.find((s) => s.stage === "casting")!.paisePerKg).toBe(1_250);
    // Other hourly stages are per good kg already and are not scaled.
    const ageing = runCost({ ...base, rates: { from: "2026-01-01", stages: { ageing: { basis: "hour", paise: 10_000, kgPerHour: 10 } } } });
    expect(ageing.stages.find((s) => s.stage === "ageing")!.paisePerKg).toBe(1_000);
  });

  test("a cast charged mostly from return streams is cheap per billet kg and is not credited again", () => {
    // 1000 kg charge: 200 kg bought at Rs 200, 800 kg plant scrap at no cost; 950 kg billets.
    const perBillet = Math.round((200 * 20_000) / 950);
    const c = runCost({ inputG: 500_000, goodG: 400_000, discardG: 100_000, endsG: 0, rejectG: 0, runMinutes: null, metal: { basis: "cast", paisePerBilletKg: perBillet }, rates: null });
    expect(c.metalPaisePerKg).toBe(Math.round((perBillet * 500) / 400));
  });

  test("weighted per kg skips unknowns", () => {
    expect(weightedPerKg([{ goodG: 1000, paisePerKg: 100 }, { goodG: 3000, paisePerKg: 200 }, { goodG: 5000, paisePerKg: null }])).toBe(175);
    expect(weightedPerKg([{ goodG: 0, paisePerKg: 100 }])).toBeNull();
  });
});

describe("row 17: margin", () => {
  test("margin per kg and share; low below the threshold; unknown cost is never a margin", () => {
    expect(marginOf(30_000, 27_000, 800)).toEqual({ marginPaisePerKg: 3_000, marginBp: 1_000, low: false });
    expect(marginOf(30_000, 28_000, 800)).toEqual({ marginPaisePerKg: 2_000, marginBp: 667, low: true });
    expect(marginOf(30_000, 33_000, 800)).toEqual({ marginPaisePerKg: -3_000, marginBp: -1_000, low: true });
    expect(marginOf(30_000, null, 800)).toBeNull();
    expect(marginOf(null, 20_000, 800)).toBeNull();
    expect(marginOf(0, 20_000, 800)).toBeNull();
  });

  test("cost basis order: own runs, section month, section, plant month, plant", () => {
    expect(pickCost({ actual: 1, section: 2 })).toEqual({ paisePerKg: 1, basis: "actual" });
    expect(pickCost({ sectionMonth: null, section: 2, plant: 3 })).toEqual({ paisePerKg: 2, basis: "section" });
    expect(pickCost({ plantMonth: 4, plant: 3 })).toEqual({ paisePerKg: 4, basis: "plant_month" });
    expect(pickCost({})).toEqual({ paisePerKg: null, basis: "none" });
  });
});

describe("row 51: capacity", () => {
  test("weeks start on Monday; overdue lands in week 0", () => {
    expect(weekStart("2026-11-22")).toBe("2026-11-16"); // a Sunday
    expect(weekStart("2026-11-16")).toBe("2026-11-16");
    expect(daysBetween("2026-11-16", "2026-11-30")).toBe(14);
    expect(weekIndex("2026-11-16", "2026-11-01")).toBe(0);
    expect(weekIndex("2026-11-16", "2026-11-29")).toBe(1);
    expect(weekIndex("2026-11-16", "2026-11-30")).toBe(2);
  });

  test("speed, minutes and a press week", () => {
    expect(kgPerHour(1_000_000, 240)).toBe(250);
    expect(kgPerHour(0, 10)).toBeNull();
    expect(minutesFor(500_000, 250)).toBe(120);
    expect(minutesFor(500_000, null)).toBeNull();
    const s = { ...DEFAULT_COSTING_SETTINGS, workDaysPerWeek: 6, hoursPerDay: 22, downtimeHoursPerWeek: 4, lineDowntimeHours: { P2: 10 } };
    expect(weekMinutes(s, "P1")).toBe((6 * 22 - 4) * 60);
    expect(weekMinutes(s, "P2")).toBe((6 * 22 - 10) * 60);
  });

  test("an over-booked week is flagged with the orders causing it, biggest first", () => {
    const loads = weekLoads({
      firstWeek: "2026-11-16",
      weeks: 2,
      lines: [{ id: "P1", availableMin: 600 }],
      items: [
        { lineId: "P1", week: 0, minutes: 400, g: 100, ref: "SO-1/1" },
        { lineId: "P1", week: 0, minutes: 300, g: 75, ref: "SO-2/1" },
        { lineId: "P1", week: 1, minutes: 100, g: 25, ref: "SO-3/1" },
        { lineId: "P9", week: 0, minutes: 999, g: 1, ref: "ignored" },
      ],
    }).get("P1")!;
    expect(loads[0]).toMatchObject({ start: "2026-11-16", bookedMin: 700, loadBp: 11_667, over: true });
    expect(loads[0]!.refs.map((r) => r.ref)).toEqual(["SO-1/1", "SO-2/1"]);
    expect(loads[1]).toMatchObject({ start: "2026-11-23", bookedMin: 100, over: false });
  });
});

describe("row 52: forecast", () => {
  const months = (start: string, gs: number[]) => {
    const out: { month: string; g: number }[] = [];
    let [y, m] = start.split("-").map(Number) as [number, number];
    for (const g of gs) {
      out.push({ month: `${y}-${String(m).padStart(2, "0")}`, g });
      m++;
      if (m > 12) {
        m = 1;
        y++;
      }
    }
    return out;
  };

  test("too little history says so", () => {
    const r = forecastMonths(months("2026-09", [10, 20]), "2026-11");
    expect(r.method).toBe("too_little");
    expect(r.forecast).toEqual([]);
  });

  test("three-month moving average, with a backtest against what came", () => {
    const r = forecastMonths(months("2026-05", [100, 200, 300, 400, 500, 600]), "2026-11", 2);
    expect(r.method).toBe("ma3");
    expect(r.baseG).toBe(500);
    expect(r.forecast).toEqual([
      { month: "2026-11", g: 500 },
      { month: "2026-12", g: Math.round((500 + 600 + 500) / 3) },
    ]);
    expect(r.backtest).toEqual([
      { month: "2026-08", forecastG: 200, actualG: 400 },
      { month: "2026-09", forecastG: 300, actualG: 500 },
      { month: "2026-10", forecastG: 400, actualG: 600 },
    ]);
    expect(r.errorBp).toBe(Math.round((600 * 10_000) / 1500));
  });

  test("two years of orders bring in a seasonal index", () => {
    // Every March is double an ordinary month.
    const gs = Array.from({ length: 24 }, (_, i) => (i % 12 === 4 ? 200 : 100));
    const r = forecastMonths(months("2024-11", gs), "2026-11", 6);
    expect(r.method).toBe("ma3_seasonal");
    expect(r.seasonBp!["03"]).toBeGreaterThan(r.seasonBp!["04"]!);
    const march = r.forecast.find((f) => f.month === "2027-03")!.g;
    const april = r.forecast.find((f) => f.month === "2027-04")!.g;
    expect(march).toBeGreaterThan(april);
  });

  test("a month with no orders in either year (index 0) gives finite figures, never NaN", () => {
    // Feb 2024 .. Jan 2026; January is a shutdown month (0 kg) both years.
    const series = months("2024-02", Array.from({ length: 24 }, (_, i) => (i === 11 || i === 23 ? 0 : 100 + (i % 12) * 5)));
    const r = forecastMonths(series, "2026-02", 6);
    expect(r.method).toBe("ma3_seasonal");
    expect(r.seasonBp!["01"]).toBe(0);
    for (const f of r.forecast) expect(Number.isFinite(f.g)).toBe(true);
    for (const b of r.backtest) expect(Number.isFinite(b.forecastG)).toBe(true);
    // February is forecast from Nov, Dec and the zero January: the January is left out, not divided by.
    expect(r.forecast[0]!.g).toBeGreaterThan(0);
    // The next January stays a shutdown month.
    const toJan = forecastMonths(months("2024-01", Array.from({ length: 34 }, (_, i) => (i % 12 === 0 ? 0 : 100))), "2026-11", 3);
    expect(toJan.forecast.find((f) => f.month === "2027-01")!.g).toBe(0);
    expect(Number.isFinite(toJan.errorBp ?? 0)).toBe(true);
  });

  test("a scenario scales grams by percent", () => {
    expect(scaleByPct(1000, 20)).toBe(1200);
    expect(scaleByPct(1000, -150)).toBe(0);
  });
});

describe("row 61: die maintenance", () => {
  test("median and intervals", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(3);
    expect(median([])).toBeNull();
    expect(intervalsG([0, 1000, 1000, 3500])).toEqual([1000, 2500]);
  });

  test("the copy's own history wins; section, plant, setting are fallbacks; due, soon, ok", () => {
    const base = { sectionIntervals: [9_000_000, 11_000_000], plantIntervals: [1, 2, 3], settingG: 5_000_000, gPerDay: 200_000, soonBp: 1500, soonDays: 14 };
    const own = dueEstimate({ ...base, sinceG: 4_000_000, copyIntervals: [6_000_000, 8_000_000, 7_000_000] });
    expect(own).toMatchObject({ basis: "copy", intervalG: 7_000_000, samples: 3, leftG: 3_000_000, daysLeft: 15, state: "ok" });
    const sect = dueEstimate({ ...base, sinceG: 9_500_000, copyIntervals: [1] });
    expect(sect).toMatchObject({ basis: "section", intervalG: 10_000_000, leftG: 500_000, state: "soon" });
    const due = dueEstimate({ ...base, sinceG: 12_000_000, copyIntervals: [] });
    expect(due).toMatchObject({ basis: "section", state: "due", daysLeft: 0 });
    const set = dueEstimate({ ...base, sectionIntervals: [], plantIntervals: [], sinceG: 0, copyIntervals: [] });
    expect(set).toMatchObject({ basis: "setting", intervalG: 5_000_000 });
    const none = dueEstimate({ ...base, sectionIntervals: [], plantIntervals: [], settingG: null, sinceG: 0, copyIntervals: [] });
    expect(none).toMatchObject({ basis: "none", state: "unknown" });
  });

  test("drift: too few readings, then a line that meets the band top", () => {
    expect(driftProjection([{ cumG: 0, milli: 1000 }, { cumG: 5_000_000, milli: 1010 }], { minMilli: 950, maxMilli: 1050 }, 6_000_000)).toMatchObject({ state: "too_few", readings: 2 });
    // +10 g per 12 ft every tonne.
    const pts = [0, 1, 2, 3].map((t) => ({ cumG: t * 1_000_000, milli: 1000 + t * 10 }));
    const p = driftProjection(pts, { minMilli: 950, maxMilli: 1050 }, 3_000_000);
    expect(p).toMatchObject({ state: "toward_max", slopeMilliPerT: 10, nowMilli: 1030, leftG: 2_000_000 });
    const flat = driftProjection(pts.map((x) => ({ ...x, milli: 1000 })), { minMilli: 950, maxMilli: 1050 }, 3_000_000);
    expect(flat).toMatchObject({ state: "flat", leftG: null });
  });

  test("drift: a fitted weight already outside the band is 0 left, whichever way the line runs", () => {
    // Rising slope, but already under the minimum: CodeRabbit's case.
    const low = driftProjection([{ cumG: 0, milli: 900 }, { cumG: 1_000_000, milli: 910 }, { cumG: 2_000_000, milli: 920 }], { minMilli: 950, maxMilli: 1050 }, 2_000_000);
    expect(low).toMatchObject({ state: "toward_max", nowMilli: 920, leftG: 0 });
    // Falling slope, already over the maximum.
    const high = driftProjection([{ cumG: 0, milli: 1100 }, { cumG: 1_000_000, milli: 1090 }, { cumG: 2_000_000, milli: 1080 }], { minMilli: 950, maxMilli: 1050 }, 2_000_000);
    expect(high).toMatchObject({ state: "toward_min", leftG: 0 });
    // Flat but outside the band.
    const flatOut = driftProjection([0, 1, 2].map((t) => ({ cumG: t * 1_000_000, milli: 1100 })), { minMilli: 950, maxMilli: 1050 }, 2_000_000);
    expect(flatOut).toMatchObject({ state: "flat", leftG: 0 });
  });
});
