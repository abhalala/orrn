import { classifyCode } from "@orrn/domain";
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
