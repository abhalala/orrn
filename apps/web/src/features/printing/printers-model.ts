/**
 * Pure model for the Printers tab: how a print computer and each label printer read at a glance,
 * from what the print computer last reported, and the printer settings form.
 */
import type { LabelDocument, StatusTone } from "@orrn/domain";

import type { NodeStatus } from "./model";
import { PRINT_COMPUTER_STALE_MS } from "./print-computer";

export type NodeState = "online" | "offline" | "never" | "revoked";

/**
 * Online only while it is active and its last report is under five missed heartbeats old; a computer that never
 * reported is "never" (a new set-up), a turned-off one "revoked", everything else "offline".
 */
export function nodeState(node: { status: NodeStatus; lastHeartbeatAt: Date | string | null }, nowMs: number): NodeState {
  if (node.status === "revoked") return "revoked";
  const at = node.lastHeartbeatAt == null ? null : new Date(node.lastHeartbeatAt);
  if (!at || Number.isNaN(at.getTime())) return "never";
  return node.status === "active" && nowMs - at.getTime() <= PRINT_COMPUTER_STALE_MS ? "online" : "offline";
}

export function nodeStateTone(state: NodeState): StatusTone {
  switch (state) {
    case "online":
      return "green";
    case "never":
      return "amber";
    case "offline":
      return "red";
    case "revoked":
      return "neutral";
  }
}

/** The one computer the page leads with: the newest that is not turned off, else the newest. */
export function primaryNode<T extends { status: NodeStatus }>(nodes: readonly T[]): T | null {
  return nodes.find((n) => n.status !== "revoked") ?? nodes[0] ?? null;
}

export type PrinterState = "ready" | "paused" | "offline" | "error" | "unknown";

export type PrinterReport = {
  state: PrinterState;
  host: string | null;
  port: number | null;
  model: string | null;
  macAddress: string | null;
  lastSeenAt: Date | null;
  lastError: string | null;
};

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);
const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
const date = (value: unknown): Date | null => {
  if (typeof value !== "string" && !(value instanceof Date)) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * One printer as the print computer last reported it (`spool.listPrinters`): an Edge report
 * (`printerId`, `ipAddress`, `status`, `canPrint`, `capabilities`) or a legacy spool printer (`id`, `ip_address`,
 * `status`). Null when the printer is not in the report.
 */
export function printerReportOf(reports: unknown, spoolPrinterId: string): PrinterReport | null {
  if (!Array.isArray(reports)) return null;
  const raw = reports.find((r): r is Record<string, unknown> => {
    if (!r || typeof r !== "object") return false;
    const id = "printerId" in r ? r.printerId : "id" in r ? r.id : undefined;
    return (typeof id === "string" || typeof id === "number") && String(id) === spoolPrinterId;
  });
  if (!raw) return null;
  const caps = raw.capabilities && typeof raw.capabilities === "object" ? (raw.capabilities as Record<string, unknown>) : {};
  const status = text(raw.status)?.toLowerCase() ?? "unknown";
  let state: PrinterState;
  if (status === "online" || status === "ready" || status === "idle") state = raw.canPrint === false ? "error" : "ready";
  else if (status === "paused") state = "paused";
  else if (status === "offline") state = "offline";
  else if (status === "error") state = "error";
  else state = "unknown";
  return {
    state,
    host: text(caps.host) ?? text(raw.ipAddress) ?? text(raw.ip_address),
    port: num(caps.port) ?? num(raw.port),
    model: text(caps.model),
    macAddress: text(caps.macAddress),
    lastSeenAt: date(raw.lastSeenAt ?? raw.last_seen_at),
    lastError: text(raw.lastError) ?? text(raw.error_message),
  };
}

export function printerTone(state: PrinterState): StatusTone {
  switch (state) {
    case "ready":
      return "green";
    case "paused":
      return "amber";
    case "offline":
    case "error":
      return "red";
    case "unknown":
      return "neutral";
  }
}

export const MEDIA_TYPES = ["gap", "black_mark", "continuous"] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];
export const PRINTER_DPIS = [203, 300, 600] as const;
export type PrinterDpi = (typeof PRINTER_DPIS)[number];

/** The settings form, as typed text so nothing is reformatted while a person edits it. */
export type PreferencesDraft = {
  mediaType: MediaType;
  mediaWidthMm: string;
  mediaHeightMm: string;
  gapMm: string;
  dpi: PrinterDpi;
  speedInSec: string;
  density: string;
  cutterEnabled: boolean;
};

export type StoredPreferences = {
  mediaType: string | null;
  mediaWidthMm: number | null;
  mediaHeightMm: number | null;
  gapMm: number | null;
  dpi: number | null;
  speedInSec: number | null;
  density: number | null;
  cutterEnabled: boolean;
};

/** The printer's saved settings, else what its label design was drawn for, else the TSPL defaults. */
export function preferencesDraft(stored: StoredPreferences, page: LabelDocument["page"] | null): PreferencesDraft {
  const mediaType = MEDIA_TYPES.find((m) => m === stored.mediaType) ?? "gap";
  const dpi = PRINTER_DPIS.find((d) => d === (stored.dpi ?? page?.dpi)) ?? 203;
  const str = (value: number | null | undefined, fallback: number) => String(value ?? fallback);
  return {
    mediaType,
    mediaWidthMm: str(stored.mediaWidthMm ?? page?.widthMm, 100),
    mediaHeightMm: str(stored.mediaHeightMm ?? page?.heightMm, 75),
    gapMm: str(stored.gapMm ?? page?.gapMm, 3),
    dpi,
    speedInSec: str(stored.speedInSec ?? page?.speedInSec, 4),
    density: str(stored.density ?? page?.density, 8),
    cutterEnabled: stored.cutterEnabled,
  };
}

export type PreferencesField = "mediaWidthMm" | "mediaHeightMm" | "gapMm" | "speedInSec" | "density";

export type PreferencesInput = {
  mediaType: MediaType;
  mediaWidthMm: number;
  mediaHeightMm: number;
  gapMm: number;
  dpi: PrinterDpi;
  speedInSec: number;
  density: number;
  cutterEnabled: boolean;
};

const parse = (value: string) => {
  const cleaned = value.replace(/,/g, "").trim();
  return cleaned === "" ? Number.NaN : Number(cleaned);
};

/** The server's limits (`spool.updatePrinterPreferences`), checked before sending. */
export function parsePreferences(draft: PreferencesDraft): { ok: true; input: PreferencesInput } | { ok: false; errors: Partial<Record<PreferencesField, true>> } {
  const width = parse(draft.mediaWidthMm);
  const height = parse(draft.mediaHeightMm);
  const gap = parse(draft.gapMm);
  const speed = parse(draft.speedInSec);
  const density = parse(draft.density);
  const errors: Partial<Record<PreferencesField, true>> = {};
  if (!(width > 0 && width <= 300)) errors.mediaWidthMm = true;
  if (!(height > 0 && height <= 300)) errors.mediaHeightMm = true;
  if (!(gap >= 0 && gap <= 50)) errors.gapMm = true;
  if (!(Number.isInteger(speed) && speed >= 1 && speed <= 12)) errors.speedInSec = true;
  if (!(Number.isInteger(density) && density >= 0 && density <= 15)) errors.density = true;
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    input: {
      mediaType: draft.mediaType,
      mediaWidthMm: width,
      mediaHeightMm: height,
      gapMm: gap,
      dpi: draft.dpi,
      speedInSec: speed,
      density,
      cutterEnabled: draft.cutterEnabled,
    },
  };
}

/** `download_font` carries the file as base64 up to 1.5 MB of text: about 1.1 MB of font. */
export const FONT_MAX_BYTES = 1_100_000;

/** A printer id as `spool.testPrinter` takes it: Edge ids are text, the legacy spool numbers its printers. */
export function testPrinterId(spoolPrinterId: string): string | number {
  return /^\d+$/.test(spoolPrinterId) ? Number(spoolPrinterId) : spoolPrinterId;
}
