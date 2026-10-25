import { BUNDLE_STATUSES, type BundleStatus } from "@orrn/domain";
import type { MessageKey, Translate, TranslateVars } from "@orrn/i18n";
import { SCAN_REFUSALS, type ScanRefusalCode } from "@orrn/server/lib/scanRefusal";

/**
 * What `dispatch.addBundlesBySerial` reports, per serial (partial success).
 * Mirrors web features/scan/scan-outcome.ts. `code`/`status`/`heldBy` on an
 * unavailable row come from T22's server change (ruling T22) and are optional
 * so older servers still work through the English `reason`.
 */
export type UnavailableRow = {
  serial: string;
  reason: string;
  /** The server's refusal code (`SCAN_REFUSALS`, D12) or `status` for a bundle in any other state. */
  code?: ScanRefusalCode | "status";
  status?: string;
  heldBy?: string | null;
  /** `held_for_order`: the sales order it is held for. */
  orderNumber?: string | null;
  /** `wrong_customer`: who it was packed for; `owned_die`: the owner; `held_for_order`: the order's customer. */
  customerName?: string | null;
  /** `ambiguous`: the bundle numbers the code could be. */
  candidates?: string[];
};

/** One refused code as `dispatch.scan` reports it in `refused`. */
export type RefusedRow = {
  serial: string;
  code: ScanRefusalCode;
  reason: string;
  heldBy: string | null;
  customerName: string | null;
  candidates: string[];
  orderNumber?: string | null;
};

/** Vehicle load against capacity as the server reports it after an add (FP-PK-12; warn only). */
export type CapacityReport = {
  loadedG: number;
  capacityG: number | null;
  state: "none" | "ok" | "near" | "over";
  fillBp: number | null;
  overG: number;
  needsReason: boolean;
};

/** One scanned code as `dispatch.scan` answers it, in the spec's order (not found, ambiguous, void, ...). */
export type ScanResultRow = {
  code: string;
  outcome: ScanRefusalCode | "not_found" | "already_on_dispatch" | "added";
  message: string;
  bundleId: string | null;
  serial: string | null;
  heldBy: string | null;
  customerName: string | null;
  orderNumber?: string | null;
  candidates: string[];
  /** The office let a bundle with no order line through (`allowUnassigned`). */
  note: "unassigned" | null;
};

export type AddBundlesReport = {
  added: string[];
  alreadyInDispatch: string[];
  notFound: string[];
  unavailable: UnavailableRow[];
  /** Every refused code with names and candidates (only `dispatch.scan` sends it). */
  refused?: RefusedRow[];
  results?: ScanResultRow[];
  capacity?: CapacityReport;
  /** The add was a repeat of an earlier one with the same request id. */
  replayed?: boolean;
};

/** An i18n key plus variables (`status` fills `{status}` with that bundle status' word), or the server's own words. */
export type ScanMessage = { key: MessageKey; vars?: TranslateVars; status?: BundleStatus } | { text: string };

export function renderScanMessage(t: Translate, message: ScanMessage): string {
  if ("text" in message) return message.text;
  const vars = message.status ? { ...message.vars, status: t(`status.bundle.${message.status}`) } : message.vars;
  return t(message.key, vars);
}

export type AddOutcome =
  | { kind: "added"; serial: string; /** The office let it on with no order line. */ noOrder?: boolean }
  | { kind: "already"; serial: string }
  | { kind: "rejected"; serial: string; message: ScanMessage; code?: ScanRefusalCode; candidates?: string[] }
  | { kind: "notFound"; serial: string };

/**
 * Every refusal code the server can send, with the floor key that says it in all three languages.
 * `Record<ScanRefusalCode, ...>` fails the type check when the server adds a code (and the test in
 * __tests__/refusal-codes.test.ts fails when a key is missing from en, hi or gu).
 */
export const REFUSAL_KEYS: Record<ScanRefusalCode, readonly MessageKey[]> = {
  ambiguous: ["scan.continuous.ambiguous", "scan.continuous.ambiguousPlain"],
  void: ["scan.continuous.void"],
  dispatched: ["scan.continuous.dispatched"],
  held: ["scan.continuous.heldBy", "scan.continuous.heldElsewhere"],
  held_for_order: ["scan.continuous.heldForOrder", "scan.continuous.heldForOrderPlain"],
  reallocation_pending: ["scan.continuous.reallocationPending"],
  unassigned: ["scan.continuous.unassigned"],
  wrong_customer: ["scan.continuous.wrongCustomer", "scan.continuous.wrongCustomerOther"],
  owned_die: ["scan.continuous.dieOwned", "scan.continuous.dieOwnedOther"],
};

const isBundleStatus = (s: string | undefined | null): s is BundleStatus => !!s && (BUNDLE_STATUSES as readonly string[]).includes(s);

/** Why a bundle could not be added, in the person's language, from the structured code the server sends. */
export function unavailableMessage(row: UnavailableRow): ScanMessage {
  const code = row.code;
  if (code === "status") {
    if (isBundleStatus(row.status)) return { key: "scan.continuous.wrongStatus", status: row.status };
    return rejectionMessage(row.reason);
  }
  if (code === undefined) return rejectionMessage(row.reason);
  // Q36 (dispatch off-band check, not on the server yet): a bundle outside the order's kg/12 ft band reads as another order's.
  if ((code as string) === "outside_order") return { key: "scan.continuous.otherOrder" };
  switch (code) {
    case "held":
      return row.heldBy ? { key: "scan.continuous.heldBy", vars: { code: row.heldBy } } : { key: "scan.continuous.heldElsewhere" };
    case "dispatched":
      return { key: "scan.continuous.dispatched" };
    case "void":
      return { key: "scan.continuous.void" };
    case "reallocation_pending":
      return { key: "scan.continuous.reallocationPending" };
    case "unassigned":
      return { key: "scan.continuous.unassigned" };
    case "wrong_customer":
      return row.customerName
        ? { key: "scan.continuous.wrongCustomer", vars: { name: row.customerName } }
        : { key: "scan.continuous.wrongCustomerOther" };
    case "owned_die":
      return row.customerName
        ? { key: "scan.continuous.dieOwned", vars: { name: row.customerName } }
        : { key: "scan.continuous.dieOwnedOther" };
    case "ambiguous":
      return row.candidates && row.candidates.length > 0
        ? { key: "scan.continuous.ambiguous", vars: { numbers: row.candidates.join(", ") } }
        : { key: "scan.continuous.ambiguousPlain" };
    case "held_for_order":
      return row.orderNumber
        ? { key: "scan.continuous.heldForOrder", vars: { order: row.orderNumber, customer: row.customerName ?? "" } }
        : { key: "scan.continuous.heldForOrderPlain" };
    default: {
      // A refusal code the server gained without a floor key stops compiling here.
      const unmapped: never = code;
      return rejectionMessage(String(unmapped));
    }
  }
}

/** The refusal of `serial` with every detail the server gave: its `unavailable` row merged with its `refused` row. */
export function blockOf(report: AddBundlesReport, serial: string): UnavailableRow | null {
  const refused = report.refused?.find((r) => r.serial === serial);
  const row = report.unavailable.find((u) => u.serial === serial);
  if (!refused && !row) return null;
  return {
    ...(row ?? { serial, reason: refused!.reason }),
    ...(refused
      ? { code: refused.code, reason: refused.reason, heldBy: refused.heldBy, customerName: refused.customerName, candidates: refused.candidates, orderNumber: refused.orderNumber ?? null }
      : {}),
    serial,
  };
}

/** The outcome of one scan result row (the typed code can be a party number: the result names the bundle). */
export function resultOutcome(r: ScanResultRow): AddOutcome {
  const serial = r.serial ?? r.code;
  switch (r.outcome) {
    case "added":
      return { kind: "added", serial, noOrder: r.note === "unassigned" };
    case "already_on_dispatch":
      return { kind: "already", serial };
    case "not_found":
      return { kind: "notFound", serial: r.code };
    default:
      return {
        kind: "rejected",
        serial,
        code: r.outcome,
        message: unavailableMessage({
          serial,
          reason: r.message,
          code: r.outcome,
          heldBy: r.heldBy,
          customerName: r.customerName,
          orderNumber: r.orderNumber ?? null,
          candidates: r.candidates,
        }),
        ...(r.outcome === "ambiguous" ? { candidates: r.candidates } : {}),
      };
  }
}

export function addOutcome(report: AddBundlesReport, serial: string): AddOutcome {
  const result = report.results?.[0];
  if (result && (report.results?.length ?? 0) === 1) return resultOutcome(result);
  if (report.added.includes(serial)) return { kind: "added", serial };
  if (report.alreadyInDispatch.includes(serial)) return { kind: "already", serial };
  const blocked = blockOf(report, serial);
  if (blocked) {
    return {
      kind: "rejected",
      serial,
      message: unavailableMessage(blocked),
      ...(blocked.code && blocked.code !== "status" ? { code: blocked.code } : {}),
      ...(blocked.code === "ambiguous" && blocked.candidates ? { candidates: blocked.candidates } : {}),
    };
  }
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
