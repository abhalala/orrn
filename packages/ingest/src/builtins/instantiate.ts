/**
 * `instantiate(builtin, headers)` turns a built-in hole into a concrete recipe for one block (plan B2, B3).
 * Stored and run recipes always name columns, never aliases.
 */
import { headerKey, normalizeHeaders, usedWidth } from "../fingerprint";
import { headerSimilarity } from "../similarity";
import type { CellKind, FitDiff, Recipe, RecipeField, RecipeStep, UnitKind } from "../recipe";
import { kindsCompatible } from "../cells";
import { parseUnitToken, type UnitId } from "../units-adapter";
import { isPerTwelveFoot, readHeader } from "./aliases";
import type { BuiltinField, BuiltinHole } from "./types";

const BRACKET = /[([]([^)\]]*)[)\]]/g;

/** The unit a header names for a field of this kind, or null (then the person is asked). */
export function unitFromHeaderText(header: string, kind: UnitKind): UnitId | null {
  if (kind === "count") return "pcs";
  const candidates: string[] = [];
  for (const m of header.matchAll(BRACKET)) candidates.push(m[1]!.replace(/^\s*(?:in|per)\s+/i, ""));
  const tokens = header.replace(BRACKET, " ").trim().split(/\s+/).filter(Boolean);
  for (let n = 1; n <= 4 && n <= tokens.length; n++) candidates.push(tokens.slice(-n).join(" "));
  for (const c of candidates) {
    const u = parseUnitToken(kind, c);
    if (u !== null) return u;
  }
  // Old-style headers: "(kg)" and "(g)" on a die band mean per 12 ft.
  const read = readHeader(header).unit;
  if (kind === "linear_mass") return read === "kg" ? "kg/12ft" : read === "g" ? "g/12ft" : null;
  if (kind === "mass") return read === "kg" ? "kg" : read === "g" ? "g" : null;
  if (kind === "length") return read === "mm" || read === "in" || read === "ft" || read === "m" ? read : null;
  if (kind === "dimension") return read === "mm" || read === "in" ? read : null;
  return null;
}

export type BuiltinMapping = {
  field: string;
  col: number;
  how: "alias" | "fuzzy";
  /** For a fuzzy match: the alias it was close to. */
  from?: string;
};

export type BuiltinAnalysis = {
  recipe: Recipe;
  mapped: BuiltinMapping[];
  missingRequired: string[];
  missingOptional: { field: string; header: string }[];
  /** Required numeric fields whose header names no unit. */
  unitless: string[];
  extra: { col: number; header: string }[];
  renamed: FitDiff["renamed"];
  kindMismatch: FitDiff["kindMismatch"];
  /** Fields that two or more columns could fill. The first is used and the field is flagged unclear. */
  ambiguousFields: string[];
};

export type AnalyzeOptions = {
  /** Also match renamed columns by similarity (the near fit). */
  fuzzy?: boolean;
  kinds?: readonly CellKind[];
  headerRow?: number;
  headerRows?: number;
};

const NUMERIC_EXPECTED = new Set<UnitKind>(["length", "mass", "linear_mass", "price_per_mass", "count", "dimension"]);

function expectedKind(f: BuiltinField): CellKind | null {
  if (f.unitFromHeader && NUMERIC_EXPECTED.has(f.unitFromHeader)) return "decimal";
  return f.dateFormat ? "date" : null;
}

function stepsFor(f: BuiltinField, header: string): { steps: RecipeStep[]; unitless: boolean } {
  if (f.unitFromHeader) {
    const unit = unitFromHeaderText(header, f.unitFromHeader);
    return { steps: [{ op: "number", kind: f.unitFromHeader, unit }], unitless: unit === null };
  }
  if (f.dateFormat !== undefined) return { steps: [{ op: "date", format: f.dateFormat }], unitless: false };
  const steps: RecipeStep[] = [{ op: "trim" }];
  if (f.pick) {
    steps.push({ op: "case", to: "lower" });
    steps.push({ op: "pick", map: Object.entries(f.pick).map(([from, to]) => ({ from, to })), otherwise: "refuse" });
    return { steps, unitless: false };
  }
  if (f.caseTo) steps.push({ op: "case", to: f.caseTo });
  return { steps, unitless: false };
}

export function analyzeBuiltin(builtin: BuiltinHole, headersIn: readonly string[], opts: AnalyzeOptions = {}): BuiltinAnalysis {
  const width = usedWidth(headersIn, []);
  const headers = headersIn.slice(0, width);
  const names = headers.map((h) => readHeader(h).name);
  const claimed = new Map<number, string>();
  const mapped: BuiltinMapping[] = [];
  const ambiguousFields: string[] = [];

  const eligible = (f: BuiltinField, col: number) => {
    // A "kg per 12 ft" header is a die band: never the weight of a bundle or any other plain mass.
    if (isPerTwelveFoot(headers[col]!) && f.unitFromHeader !== "linear_mass") return false;
    return names[col] !== "";
  };

  for (const f of builtin.fields) {
    const cols: number[] = [];
    for (let c = 0; c < headers.length; c++) {
      if (claimed.has(c) || !eligible(f, c)) continue;
      if (f.aliases.includes(names[c]!)) cols.push(c);
    }
    if (cols.length === 0) continue;
    if (cols.length > 1) ambiguousFields.push(f.field);
    claimed.set(cols[0]!, f.field);
    mapped.push({ field: f.field, col: cols[0]!, how: "alias" });
  }

  const renamed: FitDiff["renamed"] = [];
  if (opts.fuzzy) {
    type Cand = { f: BuiltinField; col: number; score: number; alias: string };
    const cands: Cand[] = [];
    builtin.fields.forEach((f, idx) => {
      if (mapped.some((m) => m.field === f.field)) return;
      for (let c = 0; c < headers.length; c++) {
        if (claimed.has(c) || !eligible(f, c) || Math.abs(c - idx) > 2) continue;
        const expect = expectedKind(f);
        const found = opts.kinds?.[c];
        if (expect && found && !kindsCompatible(expect, found)) continue;
        let best = 0;
        let alias = f.aliases[0]!;
        for (const a of f.aliases) {
          const s = headerSimilarity(names[c]!, a);
          if (s > best) {
            best = s;
            alias = a;
          }
        }
        if (best > 0) cands.push({ f, col: c, score: best, alias });
      }
    });
    cands.sort((a, b) => b.score - a.score || a.col - b.col);
    for (const cand of cands) {
      if (claimed.has(cand.col) || mapped.some((m) => m.field === cand.f.field)) continue;
      claimed.set(cand.col, cand.f.field);
      mapped.push({ field: cand.f.field, col: cand.col, how: "fuzzy", from: cand.alias });
      renamed.push({ col: cand.col, from: cand.alias, to: headers[cand.col]! });
    }
  }

  const fields: RecipeField[] = [];
  const unclear: Recipe["unclear"] = [];
  const unitless: string[] = [];
  for (const f of builtin.fields) {
    const m = mapped.find((x) => x.field === f.field);
    if (!m) continue;
    const header = headers[m.col]!;
    const { steps, unitless: noUnit } = stepsFor(f, header);
    fields.push({ field: f.field, source: { kind: "columns", cols: [{ col: m.col, header }] }, steps });
    if (noUnit) {
      unclear.push({ field: f.field, code: "unit_unknown" });
      if (f.required) unitless.push(f.field);
    }
    if (ambiguousFields.includes(f.field)) unclear.push({ field: f.field, code: "column_meaning_unclear" });
  }

  const normalized = normalizeHeaders(headers, width);
  const recipe: Recipe = {
    schemaVersion: 1,
    target: builtin.target,
    headerRow: opts.headerRow ?? 0,
    headerRows: opts.headerRows ?? 1,
    match: { headerKey: headerKey(normalized), headers: normalized },
    fields,
    filters: [],
    keys: [...builtin.keys],
    onExisting: builtin.onExisting,
    unclear,
  };

  const kindMismatch: FitDiff["kindMismatch"] = [];
  for (const m of mapped) {
    const f = builtin.fields.find((x) => x.field === m.field)!;
    const expect = expectedKind(f);
    const found = opts.kinds?.[m.col];
    if (expect && found && !kindsCompatible(expect, found)) kindMismatch.push({ col: m.col, header: headers[m.col]!, expected: expect, found });
  }

  return {
    recipe,
    mapped,
    missingRequired: builtin.fields.filter((f) => f.required && !mapped.some((m) => m.field === f.field)).map((f) => f.field),
    missingOptional: builtin.fields
      .filter((f) => !f.required && !mapped.some((m) => m.field === f.field))
      .map((f) => ({ field: f.field, header: f.aliases[0]! })),
    unitless,
    extra: headers.map((h, col) => ({ col, header: h })).filter((x) => !claimed.has(x.col) && x.header.trim() !== ""),
    renamed,
    kindMismatch,
    ambiguousFields,
  };
}

/** The recipe of a built-in hole for these headers. Required fields with no column are left out; see `analyzeBuiltin`. */
export function instantiate(builtin: BuiltinHole, headers: readonly string[], pos?: { headerRow?: number; headerRows?: number }): Recipe {
  return analyzeBuiltin(builtin, headers, pos ?? {}).recipe;
}
