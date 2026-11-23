/**
 * Plant maintenance (XE parity lane MAINT, rows 63 to 68). Pure rules only: the asset and work order
 * vocabularies, the work order status flow, priority from criticality, preventive plan due maths
 * (calendar days, run hours, or both, whichever comes first), condition reading limits, and the
 * reliability figures (MTBF, MTTR, downtime) of a list of breakdown events. The server gathers the
 * rows (run hours from press runs, melts and oven batches) and calls these; clients never compute them.
 */

// ---------------------------------------------------------------------------
// Vocabularies
// ---------------------------------------------------------------------------

export const MAINT_ASSET_KINDS = ["press", "furnace", "oven", "compressor", "crane", "dg_set", "other"] as const;
export type MaintAssetKind = (typeof MAINT_ASSET_KINDS)[number];

/** The masters an asset may point at (by kind plus id): presses, furnaces and ageing ovens. */
export const MAINT_LINK_KINDS = ["press", "furnace", "oven"] as const;
export type MaintLinkKind = (typeof MAINT_LINK_KINDS)[number];

export const MAINT_CRITICALITIES = ["A", "B", "C"] as const;
export type MaintCriticality = (typeof MAINT_CRITICALITIES)[number];

export const MAINT_ASSET_STATUSES = ["running", "standby", "under_repair", "retired"] as const;
export type MaintAssetStatus = (typeof MAINT_ASSET_STATUSES)[number];

/**
 * Breakdown: the asset failed. Preventive: from a plan. Condition: raised from an out-of-limit reading
 * while the asset still runs; it is not a failure, so it never counts in breakdowns, MTTR or MTBF.
 */
export const MAINT_WO_KINDS = ["breakdown", "preventive", "condition"] as const;
export type MaintWoKind = (typeof MAINT_WO_KINDS)[number];

export const MAINT_WO_STATUSES = ["open", "in_progress", "waiting_spares", "done", "cancelled"] as const;
export type MaintWoStatus = (typeof MAINT_WO_STATUSES)[number];

/** Where a work order came from: typed by hand, a press downtime entry, a preventive plan, a reading. */
export const MAINT_WO_SOURCES = ["manual", "downtime", "plan", "reading"] as const;
export type MaintWoSource = (typeof MAINT_WO_SOURCES)[number];

export const MAINT_PRIORITIES = ["high", "medium", "low"] as const;
export type MaintPriority = (typeof MAINT_PRIORITIES)[number];

/** Statuses a work order is still being worked in (it counts as open on the screens). */
export const MAINT_WO_LIVE: readonly MaintWoStatus[] = ["open", "in_progress", "waiting_spares"];

export function isMaintWoLive(status: MaintWoStatus): boolean {
  return MAINT_WO_LIVE.includes(status);
}

// ---------------------------------------------------------------------------
// Work order flow
// ---------------------------------------------------------------------------

const WO_NEXT: Readonly<Record<MaintWoStatus, readonly MaintWoStatus[]>> = {
  open: ["in_progress", "waiting_spares", "done", "cancelled"],
  in_progress: ["waiting_spares", "done", "cancelled"],
  waiting_spares: ["in_progress", "done", "cancelled"],
  done: [],
  cancelled: [],
};

/** True when a work order may move from `from` to `to`. Done and cancelled are final. */
export function maintWoNext(from: MaintWoStatus, to: MaintWoStatus): boolean {
  return WO_NEXT[from].includes(to);
}

/** The statuses a work order in `from` may move to, in screen order. */
export function maintWoMoves(from: MaintWoStatus): readonly MaintWoStatus[] {
  return WO_NEXT[from];
}

/** Priority follows the asset's criticality: A high, B medium, C low. */
export function priorityFromCriticality(criticality: MaintCriticality): MaintPriority {
  return criticality === "A" ? "high" : criticality === "B" ? "medium" : "low";
}

// ---------------------------------------------------------------------------
// Preventive plans: due maths (row 64)
// ---------------------------------------------------------------------------

export const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
/** A plan is "due soon" this many days before its calendar date. */
export const PM_SOON_DAYS = 7;
/** A plan is "due soon" when this share of its run hours is left (10 %), at least 1 hour. */
export const PM_SOON_HOURS_SHARE = 0.1;

export const MAX_PM_INTERVAL_DAYS = 3_650;
export const MAX_PM_INTERVAL_HOURS = 100_000;

export type PmDueInput = {
  /** Calendar interval in days, or null for a usage-only plan. */
  intervalDays: number | null;
  /** Usage interval in run hours, or null for a calendar-only plan. */
  intervalHours: number | null;
  /** When the plan last reset: the last preventive work order done, else the day the plan began. */
  baseAtMs: number;
  /** Run minutes of the asset since `baseAtMs` (null when the plan has no hours interval). */
  usageMinSinceBase: number | null;
  nowMs: number;
  /**
   * The plant day of an instant as a day number (consecutive days differ by 1), on the plant's own
   * clock. The server passes the company timezone's day (`plantDayNumber`); without it, UTC days.
   */
  dayOf?: (ms: number) => number;
};

export type PmDueState = "ok" | "soon" | "overdue";

export type PmDue = {
  /** Instant the days interval runs out (null without a days interval); it falls due on that plant day. */
  dueAtMs: number | null;
  /** Plant days until the due day; 0 = due today; negative = overdue by that many plant days. */
  daysLeft: number | null;
  /** Run hours left, rounded UP while time is left (never 0 then); 0 or negative = over by that many. */
  hoursLeft: number | null;
  /** Run hours since the last reset, whole hours rounded down. */
  hoursRun: number | null;
  state: PmDueState;
  /** The interval that comes first: the one already overdue, else the one with the smaller share left. */
  basis: "days" | "hours";
};

const STATE_RANK: Record<PmDueState, number> = { ok: 0, soon: 1, overdue: 2 };

/** Day number of a calendar date (days since 1970-01-01), for counting plant days across months. */
export function dayNumber(ymd: { year: number; month: number; day: number }): number {
  return Math.floor(Date.UTC(ymd.year, ymd.month - 1, ymd.day) / DAY_MS);
}

const utcDay = (ms: number) => Math.floor(ms / DAY_MS);

/**
 * When a preventive plan falls due. A plan with both intervals is due at whichever comes first.
 * Days are plant days: a plan falls due on the plant day its interval runs out, is "due today" all
 * that day and overdue from the next plant day. Throws RangeError for a plan with neither interval.
 */
export function pmDue(input: PmDueInput): PmDue {
  const { intervalDays, intervalHours, baseAtMs, nowMs } = input;
  const dayOf = input.dayOf ?? utcDay;
  if (intervalDays == null && intervalHours == null) throw new RangeError("A plan needs days, run hours or both");

  let days: { state: PmDueState; share: number; dueAtMs: number; daysLeft: number } | null = null;
  if (intervalDays != null) {
    // Calendar days on the plant clock, not 24-hour steps: across a clock change the due day is still
    // the base's plant day plus the interval. `dueAtMs` is moved by whole hours onto that day.
    const dueDay = dayOf(baseAtMs) + intervalDays;
    let dueAtMs = baseAtMs + intervalDays * DAY_MS;
    for (let i = 0; i < 48 && dayOf(dueAtMs) < dueDay; i += 1) dueAtMs += HOUR_MS;
    for (let i = 0; i < 48 && dayOf(dueAtMs) > dueDay; i += 1) dueAtMs -= HOUR_MS;
    const daysLeft = dueDay - dayOf(nowMs);
    const state: PmDueState = daysLeft < 0 ? "overdue" : daysLeft <= PM_SOON_DAYS ? "soon" : "ok";
    days = { state, share: daysLeft / intervalDays, dueAtMs, daysLeft };
  }

  let hours: { state: PmDueState; share: number; hoursLeft: number; hoursRun: number } | null = null;
  if (intervalHours != null) {
    const usedMin = Math.max(0, input.usageMinSinceBase ?? 0);
    const leftMin = intervalHours * 60 - usedMin;
    const soonMin = Math.max(60, intervalHours * 60 * PM_SOON_HOURS_SHARE);
    const state: PmDueState = leftMin <= 0 ? "overdue" : leftMin <= soonMin ? "soon" : "ok";
    const hoursLeft = leftMin > 0 ? Math.ceil(leftMin / 60) : Math.floor(leftMin / 60);
    hours = { state, share: leftMin / (intervalHours * 60), hoursLeft, hoursRun: Math.floor(usedMin / 60) };
  }

  let basis: "days" | "hours";
  if (days && hours) {
    if (STATE_RANK[days.state] !== STATE_RANK[hours.state]) basis = STATE_RANK[days.state] > STATE_RANK[hours.state] ? "days" : "hours";
    else basis = days.share <= hours.share ? "days" : "hours";
  } else basis = days ? "days" : "hours";

  const state = basis === "days" ? days!.state : hours!.state;
  return {
    dueAtMs: days?.dueAtMs ?? null,
    daysLeft: days?.daysLeft ?? null,
    hoursLeft: hours?.hoursLeft ?? null,
    hoursRun: hours?.hoursRun ?? null,
    state,
    basis,
  };
}

/** Plans on Today and the maintenance screen: overdue first, then due soon, then by the nearer share. */
export function comparePmDue(a: PmDue, b: PmDue): number {
  const rank = STATE_RANK[b.state] - STATE_RANK[a.state];
  if (rank !== 0) return rank;
  const da = a.daysLeft ?? Number.POSITIVE_INFINITY;
  const db = b.daysLeft ?? Number.POSITIVE_INFINITY;
  if (da !== db) return da - db;
  return (a.hoursLeft ?? Number.POSITIVE_INFINITY) - (b.hoursLeft ?? Number.POSITIVE_INFINITY);
}

// ---------------------------------------------------------------------------
// Run time of spans in a window
// ---------------------------------------------------------------------------

export type Span = { startMs: number; endMs: number | null };

/** Minutes of `span` inside [fromMs, toMs); an open span runs to `toMs`. Never negative. */
export function spanMinutesIn(span: Span, fromMs: number, toMs: number): number {
  const start = Math.max(span.startMs, fromMs);
  const end = Math.min(span.endMs ?? toMs, toMs);
  return end > start ? (end - start) / 60_000 : 0;
}

/**
 * Minutes covered by `spans` (closed spans), each overlap counted once. Used for the cuts of a press run:
 * its stop-to-resume pauses and its downtime entries can overlap, and the run loses that time once.
 */
export function mergedMinutes(spans: readonly { startMs: number; endMs: number }[]): number {
  const sorted = spans.filter((s) => s.endMs > s.startMs).sort((a, b) => a.startMs - b.startMs);
  let total = 0;
  let curStart = Number.NaN;
  let curEnd = Number.NaN;
  for (const s of sorted) {
    if (Number.isNaN(curStart) || s.startMs > curEnd) {
      if (!Number.isNaN(curStart)) total += curEnd - curStart;
      curStart = s.startMs;
      curEnd = s.endMs;
    } else if (s.endMs > curEnd) curEnd = s.endMs;
  }
  if (!Number.isNaN(curStart)) total += curEnd - curStart;
  return total / 60_000;
}

// ---------------------------------------------------------------------------
// Condition readings (row 68)
// ---------------------------------------------------------------------------

export type ReadingLimit = { minMilli: number | null; maxMilli: number | null };
export type ReadingFlag = "ok" | "low" | "high";

/** A reading outside its limit is flagged low or high; a missing side is not checked. */
export function readingFlag(valueMilli: number, limit: ReadingLimit): ReadingFlag {
  if (limit.minMilli != null && valueMilli < limit.minMilli) return "low";
  if (limit.maxMilli != null && valueMilli > limit.maxMilli) return "high";
  return "ok";
}

/** A limit pair is valid when at least one side is set and the low side is below the high side. */
export function validReadingLimit(limit: ReadingLimit): boolean {
  if (limit.minMilli == null && limit.maxMilli == null) return false;
  if (limit.minMilli != null && limit.maxMilli != null && limit.minMilli >= limit.maxMilli) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Reliability and cost (row 67)
// ---------------------------------------------------------------------------

/** One breakdown, closed: it has an end. Breakdowns still open are listed apart and never counted here. */
export type BreakdownEvent = { startMs: number; endMs: number };

export type Reliability = {
  /** Breakdowns that STARTED in the window (each one wholly in the month it started). */
  failures: number;
  /** Whole minutes the asset was down inside the window, each breakdown clipped to the window, overlaps once. */
  downtimeMin: number;
  /** Mean time to repair: the FULL length of the breakdowns that started in the window, over their count. */
  mttrMin: number | null;
  /** Mean time between failures: the window's up time (window minus downtime in it) over the failures. */
  mtbfMin: number | null;
};

/**
 * MTBF and MTTR of one asset over [fromMs, toMs), from closed breakdowns. Each event is one breakdown,
 * counted once (the caller merges a downtime entry with the work order made from it). A breakdown that
 * runs across months belongs wholly to the month it started for the count and MTTR; the downtime
 * minutes of each month are clipped to that month. Calendar time, not run time.
 */
export function reliability(events: readonly BreakdownEvent[], fromMs: number, toMs: number): Reliability {
  const windowMin = Math.max(0, (toMs - fromMs) / 60_000);
  const started = events.filter((e) => e.startMs >= fromMs && e.startMs < toMs);
  const failures = started.length;
  // Overlapping breakdowns (two work orders open together) are down time once: the union of the clipped spans.
  const down = mergedMinutes(events.map((e) => ({ startMs: Math.max(e.startMs, fromMs), endMs: Math.min(e.endMs, toMs) })));
  const downtimeMin = Math.round(down);
  if (failures === 0) return { failures: 0, downtimeMin, mttrMin: null, mtbfMin: null };
  const repairMin = started.reduce((s, e) => s + Math.max(0, e.endMs - e.startMs) / 60_000, 0);
  return {
    failures,
    downtimeMin,
    mttrMin: Math.round(repairMin / failures),
    mtbfMin: Math.round(Math.max(0, windowMin - down) / failures),
  };
}

/** Labour cost in paise: minutes times the plant's rate per hour, rounded to the paisa. */
export function labourPaise(labourMin: number, ratePaisePerHour: number | null): number | null {
  if (ratePaisePerHour == null) return null;
  return Math.round((Math.max(0, labourMin) * ratePaisePerHour) / 60);
}

/** Months `YYYY-MM` from `from` to `to`, both included (at most `max`; throws past it). */
export function monthRange(from: string, to: string, max = 12): string[] {
  const re = /^(\d{4})-(\d{2})$/;
  const a = re.exec(from);
  const b = re.exec(to);
  if (!a || !b) throw new RangeError("Months as YYYY-MM");
  let y = Number(a[1]);
  let m = Number(a[2]);
  const endKey = Number(b[1]) * 12 + Number(b[2]);
  if (m < 1 || m > 12 || Number(b[2]) < 1 || Number(b[2]) > 12) throw new RangeError("Months as YYYY-MM");
  const out: string[] = [];
  while (y * 12 + m <= endKey) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    if (out.length > max) throw new RangeError(`At most ${max} months`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  if (out.length === 0) throw new RangeError("The first month must not be after the last");
  return out;
}
