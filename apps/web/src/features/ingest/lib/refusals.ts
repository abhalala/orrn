import { REFUSAL_CODES, TARGETS, INGEST_TARGETS } from "@orrn/ingest";

import { fieldLabelKey } from "./recipe-builder";

/**
 * A staged row's `reasons` are strings like `bad_number:weightMinG`, `section_unknown:sectionCode`, `total_row`,
 * `confirm_blocked:po_number, line_1_pcs`. This turns each into a dictionary key and its variables, so no screen
 * shows a code. `translate` is the screen's `t`.
 */

const OTHER_CODES = [
  "section_unknown", "not_found", "alias_taken", "ambiguous", "legacy_mapped", "blank_row", "filtered",
  // Reasons the dry run and the merge checks write (PORTAL-X-FIX-REPORT.md "For the web lane"):
  "magnitude", "magnitude_unit", "magnitude_confirmed", "no_weight", "no_cut_length", "line_invalid", "status_not_allowed",
  "alias_is_name", "order_exists", "order_line_new", "in_file_duplicate_same", "cell_cut", "row_cut",
  // Round 5 and 6 of the server (PORTAL-S-FIX-REPORT.md): old order conflicts, notes and the other checks of an order book.
  "po_on_two_orders", "po_on_live_order", "order_in_other_file", "order_po_skipped", "order_no_unclear", "order_two_pos",
  "order_lines_over", "po_two_dates", "section_archived", "check_against_file",
  // Notes: they say what happened to a row and ask for nothing.
  "po_on_closed_order", "merged_cell", "section_pending", "customer_pending",
] as const;

/**
 * Reasons the server writes that the screen does not show: markers a visible reason always comes with. `order_live`
 * only says which kind of live match `order_line_new` or `po_on_live_order` found.
 */
export const SILENT_REASONS: readonly string[] = ["order_live"];

/** Reasons that are a note on a row, not a refusal and not a question: muted ink, no action. */
const NOTE_CODES = new Set(["po_on_closed_order", "merged_cell", "section_pending", "customer_pending", "order_po_skipped", "check_against_file"]);

/** What a row's `values` hold about the old order, for the sentences that name orders and files. */
export type OrderFacts = { orderNo: string | null; po: string | null; file: string | null; sheet: string | null; closedOrder: string | null };

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : typeof v === "number" ? String(v) : null);
const objectOf = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

/** The reasons whose sentence names an order, a PO or a file. */
const NAMES_ORDER = new Set(["po_on_two_orders", "po_on_live_order", "order_in_other_file", "po_on_closed_order"]);

export function orderFacts(values: Record<string, unknown> | null | undefined): OrderFacts {
  const v = values ?? {};
  const other = objectOf(v._otherFile);
  return {
    orderNo: text(v.oldOrderNo),
    po: text(v.poNumber),
    file: text(other.fileName),
    sheet: text(other.sheetName),
    closedOrder: text(objectOf(v._closedOrder).number),
  };
}

export const KNOWN_REFUSAL_CODES: readonly string[] = [...REFUSAL_CODES, ...OTHER_CODES];

const BLOCKER = /^(po_number|no_lines|line_\d+_(pcs|kg|length|alloy|temper|die_or_tier))$/;

const ALL_FIELDS = new Set(INGEST_TARGETS.flatMap((t) => TARGETS[t].fields.map((f) => f.name)));

export type RefusalLine =
  | { kind: "refusal"; key: string; fieldKey: string | null; order?: OrderFacts }
  | { kind: "blocked"; blockers: string[] }
  /** The server's own English. Draw it with `lang="en"` until the server sends codes only. */
  | { kind: "raw"; text: string };

/** The order line schema's field names (`line_invalid:kgG`) as the fields of the sheet the person knows. */
const LINE_PATH_FIELD: Record<string, string> = {
  kgG: "orderedKg",
  kgPer12ftMilli: "kgPer12ft",
  cutLengthMm: "cutLength",
  pcs: "pcs",
  ratePaise: "rate",
  finish: "finish",
  alloy: "alloy",
  temper: "temper",
  note: "note",
};

/** One reason string to a line. `null` for the markers that are not shown. */
export function refusalLine(reason: string, facts?: OrderFacts): RefusalLine | null {
  const at = reason.indexOf(":");
  const code = at < 0 ? reason : reason.slice(0, at);
  const rest = at < 0 ? "" : reason.slice(at + 1);
  // `q:customer_new` and `q:section_unknown:<code>` mark rows that wait for a question; the question says it.
  if (code === "q") return null;
  if (code === "confirm_blocked") {
    const pieces = rest.split(",").map((b) => b.trim()).filter(Boolean);
    // The server writes either the blocker codes or, when confirming itself refused, that refusal's own sentence.
    return pieces.length > 0 && pieces.every((b) => BLOCKER.test(b)) ? { kind: "blocked", blockers: pieces } : { kind: "raw", text: rest };
  }
  // Nothing left to dispatch is its own sentence: "must be more than zero" does not tell the person why.
  if (code === "not_positive" && rest === "bakiKg") return { kind: "refusal", key: "ingest.refuse.nothing_left", fieldKey: null };
  if (code === "line_invalid") {
    const field = LINE_PATH_FIELD[rest];
    return field
      ? { kind: "refusal", key: "ingest.refuse.line_invalidField", fieldKey: fieldLabelKey(field) }
      : { kind: "refusal", key: "ingest.refuse.line_invalid", fieldKey: null };
  }
  if (SILENT_REASONS.includes(code)) return null;
  // One PO on two orders and the same order in two files name the other file when the server says which one.
  if (code === "po_on_two_orders" && facts?.file) {
    return { kind: "refusal", key: "ingest.refuse.po_on_two_ordersFile", fieldKey: null, order: facts };
  }
  if (code === "order_in_other_file" && !facts?.file) {
    return { kind: "refusal", key: "ingest.refuse.order_in_other_fileUnnamed", fieldKey: null, order: facts };
  }
  if (KNOWN_REFUSAL_CODES.includes(code)) {
    return {
      kind: "refusal",
      key: `ingest.refuse.${code}`,
      fieldKey: rest && ALL_FIELDS.has(rest) ? fieldLabelKey(rest) : null,
      ...(facts && NAMES_ORDER.has(code) ? { order: facts } : {}),
    };
  }
  return rest || code ? { kind: "raw", text: reason } : null;
}

/** Every line of a row, in order, without the hidden ones. */
export function refusalLines(reasons: readonly string[], values?: Record<string, unknown> | null): RefusalLine[] {
  const facts = orderFacts(values);
  return reasons.map((r) => refusalLine(r, facts)).filter((l): l is RefusalLine => l !== null);
}

/**
 * An order blocker code in words (`po_number`, `no_lines`, `line_3_pcs`), from the orders dictionary the order screen
 * already uses (`orders.blockers.*`).
 */
export function blockerWords(t: (key: string, vars?: Record<string, string | number>) => string, code: string): string {
  const line = /^line_(\d+)_(.+)$/.exec(code);
  if (line) return t("orders.blockers.line", { n: Number(line[1]), problem: t(`orders.blockers.${line[2]}`) });
  return t(`orders.blockers.${code}`);
}

/** One line as screen text. */
export function refusalText(
  t: (key: string, vars?: Record<string, string | number>) => string,
  line: RefusalLine,
): string {
  if (line.kind === "raw") return line.text;
  if (line.kind === "blocked") {
    return t("ingest.reason.confirm_blocked", { detail: line.blockers.map((b) => blockerWords(t, b)).join(" ") });
  }
  const o = line.order;
  const vars: Record<string, string | number> = { field: line.fieldKey ? t(line.fieldKey) : "" };
  if (o) {
    // The order a row is on, in words ("old order 41"), or "this order" when the file has no number for it.
    vars.order = o.orderNo ? t("ingest.refuse.orderNo", { no: o.orderNo }) : t("ingest.refuse.thisOrder");
    vars.po = o.po ?? "";
    vars.file = o.file ?? "";
    vars.sheet = o.sheet ?? "";
    vars.closed = o.closedOrder ?? "";
  }
  return t(line.key, vars);
}

/** The reasons that ask a question, ask for a pick, or note an answer: amber ink. Only a real refusal is red (owner decision: a value outside the believable range is asked, never refused). */
const NOTE_KEYS = new Set([...NOTE_CODES].map((c) => `ingest.refuse.${c}`));

const WAITING_KEYS = new Set([
  // Two orders that cannot both be written wait for a person to skip one side or keep one.
  "ingest.refuse.po_on_two_orders",
  "ingest.refuse.po_on_two_ordersFile",
  "ingest.refuse.po_on_live_order",
  "ingest.refuse.order_in_other_file",
  "ingest.refuse.order_in_other_fileUnnamed",
  "ingest.refuse.magnitude",
  "ingest.refuse.magnitude_unit",
  "ingest.refuse.magnitude_confirmed",
  // "Matches more than one record. Pick one." asks for a pick, it does not refuse the row.
  "ingest.refuse.ambiguous",
]);

export function refusalTone(line: RefusalLine): "amber" | "red" | "note" {
  if (line.kind === "blocked") return "amber";
  if (line.kind === "refusal" && NOTE_KEYS.has(line.key)) return "note";
  if (line.kind === "refusal" && WAITING_KEYS.has(line.key)) return "amber";
  return "red";
}
