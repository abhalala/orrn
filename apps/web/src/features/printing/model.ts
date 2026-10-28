/**
 * Pure model for the Printing screen (plan Task 24): tab and filter parsing,
 * status tones and the queue summary. Nothing here claims more than the rows
 * hold: a print computer's "last seen" is its stored heartbeat time, not a
 * live connection check.
 */
import type { StatusTone } from "@orrn/domain";

export const PRINT_TABS = ["queue", "printers", "labels"] as const;
export type PrintTab = (typeof PRINT_TABS)[number];

export const PRINT_STATUSES = ["queued", "accepted", "sent", "success", "failed", "outcome_unknown", "cancelled"] as const;
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
    case "accepted":
      return "amber";
    case "failed":
    case "outcome_unknown":
      return "red";
    case "cancelled":
      return "neutral";
  }
}

/** A retry is a new linked attempt, including after an ambiguous or cancelled attempt. */
export function canRetry(status: PrintStatus): boolean {
  return status === "failed" || status === "outcome_unknown" || status === "sent" || status === "cancelled";
}

/** A job can still be stopped while it waits in orrn or on the print computer, before it reaches the printer. */
export function canCancel(status: PrintStatus): boolean {
  return status === "queued" || status === "accepted";
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

export type SummaryKey = "retry" | "waiting" | "sent" | "printed";

export type SummaryItem = { key: SummaryKey; count: number; status: PrintStatus; tone: StatusTone };

/**
 * The Printing page's summary strip, from the queue's per-status counts: jobs that need a retry (failed or
 * outcome unknown), labels waiting (in orrn or accepted by the print computer), labels sent to the printer and
 * labels printed. Each item opens the queue on the status that holds most of what it counts, so a click never
 * lands on an empty filter while the item shows a number.
 */
export function printSummary(counts: QueueCounts): SummaryItem[] {
  const retry = counts.failed + counts.outcome_unknown;
  const waiting = counts.queued + counts.accepted;
  return [
    { key: "retry", count: retry, status: counts.failed > 0 || counts.outcome_unknown === 0 ? "failed" : "outcome_unknown", tone: retry > 0 ? "red" : "neutral" },
    { key: "waiting", count: waiting, status: counts.queued > 0 || counts.accepted === 0 ? "queued" : "accepted", tone: waiting > 0 ? "amber" : "neutral" },
    { key: "sent", count: counts.sent, status: "sent", tone: counts.sent > 0 ? "blue" : "neutral" },
    { key: "printed", count: counts.success, status: "success", tone: counts.success > 0 ? "green" : "neutral" },
  ];
}

/** The queue's status filters: every status that has jobs, plus the one being shown (so it can be turned off). */
export function statusFilters(counts: QueueCounts, active: PrintStatus | undefined): PrintStatus[] {
  return PRINT_STATUSES.filter((status) => counts[status] > 0 || status === active);
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

/** A press frame newer than this at report time counts as "sending" (the node posts every 2-30 s). */
export const COLLECTOR_FRAME_FRESH_MS = 60_000;

/** One collector as the node reported it (`spool_deployment.collectors`, W4-COLLECTORS). */
export type CollectorReport = {
  kind: "press" | "spectro";
  line: string | null;
  source: string;
  configured: boolean;
  simulated: boolean;
  connected: boolean;
  lastFrameAt: string | null;
  backlog: number;
  lastError: string | null;
};

export type CollectorItem = {
  key: string;
  kind: "press" | "spectro";
  line: string | null;
  source: string;
  simulated: boolean;
  state: "not_configured" | "sending" | "watching" | "quiet";
  lastFrameAt: Date | null;
  backlog: number;
  lastError: string | null;
};

export type CollectorRows = { kind: "unknown" } | { kind: "none"; reportedAt: Date } | { kind: "list"; reportedAt: Date; items: CollectorItem[] };

/**
 * The collectors row of a print computer: press collectors and spectro watchers as the node last
 * reported them in its signed heartbeat. A simulator is always shown as simulated; "sending" means
 * a frame within a minute of that report, never a live check.
 */
export function collectorRowsOf(node: {
  collectors?: CollectorReport[] | null;
  collectorsReportedAt?: Date | string | number | null;
}): CollectorRows {
  const reported = node.collectorsReportedAt == null ? null : new Date(node.collectorsReportedAt);
  if (!Array.isArray(node.collectors) || !reported || Number.isNaN(reported.getTime())) return { kind: "unknown" };
  if (node.collectors.length === 0) return { kind: "none", reportedAt: reported };
  const items = node.collectors.map((c, i): CollectorItem => {
    const frame = c.lastFrameAt == null ? null : new Date(c.lastFrameAt);
    const frameOk = frame != null && !Number.isNaN(frame.getTime());
    let state: CollectorItem["state"];
    if (!c.configured) state = "not_configured";
    else if (c.kind === "spectro") state = c.connected ? "watching" : "quiet";
    else state = frameOk && reported.getTime() - frame!.getTime() <= COLLECTOR_FRAME_FRESH_MS ? "sending" : "quiet";
    return {
      key: `${c.kind}-${c.line ?? ""}-${i}`,
      kind: c.kind,
      line: c.line,
      source: c.source,
      simulated: c.simulated === true,
      state,
      lastFrameAt: frameOk ? frame : null,
      backlog: c.backlog ?? 0,
      lastError: c.lastError ?? null,
    };
  });
  return { kind: "list", reportedAt: reported, items };
}
