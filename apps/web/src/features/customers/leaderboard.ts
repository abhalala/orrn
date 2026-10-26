/**
 * The customer leaderboard as screens read it (analytics addendum §4). Pure, and free of the chart
 * kit at runtime: the customer page imports it for the share tile without pulling the kit into its
 * chunk (only `customer-charts.tsx` may import `@orrn/ui/charts`).
 */
import type { RankedRow } from "@orrn/ui/charts";

/** The fields of an `analytics.customerLeaderboard` row these helpers read. */
export type LeaderboardRow = {
  customerId: string;
  name: string;
  kgG: number;
  sharePct: number;
  rank: number;
  previousRank: number | null;
};

/**
 * Places climbed since the previous period of the same length: positive is up (was 3rd, now 1st:
 * +2), 0 is unchanged, null is New (no dispatches in the previous period).
 */
export function movementOf(rank: number, previousRank: number | null): number | null {
  return previousRank === null ? null : previousRank - rank;
}

/** Ranked bars in the server's order: kg, the server's share (sums to 100.0 with Other), movement. */
export function leaderboardRows(rows: readonly LeaderboardRow[]): RankedRow[] {
  return rows.map((r) => ({
    key: r.customerId,
    label: r.name,
    value: r.kgG / 1000,
    share: r.sharePct,
    movement: movementOf(r.rank, r.previousRank),
  }));
}

const SHARE_FORMAT = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** "55.1%": one decimal, the same text as the chart kit's share column (`formatShare`). */
export function formatSharePct(share: number): string {
  return `${SHARE_FORMAT.format(share)}%`;
}

/**
 * One customer's share of everything dispatched in the period, 0-100, or null while the
 * leaderboard is unknown. A customer listed on the leaderboard reads the leaderboard's own
 * (largest-remainder) share, so the tile and the leaderboard never disagree by 0.1; anyone else is
 * their kg over the period's total.
 */
export function customerShare(
  customerId: string,
  kgG: number,
  board: { rows: readonly Pick<LeaderboardRow, "customerId" | "sharePct">[]; totalKgG: number } | undefined,
): number | null {
  if (!board) return null;
  const listed = board.rows.find((r) => r.customerId === customerId);
  if (listed) return listed.sharePct;
  return board.totalKgG > 0 ? (kgG / board.totalKgG) * 100 : 0;
}
