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
] as const;

export const KNOWN_REFUSAL_CODES: readonly string[] = [...REFUSAL_CODES, ...OTHER_CODES];

const BLOCKER = /^(po_number|no_lines|line_\d+_(pcs|kg|length|alloy|temper|die_or_tier))$/;

const ALL_FIELDS = new Set(INGEST_TARGETS.flatMap((t) => TARGETS[t].fields.map((f) => f.name)));

export type RefusalLine =
  | { kind: "refusal"; key: string; fieldKey: string | null }
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
export function refusalLine(reason: string): RefusalLine | null {
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
  if (KNOWN_REFUSAL_CODES.includes(code)) {
    return { kind: "refusal", key: `ingest.refuse.${code}`, fieldKey: rest && ALL_FIELDS.has(rest) ? fieldLabelKey(rest) : null };
  }
  return rest || code ? { kind: "raw", text: reason } : null;
}

/** Every line of a row, in order, without the hidden ones. */
export function refusalLines(reasons: readonly string[]): RefusalLine[] {
  return reasons.map(refusalLine).filter((l): l is RefusalLine => l !== null);
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
  return t(line.key, { field: line.fieldKey ? t(line.fieldKey) : "" });
}
