import { describe, expect, test } from "bun:test";

import { createI18n } from "@orrn/i18n";

import { addScenario, bpText, costBasisNote, costedG, csvFile, driftLine, dueLines, emptyRateForm, fullestWeek, hoursText, isConflict, lowMarginShareBp, MAX_SCENARIO, nextRunsLimit, rateVersion, RUNS_MAX, rupeesToPaise, scenarioPct, settingsForm, settingsUpdate, wholeIn } from "./model";
import { parseCostingSearch } from "./search";

const { t } = createI18n("en");
const say = t as unknown as (k: string, v?: Record<string, string | number>) => string;
const kg = (g: number) => `${g / 1000} kg`;

describe("costing words for figures", () => {
  test("basis points read as percents", () => {
    expect(bpText(800)).toBe("8%");
    expect(bpText(1250)).toBe("12.5%");
    expect(bpText(-325)).toBe("-3.25%");
    expect(bpText(null)).toBe("-");
  });
  test("minutes read as hours with one decimal", () => {
    expect(hoursText(90)).toBe("1.5");
    expect(hoursText(0)).toBe("0.0");
    expect(hoursText(1320)).toBe("22.0");
  });
  test("low-margin share is of the costed kg only", () => {
    expect(lowMarginShareBp(250, 1000)).toBe(2500);
    expect(lowMarginShareBp(0, 0)).toBeNull();
    expect(costedG({ kgG: 1000, noRateKgG: 100, noCostKgG: 200 })).toBe(700);
  });
  test("cost basis note lists the biggest share first", () => {
    expect(costBasisNote({ plant: 300, actual: 1200, none: 0 }, say as never, kg)).toBe("its own runs (1.2 kg), the plant's recent runs (0.3 kg)");
  });
  test("file name carries the range", () => {
    expect(csvFile("cost", "2026-11-01", "2026-11-30")).toBe("cost-2026-11-01-2026-11-30.csv");
    expect(csvFile("forecast")).toBe("forecast.csv");
  });
});

describe("die lines", () => {
  const est = { basis: "copy", intervalG: 40_000_000, samples: 3, sinceG: 35_000_000, leftG: 5_000_000, daysLeft: 6, state: "soon", lastAt: null, treatments: 3 } as const;
  test("an estimate names its basis and days left", () => {
    expect(dueLines(est as never, { t: say as never, kg })).toEqual(["35000 kg pressed since the last one", "Typical interval 40000 kg, from this copy's last 3 treatments", "about 6 days left at its recent pace"]);
  });
  test("no history says so", () => {
    expect(dueLines({ ...est, state: "unknown", intervalG: null } as never, { t: say as never, kg })).toEqual(["No treatment on record"]);
  });
  test("drift lines", () => {
    const s = { t: say as never, kg };
    expect(driftLine({ state: "too_few", readings: 1, spanG: 0 } as never, s)).toBe("Needs 3 readings over 2000 kg of pressing (1 so far)");
    expect(driftLine({ state: "toward_max", leftG: 3_000_000 } as never, s)).toBe("About 3000 kg left before it leaves the weight band");
    expect(driftLine({ state: "toward_max", leftG: 0 } as never, s)).toBe("Already outside the weight band");
    expect(driftLine({ state: "flat" } as never, s)).toBe("Weight is steady");
    // A flat line already outside the band reads as out, not steady.
    expect(driftLine({ state: "flat", leftG: 0 } as never, s)).toBe("Already outside the weight band");
  });
});

describe("capacity helpers", () => {
  test("the fullest over-booked week", () => {
    const w = (week: number, loadBp: number, over: boolean) => ({ week, start: "2026-11-23", availableMin: 100, bookedMin: loadBp, loadBp, over, refs: [] });
    const lines = [{ id: "a", code: "P1", name: "One", weeks: [w(0, 9000, false), w(1, 12000, true)] }, { id: "b", code: "P2", name: "Two", weeks: [w(0, 15000, true)] }];
    expect(fullestWeek({ lines })?.line.code).toBe("P2");
    expect(fullestWeek({ lines: [lines[0]!] })?.week.week).toBe(1);
    expect(fullestWeek({ lines: [{ ...lines[0]!, weeks: [w(0, 100, false)] }] })).toBeNull();
  });
  test("what-if percent", () => {
    expect(scenarioPct("20")).toBe(20);
    expect(scenarioPct("-100")).toBe(-100);
    expect(scenarioPct("+5")).toBe(5);
    expect(scenarioPct("501")).toBeNull();
    expect(scenarioPct("2.5")).toBeNull();
  });
});

describe("settings form", () => {
  const view = { lowMarginBp: 800, workDaysPerWeek: 6, hoursPerDay: 22, downtimeHoursPerWeek: 4, lineDowntimeHours: { l1: 8 }, defaultKgPerHour: null, leadDays: 21, nitrideEveryKg: 40_000, correctEveryKg: null, dieSoonBp: 1500, dieSoonDays: 14 };
  test("round trip keeps the server's numbers, empty optionals become null", () => {
    const r = settingsUpdate(settingsForm(view));
    expect(r).toEqual({ ok: true, input: { ...view } });
  });
  test("bad boxes are named", () => {
    const f = { ...settingsForm(view), workDays: "9", lowMargin: "abc", downtimeLine: { l1: "x" } };
    const r = settingsUpdate(f);
    expect(r.ok).toBe(false);
    expect(r.ok ? [] : r.bad.sort()).toEqual(["downtimeLine", "lowMargin", "workDays"]);
  });
  test("rupees go to paise exactly, a decimal comma is refused", () => {
    expect(rupeesToPaise("8.50")).toBe(850);
    expect(rupeesToPaise("1,250")).toBe(125_000);
    expect(rupeesToPaise("2,5")).toBeNull();
    expect(rupeesToPaise("10000001")).toBeNull();
    expect(wholeIn("1,000", 1, 5000)).toBe(1000);
    expect(wholeIn("0", 1, 5)).toBeNull();
  });
  test("a rate version leaves empty stages out and needs kg an hour for hourly non-extrusion", () => {
    const f = emptyRateForm("2026-12-01");
    f.stages.casting.amount = "12.5";
    f.stages.extrusion = { amount: "300", basis: "hour", kgPerHour: "" };
    expect(rateVersion(f)).toEqual({ ok: true, input: { from: "2026-12-01", stages: { casting: { basis: "kg", paise: 1250, kgPerHour: null }, extrusion: { basis: "hour", paise: 30_000, kgPerHour: null } } } });
    f.stages.ageing = { amount: "50", basis: "hour", kgPerHour: "" };
    expect(rateVersion(f)).toEqual({ ok: false, error: "throughput", stage: "ageing" });
    f.stages.ageing.kgPerHour = "400";
    expect(rateVersion(f).ok).toBe(true);
    expect(rateVersion({ ...f, from: "" })).toEqual({ ok: false, error: "date" });
  });
});

describe("costing search", () => {
  test("outlook is the default and stays out of the URL", () => {
    expect(parseCostingSearch({})).toEqual({});
    expect(parseCostingSearch({ tab: "outlook" })).toEqual({});
    expect(parseCostingSearch({ tab: "dies" })).toEqual({ tab: "dies" });
    expect(parseCostingSearch({ tab: "settings" })).toEqual({ tab: "settings" });
    expect(parseCostingSearch({ tab: "nope" })).toEqual({});
    expect(parseCostingSearch({ tab: 3 })).toEqual({});
  });
});

describe("COST-FIX: what-if limit, runs cap, stale save", () => {
  const c = (i: number, pct = 10) => ({ customerId: `c${i}`, name: `C${i}`, pct });
  test("an eleventh customer is refused, not dropped; one already on the list can still change", () => {
    const ten = Array.from({ length: MAX_SCENARIO }, (_, i) => c(i));
    const eleventh = addScenario(ten, c(99));
    expect(eleventh.full).toBe(true);
    expect(eleventh.list).toEqual(ten);
    const changed = addScenario(ten, c(3, -20));
    expect(changed.full).toBe(false);
    expect(changed.list).toHaveLength(MAX_SCENARIO);
    expect(changed.list.find((w) => w.customerId === "c3")!.pct).toBe(-20);
    expect(addScenario([], c(1))).toEqual({ list: [c(1)], full: false });
  });
  test("load more never asks past the server's 200", () => {
    expect(nextRunsLimit(20)).toBe(40);
    expect(nextRunsLimit(180)).toBe(RUNS_MAX);
    expect(nextRunsLimit(200)).toBe(RUNS_MAX);
  });
  test("a stale settings save is told apart by its code", () => {
    expect(isConflict({ data: { code: "CONFLICT" } })).toBe(true);
    expect(isConflict({ data: { code: "BAD_REQUEST" } })).toBe(false);
    expect(isConflict(null)).toBe(false);
  });
});
