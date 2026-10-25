/**
 * BACKLOG 102: the Queue tab's print computer warning. Its own module: the route's `validateSearch` imports `model.ts`
 * (it sits in the app entry), so what only the Queue tab needs stays out of it.
 */
import type { NodeStatus } from "./model";

/** A print computer reports in often; this long without a report and it is treated as offline. */
export const PRINT_COMPUTER_STALE_MS = 15 * 60_000;

export type PrintComputerBanner = { kind: "never"; nodeName: string } | { kind: "offline"; nodeName: string; since: Date } | null;

/**
 * BACKLOG 102: labels wait in the queue, and no print computer is reporting in. "never" when none has ever connected (a
 * new set-up, nothing installed yet), else "offline since" its latest report. Quiet when nothing waits, when no print
 * computer is set up (the page says so elsewhere), or when any one of them is reporting in.
 */
export function printComputerBanner(
  nodes: readonly { status: NodeStatus; lastHeartbeatAt: Date | string | null; nodeName: string }[],
  waiting: number,
  nowMs: number,
): PrintComputerBanner {
  if (waiting <= 0) return null;
  const live = nodes
    .filter((n) => n.status !== "revoked")
    .map((n) => ({ name: n.nodeName, status: n.status, at: n.lastHeartbeatAt ? new Date(n.lastHeartbeatAt) : null }));
  if (live.length === 0) return null;
  if (live.some((n) => n.status === "active" && n.at && nowMs - n.at.getTime() <= PRINT_COMPUTER_STALE_MS)) return null;
  const seen = live.filter((n): n is typeof n & { at: Date } => n.at !== null).sort((a, b) => b.at.getTime() - a.at.getTime());
  if (seen.length === 0) return { kind: "never", nodeName: live[0]!.name };
  return { kind: "offline", nodeName: seen[0]!.name, since: seen[0]!.at };
}
