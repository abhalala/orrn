import { describe, expect, test } from "bun:test";

import {
  DAY_MS,
  comparePmDue,
  labourPaise,
  maintWoMoves,
  maintWoNext,
  monthRange,
  pmDue,
  priorityFromCriticality,
  readingFlag,
  reliability,
  spanMinutesIn,
  validReadingLimit,
} from "./maintenance";

const T0 = Date.UTC(2026, 10, 1, 6, 30); // 1 Nov 2026 12:00 IST
const H = 3_600_000;

describe("work order flow", () => {
  test("open moves anywhere live or final; done and cancelled are final", () => {
    expect(maintWoNext("open", "in_progress")).toBe(true);
    expect(maintWoNext("open", "done")).toBe(true);
    expect(maintWoNext("in_progress", "waiting_spares")).toBe(true);
    expect(maintWoNext("waiting_spares", "in_progress")).toBe(true);
    expect(maintWoNext("in_progress", "open")).toBe(false);
    expect(maintWoNext("done", "open")).toBe(false);
    expect(maintWoNext("cancelled", "in_progress")).toBe(false);
    expect(maintWoMoves("done")).toEqual([]);
  });

  test("priority from criticality", () => {
    expect(priorityFromCriticality("A")).toBe("high");
    expect(priorityFromCriticality("B")).toBe("medium");
    expect(priorityFromCriticality("C")).toBe("low");
  });
});

describe("preventive plan due maths", () => {
  test("calendar only: due in 23 days, then soon, then due today, then overdue", () => {
    const plan = { intervalDays: 30, intervalHours: null, baseAtMs: T0, usageMinSinceBase: null };
    expect(pmDue({ ...plan, nowMs: T0 + 7 * DAY_MS })).toMatchObject({ daysLeft: 23, state: "ok", basis: "days", dueAtMs: T0 + 30 * DAY_MS });
    expect(pmDue({ ...plan, nowMs: T0 + 23 * DAY_MS }).state).toBe("soon");
    expect(pmDue({ ...plan, nowMs: T0 + 30 * DAY_MS - H })).toMatchObject({ daysLeft: 0, state: "soon" });
    expect(pmDue({ ...plan, nowMs: T0 + 30 * DAY_MS })).toMatchObject({ daysLeft: 0, state: "overdue" });
    expect(pmDue({ ...plan, nowMs: T0 + 32 * DAY_MS + H })).toMatchObject({ daysLeft: -3, state: "overdue" });
  });

  test("run hours only: 2,000 hour oil change after 1,500 hours run", () => {
    const plan = { intervalDays: null, intervalHours: 2000, baseAtMs: T0, nowMs: T0 + 100 * DAY_MS };
    expect(pmDue({ ...plan, usageMinSinceBase: 1500 * 60 })).toMatchObject({ hoursLeft: 500, hoursRun: 1500, state: "ok", basis: "hours", daysLeft: null });
    // 10 % of 2,000 h = 200 h: soon from 1,800 h.
    expect(pmDue({ ...plan, usageMinSinceBase: 1800 * 60 }).state).toBe("soon");
    expect(pmDue({ ...plan, usageMinSinceBase: 2000 * 60 })).toMatchObject({ hoursLeft: 0, state: "overdue" });
    expect(pmDue({ ...plan, usageMinSinceBase: 2010 * 60 + 30 })).toMatchObject({ hoursLeft: -11, state: "overdue" });
    // A small interval is soon only in its last hour.
    expect(pmDue({ ...plan, intervalHours: 5, usageMinSinceBase: 3 * 60 }).state).toBe("ok");
    expect(pmDue({ ...plan, intervalHours: 5, usageMinSinceBase: 4 * 60 }).state).toBe("soon");
  });

  test("both: whichever comes first", () => {
    const base = { intervalDays: 90, intervalHours: 1000, baseAtMs: T0 };
    // 30 days gone (a third), 900 hours run (90 %): hours come first and are due soon.
    expect(pmDue({ ...base, usageMinSinceBase: 900 * 60, nowMs: T0 + 30 * DAY_MS })).toMatchObject({ basis: "hours", state: "soon", daysLeft: 60, hoursLeft: 100 });
    // 89 days gone, 100 hours run: days come first.
    expect(pmDue({ ...base, usageMinSinceBase: 100 * 60, nowMs: T0 + 89 * DAY_MS })).toMatchObject({ basis: "days", state: "soon" });
    // Overdue on days while the hours are fine: overdue.
    expect(pmDue({ ...base, usageMinSinceBase: 10 * 60, nowMs: T0 + 91 * DAY_MS })).toMatchObject({ basis: "days", state: "overdue" });
    // Both ok: the smaller share left wins (days 50 % vs hours 80 %).
    expect(pmDue({ ...base, usageMinSinceBase: 200 * 60, nowMs: T0 + 45 * DAY_MS }).basis).toBe("days");
  });

  test("a plan needs one interval", () => {
    expect(() => pmDue({ intervalDays: null, intervalHours: null, baseAtMs: T0, usageMinSinceBase: null, nowMs: T0 })).toThrow(RangeError);
  });

  test("order: overdue, soon, then nearest", () => {
    const ok = pmDue({ intervalDays: 30, intervalHours: null, baseAtMs: T0, usageMinSinceBase: null, nowMs: T0 });
    const soon = pmDue({ intervalDays: 30, intervalHours: null, baseAtMs: T0, usageMinSinceBase: null, nowMs: T0 + 25 * DAY_MS });
    const over = pmDue({ intervalDays: 30, intervalHours: null, baseAtMs: T0, usageMinSinceBase: null, nowMs: T0 + 40 * DAY_MS });
    expect([ok, over, soon].sort(comparePmDue).map((d) => d.state)).toEqual(["overdue", "soon", "ok"]);
  });
});

describe("spans and reliability", () => {
  test("span minutes are clipped to the window; an open span runs to its end", () => {
    expect(spanMinutesIn({ startMs: T0, endMs: T0 + 2 * H }, T0 + H, T0 + 10 * H)).toBe(60);
    expect(spanMinutesIn({ startMs: T0, endMs: null }, T0, T0 + H)).toBe(60);
    expect(spanMinutesIn({ startMs: T0 + 2 * H, endMs: T0 + 3 * H }, T0, T0 + H)).toBe(0);
  });

  test("worked example: 30-day month, two breakdowns of 2 h and 4 h", () => {
    const from = T0;
    const to = T0 + 30 * DAY_MS;
    const r = reliability([
      { startMs: T0 + DAY_MS, endMs: T0 + DAY_MS + 2 * H },
      { startMs: T0 + 10 * DAY_MS, endMs: T0 + 10 * DAY_MS + 4 * H },
    ], from, to);
    // 43,200 min in the month, 360 min down: MTTR 180, MTBF (43,200 - 360) / 2 = 21,420.
    expect(r).toEqual({ failures: 2, downtimeMin: 360, mttrMin: 180, mtbfMin: 21_420 });
  });

  test("no failures: no means; a breakdown from last month still adds downtime", () => {
    const r = reliability([{ startMs: T0 - H, endMs: T0 + H }], T0, T0 + DAY_MS);
    expect(r).toEqual({ failures: 0, downtimeMin: 60, mttrMin: null, mtbfMin: null });
  });
});

describe("readings and cost", () => {
  test("limits", () => {
    const lim = { minMilli: 2_000, maxMilli: 8_000 };
    expect(readingFlag(1_999, lim)).toBe("low");
    expect(readingFlag(8_001, lim)).toBe("high");
    expect(readingFlag(8_000, lim)).toBe("ok");
    expect(readingFlag(99_000, { minMilli: null, maxMilli: null })).toBe("ok");
    expect(validReadingLimit({ minMilli: null, maxMilli: null })).toBe(false);
    expect(validReadingLimit({ minMilli: 5, maxMilli: 5 })).toBe(false);
    expect(validReadingLimit({ minMilli: null, maxMilli: 5 })).toBe(true);
  });

  test("labour: 90 minutes at 300 rupees an hour is 450 rupees", () => {
    expect(labourPaise(90, 30_000)).toBe(45_000);
    expect(labourPaise(90, null)).toBeNull();
  });

  test("months", () => {
    expect(monthRange("2026-11", "2027-02")).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
    expect(() => monthRange("2026-12", "2026-11")).toThrow(RangeError);
    expect(() => monthRange("2025-01", "2026-12")).toThrow(RangeError);
  });
});
