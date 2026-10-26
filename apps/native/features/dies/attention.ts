import { naturalCompare } from "@/lib/format";

/**
 * The Dies tab (spec E1 "Native"): copies that need the die room's attention.
 * Every figure here (tone, position, percent) is the server's, taken from
 * `dieInstance.list`; this file only decides which copies to show and in what
 * order. Pure, so the ranking is unit-tested.
 */
export type CopyStatus = "available" | "in_use" | "at_nitriding" | "at_maker" | "on_trial" | "retired";
export type DriftTone = "none" | "under" | "green" | "amber" | "red";
export type BandPosition = "in" | "above" | "below";

export const ATTENTION_REASONS = ["above_band", "at_nitriding", "at_maker", "on_trial", "open_issue", "stale_reading", "never_read"] as const;
export type AttentionReason = (typeof ATTENTION_REASONS)[number];

/** A reading older than this is stale. */
export const STALE_READING_DAYS = 30;
const DAY_MS = 86_400_000;

/** What the list needs of a `dieInstance.list` row. `latestReadAt` (ms) is read when the server sends it. */
export type AttentionCopy = {
  id: string;
  code: string;
  status: CopyStatus;
  tone: DriftTone;
  position: BandPosition | null;
  percentTenths: number | null;
  latestMilli: number | null;
  /** When the latest reading was taken, ms. Absent or null while the list does not carry it. */
  latestReadAt?: number | null;
};

/** Why a copy is on the list; an empty list means it does not belong there. Retired copies never are. */
export function attentionReasons(copy: AttentionCopy, nowMs: number): AttentionReason[] {
  if (copy.status === "retired") return [];
  const out: AttentionReason[] = [];
  if (copy.position === "above") out.push("above_band");
  if (copy.status === "at_nitriding") out.push("at_nitriding");
  if (copy.status === "at_maker") out.push("at_maker");
  if (copy.status === "on_trial") out.push("on_trial");
  if (copy.status === "in_use") out.push("open_issue");
  // A copy out of the room cannot be weighed; the others are due a reading.
  if (copy.status !== "at_nitriding" && copy.status !== "at_maker") {
    if (copy.latestMilli == null) out.push("never_read");
    else if (copy.latestReadAt != null && nowMs - copy.latestReadAt > STALE_READING_DAYS * DAY_MS) out.push("stale_reading");
  }
  return out;
}

export type AttentionRow<C extends AttentionCopy = AttentionCopy> = { copy: C; reasons: AttentionReason[] };

const PRIORITY = new Map<AttentionReason, number>(ATTENTION_REASONS.map((r, i) => [r, i]));

/**
 * The attention list, most urgent first: above band (worst drift first), then
 * out at nitriding, at the maker, on trial, issued to a press, then the ones
 * that are due a reading. Within a reason, more reasons first, then by code.
 */
export function rankAttention<C extends AttentionCopy>(copies: readonly C[], nowMs: number): AttentionRow<C>[] {
  const rows: AttentionRow<C>[] = [];
  for (const copy of copies) {
    const reasons = attentionReasons(copy, nowMs);
    if (reasons.length > 0) rows.push({ copy, reasons });
  }
  const top = (r: AttentionRow) => PRIORITY.get(r.reasons[0]!) ?? ATTENTION_REASONS.length;
  return rows.sort((a, b) => {
    const byTop = top(a) - top(b);
    if (byTop !== 0) return byTop;
    if (a.reasons[0] === "above_band") {
      const byDrift = (b.copy.percentTenths ?? -Infinity) - (a.copy.percentTenths ?? -Infinity);
      if (byDrift !== 0) return byDrift;
    }
    const byCount = b.reasons.length - a.reasons.length;
    if (byCount !== 0) return byCount;
    return naturalCompare(a.copy.code, b.copy.code);
  });
}

export type ReasonFilter = "all" | AttentionReason;

/** Rows for one filter chip; "all" keeps everything. */
export function filterAttention<C extends AttentionCopy>(rows: readonly AttentionRow<C>[], filter: ReasonFilter): AttentionRow<C>[] {
  return filter === "all" ? [...rows] : rows.filter((r) => r.reasons.includes(filter));
}

/** How many rows carry each reason (a row with two reasons counts under both). */
export function reasonCounts(rows: readonly AttentionRow[]): Record<AttentionReason, number> {
  const counts = Object.fromEntries(ATTENTION_REASONS.map((r) => [r, 0])) as Record<AttentionReason, number>;
  for (const row of rows) for (const r of row.reasons) counts[r] += 1;
  return counts;
}

/**
 * The offsets of the pages after the first when `total` rows are read `limit` at a time, at most
 * `maxPages` pages in all (the first included). [] when one page holds everything.
 */
export function restPageOffsets(total: number, limit: number, maxPages: number): number[] {
  if (!(limit > 0) || !(total > limit)) return [];
  const pages = Math.min(Math.ceil(total / limit), Math.max(1, maxPages));
  return Array.from({ length: pages - 1 }, (_, i) => (i + 1) * limit);
}
