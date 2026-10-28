/**
 * BACKLOG 102: the print computer's state for the Printing page's summary strip and the Queue tab's warning. Its own
 * module: the route's `validateSearch` imports `model.ts` (it sits in the app entry), so what only the page needs stays
 * out of it.
 */
import type { NodeStatus } from "./model";

/**
 * The spool agent reports in every 60 s by default (`heartbeat_interval: 60s`, wt/SPOOL `internal/heartbeat`). Five minutes
 * without a report is five missed beats in a row: a restart or a network blip is over by then, so what is left is a real stop.
 */
export const PRINT_COMPUTER_STALE_MS = 5 * 60_000;
/** How often the Queue tab asks again, and re-reads the clock, while it stays open. */
export const PRINT_COMPUTER_REFRESH_MS = 30_000;

type NodeReport = { status: NodeStatus; lastHeartbeatAt: Date | string | null; nodeName: string };

/**
 * Where the plant's print computers stand, as of their stored reports: "none" when none is set up (all revoked or none
 * at all), "online" when any one reported in within the last five minutes (the newest such report), "never" when none
 * has ever connected (a new set-up, nothing installed yet), else "offline" since the latest report.
 */
export type PrintComputerState =
  | { kind: "none" }
  | { kind: "online"; nodeName: string; at: Date }
  | { kind: "never"; nodeName: string }
  | { kind: "offline"; nodeName: string; since: Date };

export function printComputerState(nodes: readonly NodeReport[], nowMs: number): PrintComputerState {
  const live = nodes
    .filter((n) => n.status !== "revoked")
    .map((n) => ({ name: n.nodeName, status: n.status, at: n.lastHeartbeatAt ? new Date(n.lastHeartbeatAt) : null }));
  if (live.length === 0) return { kind: "none" };
  const seen = live.filter((n): n is typeof n & { at: Date } => n.at !== null).sort((a, b) => b.at.getTime() - a.at.getTime());
  const online = seen.find((n) => n.status === "active" && nowMs - n.at.getTime() <= PRINT_COMPUTER_STALE_MS);
  if (online) return { kind: "online", nodeName: online.name, at: online.at };
  if (seen.length === 0) return { kind: "never", nodeName: live[0]!.name };
  return { kind: "offline", nodeName: seen[0]!.name, since: seen[0]!.at };
}

export type PrintComputerBanner = Extract<PrintComputerState, { kind: "never" | "offline" }> | null;

/**
 * BACKLOG 102: labels wait in the queue, and no print computer is reporting in. Quiet when nothing waits, when no print
 * computer is set up (the page says so elsewhere), or when any one of them is reporting in.
 */
export function printComputerBanner(nodes: readonly NodeReport[], waiting: number, nowMs: number): PrintComputerBanner {
  if (waiting <= 0) return null;
  const state = printComputerState(nodes, nowMs);
  return state.kind === "never" || state.kind === "offline" ? state : null;
}
