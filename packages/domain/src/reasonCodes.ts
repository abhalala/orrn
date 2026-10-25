/**
 * Reason codes (C39: ONE `reason_code` master with a `kind`, never a table per use). The defaults
 * below seed every company (editable under Masters); `other` always needs a note. Labels are the
 * English defaults stored on the seeded row; screens show `t("reasons.{kind}.{code}")` for a
 * seeded code and the row's `label` for a plant-added one.
 */

export const REASON_CODE_KINDS = [
  "downtime", // press downtime (FP-PR-12)
  "qc_reject", // press rejects at counting (FP-PR-09)
  "void", // bundle void, press run void before start
  "reprint", // label reprint
  "ageing_hold", // FP-AG-11
  "ageing_rework", // FP-AG-12
  "ageing_scrap", // FP-AG discard remaining
  "ageing_abort", // FP-AG void / abort a batch (W3-AG-C)
  "ageing_reject", // FP-AG failed QC verdict written by release (W3-AG-C; codes = AGEING_REJECT_CODES + other)
  "reallocate", // orders.reallocate with a different cut length (ledger D6)
  "die_work", // FP-DR-18 die work log kinds (W4-NEXTROWS)
] as const;
export type ReasonCodeKind = (typeof REASON_CODE_KINDS)[number];

export type ReasonCodeSeed = { code: string; label: string; requiresNote: boolean };

const other: ReasonCodeSeed = { code: "other", label: "Other", requiresNote: true };
const seed = (code: string, label: string): ReasonCodeSeed => ({ code, label, requiresNote: false });

export const DEFAULT_REASON_CODES: Record<ReasonCodeKind, readonly ReasonCodeSeed[]> = {
  downtime: [
    seed("die_change", "Die change"),
    seed("billet_wait", "Waiting for billets"),
    seed("breakdown", "Breakdown"),
    seed("power", "Power cut"),
    seed("no_order", "No order"),
    seed("die_correction", "Die correction"),
    seed("quality_hold", "Quality hold"),
    other,
  ],
  qc_reject: [
    seed("dimension", "Dimension"),
    seed("surface", "Surface"),
    seed("bend", "Bend"),
    seed("crack", "Crack"),
    seed("short_length", "Short length"),
    other,
  ],
  void: [seed("wrong_entry", "Wrong entry"), seed("damaged", "Damaged"), seed("repacked", "Packed again"), other],
  reprint: [seed("label_damaged", "Label damaged"), seed("printer_fault", "Printer fault"), seed("wrong_label", "Wrong label"), other],
  ageing_hold: [
    seed("hardness_low", "Hardness low"),
    seed("hardness_high", "Hardness high"),
    seed("under_soak", "Under soak"),
    seed("surface", "Surface"),
    seed("bend", "Bend"),
    seed("customer", "Customer hold"),
    other,
  ],
  ageing_rework: [seed("hardness_low", "Hardness low"), seed("under_soak", "Under soak"), other],
  ageing_scrap: [seed("bend", "Bend"), seed("surface", "Surface"), seed("short_length", "Short length"), other],
  ageing_abort: [
    seed("wrong_load", "Wrong load"),
    seed("burner_fault", "Burner fault"),
    seed("power_cut", "Power cut"),
    seed("wrong_recipe", "Wrong recipe"),
    other,
  ],
  ageing_reject: [
    seed("under_aged", "Under-aged"),
    seed("over_aged", "Over-aged"),
    seed("no_readings", "No temperature readings"),
    seed("hardness_low", "Hardness low"),
    seed("too_few_samples", "Too few hardness samples"),
    other,
  ],
  reallocate: [
    seed("length_mismatch", "Different cut length"),
    seed("customer_request", "Customer asked"),
    seed("packed_wrong_order", "Packed on the wrong order"),
    other,
  ],
  // FP-DR-18: in-house work on a die copy. `correct` may send the copy back on trial.
  die_work: [seed("polish", "Polish"), seed("correct", "Correction"), seed("inspect", "Inspection"), seed("clean", "Cleaning"), other],
};

/** Longest note on any reason (FD/PR/PK caps: 1-500 characters). */
export const MAX_REASON_NOTE = 500;

export function isReasonCodeKind(value: unknown): value is ReasonCodeKind {
  return typeof value === "string" && (REASON_CODE_KINDS as readonly string[]).includes(value);
}

/** `other` (or a plant code marked so) without a note is refused on the server. */
export function reasonNoteMissing(input: { code: string; requiresNote?: boolean | null; note?: string | null }): boolean {
  const needs = input.requiresNote ?? input.code === "other";
  return needs && (input.note ?? "").trim() === "";
}

/** Every default as flat rows (seeding). */
export function defaultReasonCodeRows(): { kind: ReasonCodeKind; code: string; label: string; requiresNote: boolean; sortOrder: number }[] {
  return REASON_CODE_KINDS.flatMap((kind) => DEFAULT_REASON_CODES[kind].map((r, i) => ({ kind, ...r, sortOrder: i + 1 })));
}
