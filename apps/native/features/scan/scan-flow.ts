import { classifyCode, parseScan } from "@orrn/domain";
import type { MessageKey } from "@orrn/i18n";

/**
 * True when the code may be an old month-only number (`J540`) or a legacy id:
 * those are resolved (`resolve.byCode`) before a dispatch add, because
 * `dispatch.addBundlesBySerial` matches the stored number exactly. Plant
 * numbers and BG serials go straight through.
 */
export function needsResolve(serial: string): boolean {
  const kind = classifyCode(serial).kind;
  return kind !== "plant" && kind !== "serial";
}

export type ResolveHit =
  | { kind: "bundle"; number: string; bundleId?: string }
  | { kind: "ambiguous"; candidates: { bundleId: string; number: string; year: number }[] }
  | { kind: "not_found" };

export type LookupTarget =
  | { kind: "open"; href: `/b/${string}` }
  | { kind: "choose"; candidates: { bundleId: string; number: string; year: number }[] }
  | { kind: "message"; key: MessageKey };

/** Lookup mode: what a resolved read does. */
export function lookupTarget(hit: ResolveHit): LookupTarget {
  if (hit.kind === "bundle") return { kind: "open", href: `/b/${encodeURIComponent(hit.number)}` };
  if (hit.kind === "ambiguous") return { kind: "choose", candidates: hit.candidates };
  return { kind: "message", key: "scan.notFound" };
}

export type ScanLogKind = "added" | "already" | "rejected" | "notFound" | "opened" | "error";

export type ScanLogEntry = { id: string; serial: string; kind: ScanLogKind; text?: string };

/** One line of the "Recent scans" list under the camera. */
export function scanLogEntry(input: { serial: string; kind: ScanLogKind; text?: string }, seq: number): ScanLogEntry {
  return { id: `${seq}:${input.serial}`, ...input };
}

/** The list keeps this many lines, newest first. */
export const SCAN_LOG_SIZE = 8;

/** Adds a line to the recent-scans list: newest first, capped at `SCAN_LOG_SIZE`. */
export function pushScanLog(log: readonly ScanLogEntry[], entry: ScanLogEntry): ScanLogEntry[] {
  return [entry, ...log].slice(0, SCAN_LOG_SIZE);
}

/**
 * The key a camera read is de-duplicated by. A label read as a link and as a
 * bare number (or in another case) counts once, so the key is the parsed
 * serial; text that is not a serial is keyed by itself.
 */
export function dedupeKey(raw: string): string {
  const value = raw.trim();
  const parsed = parseScan(value);
  return parsed.kind === "serial" ? parsed.serial : value;
}

/** What a raw read is, before any request: a serial to look up, or nothing we know. */
export function readSerial(raw: string): { kind: "serial"; serial: string } | { kind: "unrecognised" } {
  const parsed = parseScan(raw);
  return parsed.kind === "serial" ? { kind: "serial", serial: parsed.serial } : { kind: "unrecognised" };
}

/** The Scan tab's route params: with a dispatch it scans into it, without one it only looks bundles up. */
export type ScanMode = { kind: "lookup" } | { kind: "dispatch"; dispatchId: string; code: string | null };

function firstParam(v: string | string[] | undefined): string | undefined {
  const x = Array.isArray(v) ? v[0] : v;
  return x && x.length > 0 ? x : undefined;
}

export function scanMode(params: { dispatchId?: string | string[]; code?: string | string[] }): ScanMode {
  const dispatchId = firstParam(params.dispatchId);
  if (!dispatchId) return { kind: "lookup" };
  return { kind: "dispatch", dispatchId, code: firstParam(params.code) ?? null };
}
