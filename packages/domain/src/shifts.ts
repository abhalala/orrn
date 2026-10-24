/**
 * Named shifts and the production day (FP-PF-05; C14, C15). `company.settings.shifts[]` is
 * `{ id, name, seq, startMin, endMin }`: minutes from local midnight 0-1439, may wrap midnight.
 * Shift `seq = 1` starts the production day. A run or ageing batch stores the shift as
 * (production day, seq) plus the stable `shift_id`; never a letter (C14, D6).
 * Inputs are LOCAL wall time in the company time zone; the server converts (`lib/dayWindow`).
 */

export type Shift = { id: string; name: string; seq: number; startMin: number; endMin: number };

export const MAX_SHIFTS = 4;
export const MAX_SHIFT_NAME = 40;
export const MINUTES_PER_DAY = 1440;

/** Offered on an empty Shifts tab, written only when the plant presses Save (C14). Ids are made at save. */
export const SUGGESTED_SHIFTS: readonly Omit<Shift, "id">[] = [
  { name: "Day", seq: 1, startMin: 8 * 60, endMin: 20 * 60 },
  { name: "Night", seq: 2, startMin: 20 * 60, endMin: 8 * 60 },
];

export type ShiftError =
  | "count"
  | "id"
  | "name_empty"
  | "name_long"
  | "name_duplicate"
  | "minute_range"
  | "seq"
  | "zero_length"
  | "gap_or_overlap";

function isMinute(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n < MINUTES_PER_DAY;
}

/**
 * Rules: 1-4 shifts; ids present and unique; names 1-40 characters, unique ignoring case; minutes
 * 0-1439; seq exactly 1..n; no zero-length shift (a single shift may run start == end for the
 * whole day); in time order each shift ends where the next starts (touching is fine), so together
 * they cover 24 h with no gap or overlap. Returns every error found (empty = valid).
 */
export function validateShifts(shifts: readonly Shift[]): ShiftError[] {
  const errors = new Set<ShiftError>();
  if (shifts.length < 1 || shifts.length > MAX_SHIFTS) errors.add("count");
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const s of shifts) {
    if (!s.id || ids.has(s.id)) errors.add("id");
    ids.add(s.id);
    const name = s.name.trim();
    if (name === "") errors.add("name_empty");
    if (name.length > MAX_SHIFT_NAME) errors.add("name_long");
    if (names.has(name.toLowerCase())) errors.add("name_duplicate");
    names.add(name.toLowerCase());
    if (!isMinute(s.startMin) || !isMinute(s.endMin)) errors.add("minute_range");
  }
  const seqs = shifts.map((s) => s.seq).sort((a, b) => a - b);
  if (!seqs.every((v, i) => v === i + 1)) errors.add("seq");
  if (errors.has("minute_range") || errors.has("count")) return [...errors];

  // One shift must be the whole day (start == end); 08:00-20:00 alone leaves 12 h uncovered.
  if (shifts.length === 1) {
    if (shifts[0]!.startMin !== shifts[0]!.endMin) errors.add("gap_or_overlap");
    return [...errors];
  }
  if (shifts.some((s) => s.startMin === s.endMin)) {
    errors.add("zero_length");
    return [...errors];
  }
  const byStart = [...shifts].sort((a, b) => a.startMin - b.startMin);
  for (let i = 0; i < byStart.length; i++) {
    const next = byStart[(i + 1) % byStart.length]!;
    if (byStart[i]!.endMin !== next.startMin) {
      errors.add("gap_or_overlap");
      break;
    }
  }
  return [...errors];
}

/** Minutes a shift lasts (a single whole-day shift with start == end lasts 1440). */
export function shiftLengthMin(s: Pick<Shift, "startMin" | "endMin">): number {
  const len = (s.endMin - s.startMin + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return len === 0 ? MINUTES_PER_DAY : len;
}

function within(s: Pick<Shift, "startMin" | "endMin">, minute: number): boolean {
  const offset = (minute - s.startMin + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return offset < shiftLengthMin(s);
}

/** The shift a local minute of the day falls in (start inclusive, end exclusive), or null with no shifts. */
export function shiftAt(shifts: readonly Shift[], minuteOfDay: number): Shift | null {
  return shifts.find((s) => within(s, minuteOfDay)) ?? null;
}

/** Local minute the production day starts: shift seq 1's start, or midnight with no shifts. */
export function productionDayStartMin(shifts: readonly Shift[]): number {
  return shifts.find((s) => s.seq === 1)?.startMin ?? 0;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

function addDays(ymd: { year: number; month: number; day: number }, days: number): string {
  const d = new Date(Date.UTC(ymd.year, ymd.month - 1, ymd.day + days));
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

export type ShiftResolution = {
  /** `YYYY-MM-DD` of the production day (before shift 1 starts = the previous calendar day). */
  productionDay: string;
  shiftId: string | null;
  /** 1-based; null with no shifts (calendar-midnight plants). Not printed (C14). */
  shiftSeq: number | null;
  shiftName: string | null;
};

/**
 * Production day and shift for a local wall-clock moment (C15). No shifts: the calendar day, no
 * shift. With shifts: a moment before shift 1's start belongs to the previous production day.
 * 24 Oct 02:00 with Day 08-20 / Night 20-08 is production day 23 Oct, Night (seq 2).
 */
export function resolveShift(shifts: readonly Shift[], local: { year: number; month: number; day: number; minuteOfDay: number }): ShiftResolution {
  const calendar = `${local.year}-${pad2(local.month)}-${pad2(local.day)}`;
  if (shifts.length === 0) return { productionDay: calendar, shiftId: null, shiftSeq: null, shiftName: null };
  const startMin = productionDayStartMin(shifts);
  const productionDay = local.minuteOfDay < startMin ? addDays(local, -1) : calendar;
  const shift = shiftAt(shifts, local.minuteOfDay);
  return { productionDay, shiftId: shift?.id ?? null, shiftSeq: shift?.seq ?? null, shiftName: shift?.name ?? null };
}

/** `HH:MM` for a minute of the day (display; `startMin` 480 -> `08:00`). */
export function minuteText(minuteOfDay: number): string {
  return `${pad2(Math.floor(minuteOfDay / 60))}:${pad2(minuteOfDay % 60)}`;
}
