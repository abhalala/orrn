import type { MessageKey, Translate, TranslateVars } from "@orrn/i18n";

/** What `dispatch.addBundlesBySerial` reports (partial success per serial). */
export type AddBundlesReport = {
  added: string[];
  alreadyInDispatch: string[];
  notFound: string[];
  unavailable: { serial: string; reason: string }[];
};

const BUNDLE_STATUSES = ["available", "reserved", "dispatched", "void"] as const;
type BundleStatus = (typeof BUNDLE_STATUSES)[number];

/**
 * A message to show: an i18n key plus its variables (`status` names a bundle
 * status whose word fills `{status}`), or the server's own words as a last resort.
 */
export type ScanMessage = { key: MessageKey; vars?: TranslateVars; status?: BundleStatus } | { text: string };

/** The message in the current language. */
export function renderScanMessage(t: Translate, message: ScanMessage): string {
  if ("text" in message) return message.text;
  const vars = message.status ? { ...message.vars, status: t(`status.bundle.${message.status}`) } : message.vars;
  return t(message.key, vars);
}

export type AddOutcome =
  | { kind: "added"; serial: string }
  | { kind: "already"; serial: string }
  | { kind: "rejected"; serial: string; message: ScanMessage }
  | { kind: "notFound"; serial: string };

/** The outcome for one scanned serial in an add report. */
export function addOutcome(report: AddBundlesReport, serial: string): AddOutcome {
  if (report.added.includes(serial)) return { kind: "added", serial };
  if (report.alreadyInDispatch.includes(serial)) return { kind: "already", serial };
  const blocked = report.unavailable.find((u) => u.serial === serial);
  if (blocked) return { kind: "rejected", serial, message: rejectionMessage(blocked.reason) };
  return { kind: "notFound", serial };
}

/**
 * The server says why a bundle can't be added in plain English
 * (`bundleBlockReason`: "Bundle is held by D-0007", "Bundle is already
 * dispatched", "Bundle is void", "Bundle is <status>"). Map each to the
 * translated floor wording; anything else is shown as the server wrote it.
 */
export function rejectionMessage(reason: string): ScanMessage {
  const held = /held by (?!another dispatch)(\S+)\s*$/i.exec(reason);
  if (held?.[1]) return { key: "scan.continuous.heldBy", vars: { code: held[1] } };
  if (/held by another dispatch/i.test(reason)) return { key: "scan.continuous.heldElsewhere" };
  if (/already dispatched/i.test(reason)) return { key: "scan.continuous.dispatched" };
  if (/\bvoid\b/i.test(reason)) return { key: "scan.continuous.void" };
  const status = /bundle is (\w+)\s*$/i.exec(reason)?.[1]?.toLowerCase();
  if (status && (BUNDLE_STATUSES as readonly string[]).includes(status)) {
    return { key: "scan.continuous.wrongStatus", status: status as BundleStatus };
  }
  return { text: reason };
}

type TrpcLike = { data?: { code?: unknown } | null };

/** What to say when a scan request itself failed (not a per-bundle rejection). */
export function scanErrorKey(error: unknown, mode: "lookup" | "dispatch"): MessageKey {
  const code = error && typeof error === "object" ? (error as TrpcLike).data?.code : undefined;
  if (code === "FORBIDDEN") return "errors.forbidden";
  if (code === "UNAUTHORIZED") return "errors.sessionExpired";
  if (code === "BAD_REQUEST" && mode === "dispatch") return "scan.continuous.closed";
  if (code === "NOT_FOUND" && mode === "dispatch") return "scan.continuous.closed";
  // No tRPC code at all: the request never reached the server.
  if (code === undefined) return "errors.network";
  return "errors.generic";
}
