/**
 * XE parity lane MAINT, row 68: the device input for condition readings. BUILT, NOT LIVE.
 *
 * No route, collector or cron calls this yet. It fixes the shape a device (a temperature or vibration
 * sensor behind the plant collector) will send, and the pure step that turns one message into the
 * values `maint.readings.record` stores, with `source: "device"` (the column exists in migration 0060).
 * When a device goes live, the collector posts these messages through an authenticated route that resolves
 * `assetCode` + `kindName` inside the caller's company, then inserts the reading with the same flag rule
 * (`readingFlag`) the hand entry uses. Until then, every reading is `source: "hand"`.
 */
import { readingFlag, type ReadingFlag } from "@orrn/domain";

/** One message from a device: the reading as the device reports it (a decimal number in the kind's unit). */
export type MaintDeviceReading = {
  deviceId: string;
  assetCode: string;
  kindName: string;
  value: number;
  /** Epoch milliseconds when the device took the reading. */
  readAt: number;
};

export type MaintDeviceRow = { valueMilli: number; flag: ReadingFlag; readAt: Date; source: "device" };

/** The latest a device clock may run ahead of the server before the reading is refused. */
export const DEVICE_CLOCK_SKEW_MS = 5 * 60_000;

/**
 * One device message to the stored values, against the kind's limits. Null when the message cannot be a
 * reading: not a finite number, more than 9 digits before the point, or a time in the future.
 */
export function deviceReadingRow(
  msg: MaintDeviceReading,
  limit: { minMilli: number | null; maxMilli: number | null },
  nowMs: number,
): MaintDeviceRow | null {
  if (!Number.isFinite(msg.value) || Math.abs(msg.value) >= 1e9) return null;
  if (!Number.isFinite(msg.readAt) || msg.readAt > nowMs + DEVICE_CLOCK_SKEW_MS) return null;
  const valueMilli = Math.round(msg.value * 1000);
  return { valueMilli, flag: readingFlag(valueMilli, limit), readAt: new Date(msg.readAt), source: "device" };
}
