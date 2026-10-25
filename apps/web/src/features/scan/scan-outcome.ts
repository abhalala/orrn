import type { MessageKey, Translate, TranslateVars } from "@orrn/i18n";
import type { ScanOutcome, ScanRefusalCode } from "@orrn/server/lib/scan";

const BUNDLE_STATUSES = ["available", "reserved", "dispatched", "void"] as const;
type BundleStatus = (typeof BUNDLE_STATUSES)[number];

/**
 * Why the server refused one bundle. `code`, `status` and `heldBy` are the
 * structured reason (T22); `reason` is the English sentence older servers
 * send alone, kept as a fallback.
 */
export type BundleBlockCode = ScanRefusalCode | "status";

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
  /** `held_for_order` (FP-OP-17): the sales order it is held for (`customerName` is its customer). */
  orderNumber?: string | null;
};

/** One refused code as `dispatch.scan` / `addBundlesBySerial` report it (D12). */
export type RefusedRow = {
  serial: string;
  code: BundleBlockCode;
  reason: string;
  heldBy: string | null;
  customerName: string | null;
  candidates: string[];
  /** `held_for_order`: the sales order it is held for. */
  orderNumber?: string | null;
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
          orderNumber: refused.orderNumber ?? null,
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
  /** Every server outcome (`SCAN_OUTCOMES`); `blockMessage` maps each refusal to a floor key. */
  outcome: ScanOutcome;
  message: string;
  bundleId: string | null;
  serial: string | null;
  heldBy: string | null;
  customerName: string | null;
  /** `held_for_order`: the sales order it is held for. */
  orderNumber?: string | null;
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
        message: blockMessage({
          reason: r.message,
          code: r.outcome,
          heldBy: r.heldBy,
          customerName: r.customerName,
          candidates: r.candidates,
          orderNumber: r.orderNumber ?? null,
        }),
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
    case "held_for_order":
      if (block.orderNumber) {
        return { key: "scan.continuous.heldForOrder", vars: { order: block.orderNumber, customer: block.customerName ?? "" } };
      }
      break;
    case "outside_order":
      // Without the order number the floor still reads it in its own language (never the server's English).
      return block.orderNumber
        ? { key: "scan.continuous.outsideOrder", vars: { order: block.orderNumber } }
        : { key: "scan.continuous.outsideOrderPlain" };
    case "status":
      if (block.status) return { key: "scan.continuous.wrongStatus", status: block.status };
      break;
    case undefined:
      break;
    default: {
      // A new server refusal code without a floor key fails the type check here (and scan-outcome.test.ts).
      const unmapped: never = block.code;
      return rejectionMessage(String(unmapped ?? block.reason));
    }
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

type TrpcLike = { message?: unknown; data?: { code?: unknown } | null };

/**
 * The three refusals dispatch gives a bundle that is in the oven, held in ageing, or (when the plant
 * dispatches aged metal only) never aged (W3-AG-S `assertDispatchAgeing`). They arrive as the whole
 * request failing, in English; the floor hears them in its own language, with the bundle and batch.
 */
const AGEING_DISPATCH: readonly { re: RegExp; key: MessageKey }[] = [
  { re: /^Bundle (\S+) is held in ageing on (\S+)$/, key: "ageing.refusal.bundleAgeingHeld" },
  { re: /^Bundle (\S+) is in ageing on (\S+)$/, key: "ageing.refusal.bundleInAgeing" },
  { re: /^Bundle (\S+) is not aged\b/, key: "ageing.refusal.bundleNotAged" },
];

/** The ageing wording of a failed dispatch scan or add, or null when the failure is something else. */
export function ageingDispatchRefusal(error: unknown): { key: MessageKey; vars: { serial: string; batch: string } } | null {
  const message = error && typeof error === "object" ? (error as TrpcLike).message : undefined;
  if (typeof message !== "string") return null;
  for (const entry of AGEING_DISPATCH) {
    const m = entry.re.exec(message);
    if (m) return { key: entry.key, vars: { serial: m[1]!, batch: m[2] ?? "" } };
  }
  return null;
}

/** `scanErrorKey` said as a sentence: the ageing refusals first (they name the bundle and batch), else the generic one. */
export function scanErrorText(t: (key: MessageKey, vars?: Record<string, string | number>) => string, error: unknown, mode: "lookup" | "dispatch"): string {
  const ageing = ageingDispatchRefusal(error);
  return ageing ? t(ageing.key, ageing.vars) : t(scanErrorKey(error, mode));
}

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
