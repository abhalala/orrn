import { BUNDLE_STATUSES, type BundleStatus } from "@orrn/domain";
import type { MessageKey, Translate, TranslateVars } from "@orrn/i18n";

/**
 * What `dispatch.addBundlesBySerial` reports, per serial (partial success).
 * Mirrors web features/scan/scan-outcome.ts. `code`/`status`/`heldBy` on an
 * unavailable row come from T22's server change (ruling T22) and are optional
 * so older servers still work through the English `reason`.
 */
export type UnavailableRow = {
  serial: string;
  reason: string;
  /** D12 adds unassigned / wrong_customer / owned_die; until their floor keys exist they show `reason`. */
  code?: "held" | "dispatched" | "void" | "status" | "reallocation_pending" | "unassigned" | "wrong_customer" | "owned_die";
  status?: string;
  heldBy?: string | null;
};

export type AddBundlesReport = {
  added: string[];
  alreadyInDispatch: string[];
  notFound: string[];
  unavailable: UnavailableRow[];
};

/** An i18n key plus variables (`status` fills `{status}` with that bundle status' word), or the server's own words. */
export type ScanMessage = { key: MessageKey; vars?: TranslateVars; status?: BundleStatus } | { text: string };

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

const isBundleStatus = (s: string | undefined): s is BundleStatus => !!s && (BUNDLE_STATUSES as readonly string[]).includes(s);

/** Why a bundle could not be added, from the structured code when the server sends one. */
export function unavailableMessage(row: UnavailableRow): ScanMessage {
  switch (row.code) {
    case "held":
      return row.heldBy ? { key: "scan.continuous.heldBy", vars: { code: row.heldBy } } : { key: "scan.continuous.heldElsewhere" };
    case "dispatched":
      return { key: "scan.continuous.dispatched" };
    case "void":
      return { key: "scan.continuous.void" };
    case "reallocation_pending":
      return { key: "scan.continuous.reallocationPending" };
    case "status":
      if (isBundleStatus(row.status)) return { key: "scan.continuous.wrongStatus", status: row.status };
      break;
  }
  return rejectionMessage(row.reason);
}

export function addOutcome(report: AddBundlesReport, serial: string): AddOutcome {
  if (report.added.includes(serial)) return { kind: "added", serial };
  if (report.alreadyInDispatch.includes(serial)) return { kind: "already", serial };
  const blocked = report.unavailable.find((u) => u.serial === serial);
  if (blocked) return { kind: "rejected", serial, message: unavailableMessage(blocked) };
  return { kind: "notFound", serial };
}

/**
 * The server's English reason (`bundleBlockReason`) mapped to translated
 * floor wording; anything else is shown as the server wrote it.
 */
export function rejectionMessage(reason: string): ScanMessage {
  const held = /held by (?!another dispatch)(\S+)\s*$/i.exec(reason);
  if (held?.[1]) return { key: "scan.continuous.heldBy", vars: { code: held[1] } };
  if (/held by another dispatch/i.test(reason)) return { key: "scan.continuous.heldElsewhere" };
  if (/already dispatched/i.test(reason)) return { key: "scan.continuous.dispatched" };
  if (/\bvoid\b/i.test(reason)) return { key: "scan.continuous.void" };
  const status = /bundle is (\w+)\s*$/i.exec(reason)?.[1]?.toLowerCase();
  if (isBundleStatus(status)) return { key: "scan.continuous.wrongStatus", status };
  return { text: reason };
}

type TrpcLike = { data?: { code?: unknown } | null };

/** What to say when the scan request itself failed (not a per-bundle rejection). */
export function scanErrorKey(error: unknown, mode: "lookup" | "dispatch"): MessageKey {
  const code = error && typeof error === "object" ? (error as TrpcLike).data?.code : undefined;
  if (code === "FORBIDDEN") return "errors.forbidden";
  if (code === "UNAUTHORIZED") return "errors.sessionExpired";
  if ((code === "BAD_REQUEST" || code === "NOT_FOUND") && mode === "dispatch") return "scan.continuous.closed";
  if (code === undefined) return "errors.network";
  return "errors.generic";
}
