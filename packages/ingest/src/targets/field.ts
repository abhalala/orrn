import type { ResolverId } from "../recipe";
import type { RefusalCode } from "../states";
import type { UnitId } from "../units-adapter";
import { canonicalUnit } from "../units-adapter";
import type { FieldCheck, FieldKind, TargetField } from "./types";

/** Server text limit for every imported string (`.max(500)` in the procedure schemas). */
export const MAX_TEXT = 500;

export const textCheck: FieldCheck = (v) => (typeof v === "string" && v.length > MAX_TEXT ? "too_long" : null);

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const emailCheck: FieldCheck = (v) => {
  if (typeof v !== "string") return "bad_email";
  if (v.length > MAX_TEXT) return "too_long";
  return EMAIL.test(v) ? null : "bad_email";
};

/** GSTIN: 15 letters and digits. The value is upper-cased by the recipe. */
export const gstinCheck: FieldCheck = (v) => (typeof v === "string" && /^[0-9A-Z]{15}$/.test(v) ? null : "bad_gstin");

export function enumCheck(values: readonly string[]): FieldCheck {
  return (v) => (typeof v === "string" && values.includes(v) ? null : "not_in_enum");
}

export const positiveIntCheck: FieldCheck = (v) => {
  if (typeof v !== "number" || !Number.isInteger(v)) return "not_whole";
  return v > 0 ? null : "not_positive";
};

export function rangeCheck(min: number, max: number, code: RefusalCode): FieldCheck {
  return (v) => (typeof v === "number" && v >= min && v <= max ? null : code);
}

type Opts = {
  kind?: FieldKind;
  required?: boolean;
  resolver?: ResolverId | null;
  enum?: readonly string[];
  multi?: { sep: string; max: number };
  note?: string;
  check?: FieldCheck | null;
  unit?: UnitId | null;
};

const NUMERIC = new Set(["length", "mass", "linear_mass", "price_per_mass", "count", "dimension"]);

export function field(name: string, opts: Opts = {}): TargetField {
  const kind: FieldKind = opts.kind ?? (opts.enum ? "enum" : "text");
  const numeric = NUMERIC.has(kind);
  return {
    name,
    kind,
    unit: numeric ? (opts.unit ?? canonicalUnit(kind as Parameters<typeof canonicalUnit>[0])) : null,
    required: opts.required ?? false,
    resolver: opts.resolver ?? null,
    enum: opts.enum ?? null,
    multi: opts.multi ?? null,
    note: opts.note ?? "",
    check: opts.check === undefined ? defaultCheck(kind, opts.enum) : opts.check,
  };
}

function defaultCheck(kind: FieldKind, values: readonly string[] | undefined): FieldCheck | null {
  if (kind === "text") return textCheck;
  if (kind === "enum" && values) return enumCheck(values);
  return null;
}
