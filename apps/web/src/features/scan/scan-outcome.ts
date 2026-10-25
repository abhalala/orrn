import type { MessageKey, Translate, TranslateVars } from "@orrn/i18n";

const BUNDLE_STATUSES = ["available", "reserved", "dispatched", "void"] as const;
type BundleStatus = (typeof BUNDLE_STATUSES)[number];

/**
 * Why the server refused one bundle. `code`, `status` and `heldBy` are the
 * structured reason (T22); `reason` is the English sentence older servers
 * send alone, kept as a fallback.
 */
export type BundleBlock = {
  reason: string;
  /** D12 adds unassigned / wrong_customer / owned_die; until their floor keys exist they show `reason`. FP-OP-17 adds held_for_order. */
  code?: "held" | "dispatched" | "void" | "status" | "reallocation_pending" | "unassigned" | "wrong_customer" | "owned_die" | "held_for_order" | "outside_order";
  status?: BundleStatus;
  heldBy?: string | null;
  /** `held_for_order` (FP-OP-17): the sales order it is held for and its customer; `outside_order` (Q37): the order the packing list is for. */
  orderNumber?: string;
  customerName?: string;
};

/** What `dispatch.addBundlesBySerial` reports (partial success per serial). */
export type AddBundlesReport = {
  added: string[];
  alreadyInDispatch: string[];
  notFound: string[];
  unavailable: ({ serial: string } & BundleBlock)[];
  /** Q36: bundles added more than 0.1 kg/12ft off the weight of the order line they went to. */
  warnings?: OffBandWarning[];
};

export type OffBandWarning = { serial: string; orderNumber: string; lineNo: number; bundleMilli: number; lineMilli: number; diffMilli: number };

/** The warning for one added serial in the floor's words ("2.620 kg/12ft, the order says 2.500"), or null. */
export function offBandText(t: Translate, report: Pick<AddBundlesReport, "warnings">, serial: string): string | null {
  const w = report.warnings?.find((x) => x.serial === serial);
  if (!w) return null;
  return t("scan.continuous.offBand", { kg: (w.bundleMilli / 1000).toFixed(3), line: (w.lineMilli / 1000).toFixed(3), order: w.orderNumber });
}

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
  if (blocked) return { kind: "rejected", serial, message: blockMessage(blocked) };
  return { kind: "notFound", serial };
}

/** The floor wording for a refused bundle, from its structured reason; the English sentence only as a fallback. */
export function blockMessage(block: BundleBlock): ScanMessage {
  switch (block.code) {
    case "held":
      return block.heldBy ? { key: "scan.continuous.heldBy", vars: { code: block.heldBy } } : { key: "scan.continuous.heldElsewhere" };
    case "dispatched":
      return { key: "scan.continuous.dispatched" };
    case "void":
      return { key: "scan.continuous.void" };
    case "reallocation_pending":
      return { key: "scan.continuous.reallocationPending" };
    case "held_for_order":
      if (block.orderNumber) {
        return { key: "scan.continuous.heldForOrder", vars: { order: block.orderNumber, customer: block.customerName ?? "" } };
      }
      break;
    case "outside_order":
      if (block.orderNumber) return { key: "scan.continuous.outsideOrder", vars: { order: block.orderNumber } };
      break;
    case "status":
      if (block.status) return { key: "scan.continuous.wrongStatus", status: block.status };
      break;
  }
  return rejectionMessage(block.reason);
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
