import { describe, expect, test } from "bun:test";

import {
  DAY_MS,
  comparePmDue,
  dayNumber,
  labourPaise,
  maintWoMoves,
  maintWoNext,
  mergedMinutes,
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
/** The IST plant day of an instant (IST is UTC+5:30 all year). */
const istDay = (ms: number) => {
  const d = new Date(ms + 5.5 * H);
  return dayNumber({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() });
};

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
  test("calendar only: due in 23 days, then soon, then due today, then overdue (plant days)", () => {
    const plan = { intervalDays: 30, intervalHours: null, baseAtMs: T0, usageMinSinceBase: null, dayOf: istDay };
    expect(pmDue({ ...plan, nowMs: T0 + 7 * DAY_MS })).toMatchObject({ daysLeft: 23, state: "ok", basis: "days", dueAtMs: T0 + 30 * DAY_MS });
    expect(pmDue({ ...plan, nowMs: T0 + 23 * DAY_MS }).state).toBe("soon");
    expect(pmDue({ ...plan, nowMs: T0 + 30 * DAY_MS - H })).toMatchObject({ daysLeft: 0, state: "soon" });
    // The due day is "due today" all day, also after the hour it ran out.
    expect(pmDue({ ...plan, nowMs: T0 + 30 * DAY_MS })).toMatchObject({ daysLeft: 0, state: "soon" });
    expect(pmDue({ ...plan, nowMs: T0 + 30 * DAY_MS + 11 * H })).toMatchObject({ daysLeft: 0, state: "soon" });
    // 2 days and 1 hour past the due hour (14:30 IST on 3 Dec): two plant days late, not three.
    expect(pmDue({ ...plan, nowMs: T0 + 32 * DAY_MS + H })).toMatchObject({ daysLeft: -2, state: "overdue" });
    // Next plant day: overdue by 1.
    expect(pmDue({ ...plan, nowMs: T0 + 30 * DAY_MS + 12 * H })).toMatchObject({ daysLeft: -1, state: "overdue" });
  });

  test("plant days, not 24-hour blocks: reset at 17:00 IST with 30 days is due tomorrow at 18:00 on day 29", () => {
    const base = Date.UTC(2026, 10, 1, 11, 30); // 1 Nov 17:00 IST
    const plan = { intervalDays: 30, intervalHours: null, baseAtMs: base, usageMinSinceBase: null, dayOf: istDay };
    expect(pmDue({ ...plan, nowMs: base + 29 * DAY_MS + H })).toMatchObject({ daysLeft: 1, state: "soon" });
    // 23:30 IST on day 29 is still the same plant day in IST, though a new day in UTC.
    expect(pmDue({ ...plan, nowMs: base + 29 * DAY_MS + 6.5 * H })).toMatchObject({ daysLeft: 1 });
    // One hour past due: due today, not "overdue by 1 day".
    expect(pmDue({ ...plan, nowMs: base + 30 * DAY_MS + H })).toMatchObject({ daysLeft: 0, state: "soon" });
  });

  test("run hours only: 2,000 hour oil change after 1,500 hours run", () => {
    const plan = { intervalDays: null, intervalHours: 2000, baseAtMs: T0, nowMs: T0 + 100 * DAY_MS };
    expect(pmDue({ ...plan, usageMinSinceBase: 1500 * 60 })).toMatchObject({ hoursLeft: 500, hoursRun: 1500, state: "ok", basis: "hours", daysLeft: null });
    // 10 % of 2,000 h = 200 h: soon from 1,800 h.
    expect(pmDue({ ...plan, usageMinSinceBase: 1800 * 60 }).state).toBe("soon");
    expect(pmDue({ ...plan, usageMinSinceBase: 2000 * 60 })).toMatchObject({ hoursLeft: 0, state: "overdue" });
    expect(pmDue({ ...plan, usageMinSinceBase: 2010 * 60 + 30 })).toMatchObject({ hoursLeft: -11, state: "overdue" });
    // 30 minutes left: one run hour left (rounded up), never "0 left" while time is left.
    expect(pmDue({ ...plan, usageMinSinceBase: 1999 * 60 + 30 })).toMatchObject({ hoursLeft: 1, state: "soon" });
    expect(pmDue({ ...plan, usageMinSinceBase: 1998 * 60 + 1 })).toMatchObject({ hoursLeft: 2 });
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

describe("plan due across a clock change (review round 3)", () => {
  /** The London plant day of an instant (BST to GMT on Sun 25 Oct 2026 at 02:00 BST). */
  const londonDay = (ms: number) => {
    const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
    const [y, m, d] = p.split("-").map(Number);
    return dayNumber({ year: y!, month: m!, day: d! });
  };
  test("a 1-day plan reset at 00:30 on the day the clock goes back is due the next plant day, not the same day", () => {
    const base = Date.UTC(2026, 9, 24, 23, 30); // 25 Oct 2026 00:30 BST
    const due = pmDue({ intervalDays: 1, intervalHours: null, baseAtMs: base, usageMinSinceBase: null, nowMs: base, dayOf: londonDay });
    expect(due.daysLeft).toBe(1);
    expect(londonDay(due.dueAtMs!)).toBe(londonDay(base) + 1);
  });
  test("IST (no clock change) keeps base plus whole days", () => {
    const due = pmDue({ intervalDays: 30, intervalHours: null, baseAtMs: T0, usageMinSinceBase: null, nowMs: T0, dayOf: istDay });
    expect(due.dueAtMs).toBe(T0 + 30 * DAY_MS);
    expect(due.daysLeft).toBe(30);
  });
});

describe("reliability counts overlapping breakdowns once (review round 3)", () => {
  test("two breakdown work orders open together: down time is their union", () => {
    const from = T0;
    const to = T0 + 30 * DAY_MS;
    const r = reliability(
      [
        { startMs: T0 + 10 * H, endMs: T0 + 14 * H },
        { startMs: T0 + 12 * H, endMs: T0 + 16 * H },
      ],
      from,
      to,
    );
    expect(r.failures).toBe(2);
    expect(r.downtimeMin).toBe(6 * 60);
    expect(r.mttrMin).toBe(4 * 60);
    expect(r.mtbfMin).toBe(Math.round((30 * 24 * 60 - 6 * 60) / 2));
  });
});

describe("spans and reliability", () => {
  test("span minutes are clipped to the window; an open span runs to its end", () => {
    expect(spanMinutesIn({ startMs: T0, endMs: T0 + 2 * H }, T0 + H, T0 + 10 * H)).toBe(60);
    expect(spanMinutesIn({ startMs: T0, endMs: null }, T0, T0 + H)).toBe(60);
    expect(spanMinutesIn({ startMs: T0 + 2 * H, endMs: T0 + 3 * H }, T0, T0 + H)).toBe(0);
  });

  test("merged minutes: overlapping cuts count once", () => {
    expect(mergedMinutes([{ startMs: T0, endMs: T0 + 2 * H }, { startMs: T0 + H, endMs: T0 + 3 * H }, { startMs: T0 + 5 * H, endMs: T0 + 6 * H }])).toBe(240);
    expect(mergedMinutes([{ startMs: T0, endMs: T0 + 4 * H }, { startMs: T0 + H, endMs: T0 + 2 * H }])).toBe(240);
    expect(mergedMinutes([{ startMs: T0 + H, endMs: T0 }])).toBe(0);
    expect(mergedMinutes([])).toBe(0);
  });

  test("a breakdown across months: wholly in the month it started for count and MTTR; downtime clipped", () => {
    const oct = T0 - 31 * DAY_MS; // 1 Oct
    const nov = T0;
    const dec = T0 + 30 * DAY_MS;
    // 25 Oct 12:00 to 5 Nov 12:00 (11 days), then a 30-minute breakdown on 12 Nov.
    const events = [
      { startMs: oct + 24 * DAY_MS, endMs: nov + 4 * DAY_MS },
      { startMs: nov + 11 * DAY_MS, endMs: nov + 11 * DAY_MS + H / 2 },
    ];
    const october = reliability(events, oct, nov);
    expect(october).toMatchObject({ failures: 1, downtimeMin: 7 * 24 * 60, mttrMin: 11 * 24 * 60 });
    const november = reliability(events, nov, dec);
    expect(november).toMatchObject({ failures: 1, downtimeMin: 4 * 24 * 60 + 30, mttrMin: 30 });
    expect(november.mtbfMin).toBe(30 * 24 * 60 - (4 * 24 * 60 + 30));
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
