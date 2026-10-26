/**
 * Pack, stock and dispatch rules (FP-PK-02/07/12/13; C24, C25). Pure: the server allocates
 * numbers through `allocatePartyNumbers` (doc_series scope = customer id) and stores what these
 * return.
 */
import { formatBundleNo } from "./serial";
import { kgPer12ft } from "./units";

// ---------------------------------------------------------------------------
// Party bundle numbers (FP-PK-07)
// ---------------------------------------------------------------------------

/** `customer.bundle_number_policy`; null = the party number is the company serial. */
export const BUNDLE_NUMBER_POLICIES = ["monthly", "fy", "lifelong"] as const;
export type BundleNumberPolicy = (typeof BUNDLE_NUMBER_POLICIES)[number];

/** Period key of the single lifelong series. */
export const LIFELONG_PERIOD = "life";

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Indian financial year (1 Apr - 31 Mar) of a local date: `2026-27`. */
export function financialYearOf(ymd: { year: number; month: number }): string {
  const start = ymd.month >= 4 ? ymd.year : ymd.year - 1;
  return `${start}-${pad2((start + 1) % 100)}`;
}

/**
 * The party series period for a local (company time zone) date: monthly `2026-10` (resets on the
 * 1st), fy `2026-27` (resets 1 April), lifelong `life` (never resets).
 */
export function partyBundlePeriod(policy: BundleNumberPolicy, ymd: { year: number; month: number }): string {
  switch (policy) {
    case "monthly":
      return `${ymd.year}-${pad2(ymd.month)}`;
    case "fy":
      return financialYearOf(ymd);
    case "lifelong":
      return LIFELONG_PERIOD;
  }
}

/** Party number as printed: monthly `26J12`, fy `2026-27/12`, lifelong `4086`. */
export function formatPartyBundleNo(policy: BundleNumberPolicy, period: string, seq: number): string {
  if (!Number.isInteger(seq) || seq < 1) throw new RangeError(`Sequence must be a positive integer, got ${seq}`);
  switch (policy) {
    case "monthly": {
      const [y, m] = period.split("-").map(Number);
      return formatBundleNo(y!, m!, seq);
    }
    case "fy":
      return `${period}/${seq}`;
    case "lifelong":
      return String(seq);
  }
}

// ---------------------------------------------------------------------------
// Weight source (FP-PK-02)
// ---------------------------------------------------------------------------

export const WEIGHT_SOURCES = ["scale", "manual"] as const;
export type WeightSource = (typeof WEIGHT_SOURCES)[number];

/** Scale reading is stable after 5 frames within 20 g with no change for 1 s; stale after 3 s (Q-PK-3). */
export const SCALE_STABLE_FRAMES = 5;
export const SCALE_STABLE_SPREAD_G = 20;
export const SCALE_STABLE_HOLD_MS = 1_000;
export const SCALE_STALE_MS = 3_000;

/** A typed weight needs a reason only when the company has a scale node configured. */
export function weightNeedsReason(input: { weightSource: WeightSource; scaleConfigured: boolean }): boolean {
  return input.weightSource === "manual" && input.scaleConfigured;
}

/**
 * Stable when the last `SCALE_STABLE_FRAMES` frames sit within `SCALE_STABLE_SPREAD_G`, the oldest of
 * them is at least `SCALE_STABLE_HOLD_MS` old, the newest is not stale, and the weight is not 0.
 */
export function scaleStable(frames: readonly { grams: number; at: number }[], nowMs: number): boolean {
  if (frames.length < SCALE_STABLE_FRAMES) return false;
  const last = frames.slice(-SCALE_STABLE_FRAMES);
  const newest = last[last.length - 1]!;
  if (nowMs - newest.at > SCALE_STALE_MS) return false;
  if (newest.grams <= 0) return false;
  const grams = last.map((f) => f.grams);
  if (Math.max(...grams) - Math.min(...grams) > SCALE_STABLE_SPREAD_G) return false;
  return newest.at - last[0]!.at >= SCALE_STABLE_HOLD_MS;
}

// ---------------------------------------------------------------------------
// Vehicle capacity (FP-PK-12)
// ---------------------------------------------------------------------------

/** Fill at or above 95 % shows "near" (same chip rule as furnace capacity). */
export const CAPACITY_NEAR_BP = 9_500;

export type CapacityState = "none" | "ok" | "near" | "over";

/**
 * Loaded kg (after `addG`) against `dispatch.vehicle_capacity_g`. Warn only: `over` makes
 * `dispatch.complete` require `capacityOverrideReason` (audit `dispatch.capacity_override`).
 */
export function capacityCheck(input: { loadedG: number; capacityG: number | null | undefined; addG?: number }): {
  state: CapacityState;
  fillBp: number | null;
  overG: number;
  needsReason: boolean;
} {
  const loaded = input.loadedG + (input.addG ?? 0);
  const cap = input.capacityG;
  if (cap == null || !(cap > 0)) return { state: "none", fillBp: null, overG: 0, needsReason: false };
  const fillBp = Math.min(10_000, Math.floor((loaded * 10_000) / cap));
  if (loaded > cap) return { state: "over", fillBp, overG: loaded - cap, needsReason: true };
  return { state: loaded * 10_000 >= cap * CAPACITY_NEAR_BP ? "near" : "ok", fillBp, overG: 0, needsReason: false };
}

// ---------------------------------------------------------------------------
// Packing list v2 (FP-PK-13)
// ---------------------------------------------------------------------------

export const PROFILE_KINDS = ["hollow", "solid", "semi"] as const;
export type ProfileKind = (typeof PROFILE_KINDS)[number];

const natural = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

/** PL v2 row order: section code, then cut length, then party number (natural: 26J9 before 26J10). */
export function sortPackingListRows<T extends { sectionCode: string; lengthMm: number; partyNo: string | null }>(rows: readonly T[]): T[] {
  return [...rows].sort(
    (a, b) =>
      natural.compare(a.sectionCode, b.sectionCode) ||
      a.lengthMm - b.lengthMm ||
      natural.compare(a.partyNo ?? "", b.partyNo ?? ""),
  );
}

/** Footer summary by profile kind, hollow / solid / semi, zero kinds omitted; null counts as solid. */
export function profileKindSummary(rows: readonly { profileKind: ProfileKind | null; weightG: number; pcs: number }[]) {
  const totals = new Map<ProfileKind, { kind: ProfileKind; bundles: number; weightG: number; pcs: number }>();
  for (const r of rows) {
    const kind = r.profileKind ?? "solid";
    const t = totals.get(kind) ?? { kind, bundles: 0, weightG: 0, pcs: 0 };
    t.bundles += 1;
    t.weightG += r.weightG;
    t.pcs += r.pcs;
    totals.set(kind, t);
  }
  return PROFILE_KINDS.map((k) => totals.get(k)).filter((t): t is NonNullable<typeof t> => t !== undefined);
}

export type PlDiffRow = { bundleId: string; serial: string; weightG: number; pcs: number; lengthMm: number; partyNo: string | null };

const DIFF_FIELDS = ["weightG", "pcs", "lengthMm", "partyNo"] as const;

/**
 * What changed from one packing list revision to the next (regenerate keeps the number and the
 * old revision; the screen shows this). Serials in input order.
 */
export function diffPackingListRevisions(prev: readonly PlDiffRow[], next: readonly PlDiffRow[]) {
  const before = new Map(prev.map((r) => [r.bundleId, r]));
  const after = new Map(next.map((r) => [r.bundleId, r]));
  const added = next.filter((r) => !before.has(r.bundleId)).map((r) => r.serial);
  const removed = prev.filter((r) => !after.has(r.bundleId)).map((r) => r.serial);
  const changed: { serial: string; fields: (typeof DIFF_FIELDS)[number][] }[] = [];
  let unchanged = 0;
  for (const r of next) {
    const old = before.get(r.bundleId);
    if (!old) continue;
    const fields = DIFF_FIELDS.filter((f) => old[f] !== r[f]);
    if (fields.length) changed.push({ serial: r.serial, fields });
    else unchanged += 1;
  }
  const sum = (rows: readonly PlDiffRow[]) => rows.reduce((s, r) => s + r.weightG, 0);
  const weightDeltaG = sum(next) - sum(prev);
  return { added, removed, changed, unchanged, weightDeltaG, same: added.length + removed.length + changed.length === 0 };
}

/**
 * Dispatch weight check (Q36): a bundle on a dispatch is compared with the kg/12ft of the ORDER LINE
 * it is linked to, not the die's band (pack keeps that, D15). More than 0.1 kg/12ft apart (100 milli,
 * milli = grams per 12 ft) is a WARNING on the add and on the draft, never a block.
 */
export const DISPATCH_LINE_BAND_MILLI = 100;

/** The bundle's kg/12ft in milli from its own weight, pieces and length (null without pieces or length). */
export function bundleKgPer12ftMilli(b: { weightG: number; pieces: number; lengthMm: number }): number | null {
  const kg = kgPer12ft({ weightG: b.weightG, pieces: b.pieces, lengthMm: b.lengthMm });
  return kg === null ? null : Math.round(kg * 1000);
}

/** Whether a bundle is off its order line's weight: more than 0.1 kg/12ft either way; unknown figures never warn. */
export function offLineBand(bundleMilli: number | null, lineMilli: number | null): { off: boolean; diffMilli: number } | null {
  if (bundleMilli === null || lineMilli === null || !(lineMilli > 0)) return null;
  const diffMilli = bundleMilli - lineMilli;
  return { off: Math.abs(diffMilli) > DISPATCH_LINE_BAND_MILLI, diffMilli };
}
