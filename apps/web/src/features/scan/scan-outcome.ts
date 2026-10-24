import type { MessageKey, Translate, TranslateVars } from "@orrn/i18n";

const BUNDLE_STATUSES = ["available", "reserved", "dispatched", "void"] as const;
type BundleStatus = (typeof BUNDLE_STATUSES)[number];

/**
 * Why the server refused one bundle. `code`, `status` and `heldBy` are the
 * structured reason (T22); `reason` is the English sentence older servers
 * send alone, kept as a fallback.
 */
export type BundleBlockCode =
  | "held"
  | "dispatched"
  | "void"
  | "status"
  | "unassigned"
  | "wrong_customer"
  | "owned_die"
  | "ambiguous"
  | "reallocation_pending";

export type BundleBlock = {
  reason: string;
  /** Refusal codes the server sends: dispatch add (D12) + reallocation. */
  code?: BundleBlockCode;
  status?: BundleStatus;
  heldBy?: string | null;
  /** `wrong_customer`: who it was packed for; `owned_die`: the owner. */
  customerName?: string | null;
  /** `ambiguous`: the bundle numbers the code could be. */
  candidates?: string[];
};

/** One refused code as `dispatch.scan` / `addBundlesBySerial` report it (D12). */
export type RefusedRow = {
  serial: string;
  code: BundleBlockCode;
  reason: string;
  heldBy: string | null;
  customerName: string | null;
  candidates: string[];
};

/** Vehicle load against capacity as the server reports it (FP-PK-12; warn only). */
export type CapacityReport = {
  loadedG: number;
  capacityG: number | null;
  state: "none" | "ok" | "near" | "over";
  fillBp: number | null;
  overG: number;
  needsReason: boolean;
};

/** What `dispatch.addBundlesBySerial` / `dispatch.scan` report (partial success per serial). */
export type AddBundlesReport = {
  added: string[];
  alreadyInDispatch: string[];
  notFound: string[];
  unavailable: ({ serial: string } & BundleBlock)[];
  /** Every refused code with its machine code, owner / customer name and candidates (D12). */
  refused?: RefusedRow[];
  capacity?: CapacityReport;
  /** `dispatch.scan` / the add paths: one result per code, in the §E6 order. */
  results?: ScanResultRow[];
};

/**
 * The refusal of `serial` with every detail the server gave: the `unavailable` row merged with its
 * `refused` row (which alone carries names and candidates), or an ambiguous code (reported in `refused`
 * and, for old clients, in `notFound`).
 */
export function blockOf(report: AddBundlesReport, serial: string): ({ serial: string } & BundleBlock) | null {
  const refused = report.refused?.find((r) => r.serial === serial);
  const row = report.unavailable.find((u) => u.serial === serial);
  if (!refused && !row) return null;
  return {
    ...(row ?? { serial, reason: refused!.reason }),
    ...(refused
      ? {
          code: refused.code,
          reason: refused.reason,
          heldBy: refused.heldBy,
          customerName: refused.customerName,
          candidates: refused.candidates,
        }
      : {}),
    serial,
  };
}

/** Every refused serial of a report, in order (unavailable rows first, then ambiguous codes). */
export function blocksOf(report: AddBundlesReport): ({ serial: string } & BundleBlock)[] {
  const serials = [...report.unavailable.map((u) => u.serial), ...(report.refused ?? []).map((r) => r.serial)];
  return [...new Set(serials)].flatMap((s) => {
    const b = blockOf(report, s);
    return b ? [b] : [];
  });
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
  | { kind: "rejected"; serial: string; message: ScanMessage; code?: BundleBlockCode; candidates?: string[] }
  | { kind: "notFound"; serial: string };

/** The outcome for one scanned serial in an add report. */
export function addOutcome(report: AddBundlesReport, serial: string): AddOutcome {
  if (report.added.includes(serial)) return { kind: "added", serial };
  if (report.alreadyInDispatch.includes(serial)) return { kind: "already", serial };
  const blocked = blockOf(report, serial);
  if (blocked) {
    return {
      kind: "rejected",
      serial,
      message: blockMessage(blocked),
      ...(blocked.code ? { code: blocked.code } : {}),
      ...(blocked.code === "ambiguous" && blocked.candidates ? { candidates: blocked.candidates } : {}),
    };
  }
  return { kind: "notFound", serial };
}

/**
 * One scanned code as `dispatch.scan` answers it (§E6 order). `serial` is the bundle's own number,
 * which differs from `code` when the code was a party number or an old month-only number.
 */
export type ScanResultRow = {
  code: string;
  outcome:
    | "not_found"
    | "ambiguous"
    | "void"
    | "dispatched"
    | "held"
    | "reallocation_pending"
    | "unassigned"
    | "wrong_customer"
    | "owned_die"
    | "already_on_dispatch"
    | "added";
  message: string;
  bundleId: string | null;
  serial: string | null;
  heldBy: string | null;
  customerName: string | null;
  candidates: string[];
  /** The office let a bundle with no order line through (`allowUnassigned`). */
  note: "unassigned" | null;
};

/** The outcome of one scan result (the typed code can be a party number: the result names the bundle). */
export function resultOutcome(r: ScanResultRow): AddOutcome {
  const serial = r.serial ?? r.code;
  switch (r.outcome) {
    case "added":
      return { kind: "added", serial };
    case "already_on_dispatch":
      return { kind: "already", serial };
    case "not_found":
      return { kind: "notFound", serial: r.code };
    default:
      return {
        kind: "rejected",
        serial,
        message: blockMessage({ reason: r.message, code: r.outcome, heldBy: r.heldBy, customerName: r.customerName, candidates: r.candidates }),
        code: r.outcome,
        ...(r.outcome === "ambiguous" ? { candidates: r.candidates } : {}),
      };
  }
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
    case "unassigned":
      return { key: "scan.continuous.unassigned" };
    case "wrong_customer":
      return block.customerName
        ? { key: "scan.continuous.wrongCustomer", vars: { name: block.customerName } }
        : { key: "scan.continuous.wrongCustomerOther" };
    case "owned_die":
      return block.customerName
        ? { key: "scan.continuous.dieOwned", vars: { name: block.customerName } }
        : { key: "scan.continuous.dieOwnedOther" };
    case "ambiguous":
      return block.candidates && block.candidates.length > 0
        ? { key: "scan.continuous.ambiguous", vars: { numbers: block.candidates.join(", ") } }
        : { key: "scan.continuous.ambiguousPlain" };
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
