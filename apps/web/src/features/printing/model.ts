/**
 * Pure model for the Printing screen (plan Task 24): tab and filter parsing,
 * status tones and the queue summary. Nothing here claims more than the rows
 * hold: a print computer's "last seen" is its stored heartbeat time, not a
 * live connection check.
 */
import type { StatusTone } from "@orrn/domain";

export const PRINT_TABS = ["queue", "printers", "labels"] as const;
export type PrintTab = (typeof PRINT_TABS)[number];

export const PRINT_STATUSES = ["queued", "sent", "success", "failed"] as const;
export type PrintStatus = (typeof PRINT_STATUSES)[number];

export const PRINT_PAGE_SIZE = 25;

export function parsePrintTab(value: unknown): PrintTab {
  return PRINT_TABS.find((tab) => tab === value) ?? "queue";
}

export function parsePrintStatus(value: unknown): PrintStatus | undefined {
  return PRINT_STATUSES.find((status) => status === value);
}

export function parsePage(value: unknown): number | undefined {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isInteger(n) && n > 1 && n < 10_000 ? n : undefined;
}

export function printJobTone(status: PrintStatus): StatusTone {
  switch (status) {
    case "success":
      return "green";
    case "sent":
      return "blue";
    case "queued":
      return "amber";
    case "failed":
      return "red";
  }
}

/** Only a failed job is sent again; the server resets it to waiting. */
export function canRetry(status: PrintStatus): boolean {
  return status === "failed";
}

export type NodeStatus = "pending" | "active" | "offline" | "revoked";

export function nodeTone(status: NodeStatus): StatusTone {
  switch (status) {
    case "active":
      return "green";
    case "pending":
      return "amber";
    case "offline":
      return "red";
    case "revoked":
      return "neutral";
  }
}

export type QueueCounts = Record<PrintStatus, number>;

/** What needs a person: failed jobs, and jobs still waiting to leave orrn. */
export function queueSummary(counts: QueueCounts): { failed: number; waiting: number; clear: boolean } {
  return { failed: counts.failed, waiting: counts.queued, clear: counts.failed === 0 && counts.queued === 0 };
}

/** A typed bundle number, trimmed. Empty means nothing to open. */
export function reprintTarget(input: string): string | null {
  const serial = input.trim();
  return serial.length > 0 && serial.length <= 64 ? serial : null;
}

/** A frame newer than this at the time the node reported counts as "the scale is talking". */
export const SCALE_FRAME_FRESH_MS = 10_000;

export type ScaleRow =
  | { kind: "unknown" }
  | { kind: "none" }
  | { kind: "idle"; simulated: boolean; reportedAt: Date }
  | { kind: "connected"; simulated: boolean; lastFrameAt: Date; reportedAt: Date };

/**
 * The scale row of a print computer (FP-PK-02), from what the node last reported in its signed heartbeat:
 * never reported, no scale, a scale that has not sent a recent frame, or one that is talking. Said as of
 * that report, not now: the page never claims a live connection.
 */
export function scaleRowOf(node: {
  scaleConfigured: boolean | null;
  scaleSimulated: boolean | null;
  scaleLastFrameAt: Date | string | number | null;
  scaleReportedAt: Date | string | number | null;
}): ScaleRow {
  const reported = node.scaleReportedAt == null ? null : new Date(node.scaleReportedAt);
  if (node.scaleConfigured == null || !reported || Number.isNaN(reported.getTime())) return { kind: "unknown" };
  if (!node.scaleConfigured) return { kind: "none" };
  const simulated = node.scaleSimulated === true;
  const frame = node.scaleLastFrameAt == null ? null : new Date(node.scaleLastFrameAt);
  if (frame && !Number.isNaN(frame.getTime()) && reported.getTime() - frame.getTime() <= SCALE_FRAME_FRESH_MS) {
    return { kind: "connected", simulated, lastFrameAt: frame, reportedAt: reported };
  }
  return { kind: "idle", simulated, reportedAt: reported };
}
