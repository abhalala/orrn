/**
 * Apply a recipe to rows (plan B2, B4): the deterministic half of the dry run. Pure: no resolver lookups happen here
 * (the server resolves `lookups` against live data), and nothing in a cell is ever read as an instruction. A cell is
 * data, whatever it says.
 *
 * Output per row: plain `values` (strings, numbers, ISO dates, null for blank), the entered text and unit of every
 * number, the lookups to resolve, and the refusals. A row is `blank` (every cell empty), `dropped` (a filter removed
 * it), `refused` (a total row, a bad value, a missing required field) or `ok`.
 */
import { checkMagnitude } from "@orrn/domain";

import type { DateFormat, Recipe, RecipeFilter, RecipeStep } from "./recipe";
import type { ResolverId } from "./recipe";
import type { RefusalCode } from "./states";
import { TARGETS, type TargetField } from "./targets";
import { runSteps, type NumberValue, type StepContext } from "./transforms";
import { recipeUnitOf, registryUnitOf, type UnitId } from "./units-adapter";

export type ApplyOptions = {
  /** The confirmed as-of date for `period_as_of` sources. */
  periodAsOf?: string | null;
  /** Answers to `unit_unknown`, by field. Replaces the unit of the field's number steps. */
  units?: Record<string, UnitId>;
  /** Answers to `date_format_ambiguous`, by field. */
  dateFormats?: Record<string, DateFormat>;
  currentYear?: number;
};

export type Refusal = { field: string | null; code: RefusalCode; detail?: string };

export type Entered = { text: string; unit: UnitId | null };

/**
 * A number outside the plausible range of its registry field (C19). The value is kept as read; a person must
 * confirm it or fix the unit. `likelyUnit` is offered only when exactly one other unit lands in range.
 */
export type MagnitudeFlag = {
  field: string;
  code: "magnitude";
  side: "below" | "above";
  likelyUnit: UnitId | null;
  likelyValue: number | null;
};

/** The reason text a staged row carries for a flag, `magnitude:<field>`. */
export const magnitudeReason = (f: Pick<MagnitudeFlag, "field">): string => `magnitude:${f.field}`;

export type ApplyRow = {
  /** Position among the data rows of the block, 0-based. */
  rowIndex: number;
  state: "ok" | "blank" | "dropped" | "refused";
  values: Record<string, string | number | null>;
  /** The text and unit the person had, for every number. */
  entered: Record<string, Entered>;
  /** Fields whose value is a name for a live record; the server resolves it. */
  lookups: Record<string, { resolver: ResolverId; text: string }>;
  /** Fields where half-up rounding changed the exact value. */
  rounded: string[];
  refusals: Refusal[];
  /** Numbers outside their plausible range. The row stays `ok`; the server must ask before it is ready. */
  flags: MagnitudeFlag[];
};

type FieldPlan = {
  field: string;
  def: TargetField | undefined;
  cols: number[];
  constant: string | null;
  period: boolean;
  steps: RecipeStep[];
  cx: StepContext;
};

export type CompiledRecipe = {
  recipe: Recipe;
  target: (typeof TARGETS)[keyof typeof TARGETS];
  plans: FieldPlan[];
  filters: RecipeFilter[];
  periodAsOf: string | null;
};

const TOTAL = /^(?:grand\s+|sub[\s-]?)?total\b/i;

/** Fields that hold a party or record name: a real name may start with "Total". */
const NAME_RESOLVERS = new Set(["customer_by_name", "vendor_by_name"]);
const isNameField = (p: FieldPlan) => p.def !== undefined && (NAME_RESOLVERS.has(p.def.resolver ?? "") || p.def.name === "name" || p.def.name === "alias");

/**
 * Is this a total row (C26)? The first non-blank cell starts with Total, Grand total or Sub total. When that cell
 * sits in a name column, the row is a total only if every other text column the recipe reads is blank: "Total
 * Interiors | Rajkot" is a customer.
 */
function isTotalRow(c: CompiledRecipe, row: readonly string[]): boolean {
  const at = row.findIndex((x) => x.trim() !== "");
  if (at === -1 || !TOTAL.test(row[at]!.trim())) return false;
  const plan = c.plans.find((p) => p.cols.includes(at));
  if (!plan || !isNameField(plan)) return true;
  return c.plans.every((p) => p === plan || p.def?.kind !== "text" || p.cols.every((col) => (row[col] ?? "").trim() === ""));
}

export function compileRecipe(recipe: Recipe, opts: ApplyOptions = {}): CompiledRecipe {
  const target = TARGETS[recipe.target];
  const plans: FieldPlan[] = recipe.fields.map((f) => ({
    field: f.field,
    def: target.fields.find((d) => d.name === f.field),
    cols: f.source.kind === "columns" ? f.source.cols.map((c) => c.col) : [],
    constant: f.source.kind === "constant" ? f.source.value : null,
    period: f.source.kind === "period_as_of",
    steps: f.steps,
    cx: {
      ...(opts.units?.[f.field] !== undefined ? { unit: opts.units[f.field]! } : {}),
      ...(opts.dateFormats?.[f.field] !== undefined ? { dateFormat: opts.dateFormats[f.field]! } : {}),
      ...(opts.currentYear !== undefined ? { currentYear: opts.currentYear } : {}),
    },
  }));
  return { recipe, target, plans, filters: recipe.filters, periodAsOf: opts.periodAsOf ?? null };
}

function filterTest(f: RecipeFilter, cell: string): boolean {
  const t = cell.trim();
  switch (f.test) {
    case "blank":
      return t === "";
    case "not_blank":
      return t !== "";
    case "equals":
    case "in": {
      const low = t.toLowerCase();
      return f.values.some((v) => v.trim().toLowerCase() === low);
    }
  }
}

function emptyRow(rowIndex: number, state: ApplyRow["state"]): ApplyRow {
  return { rowIndex, state, values: {}, entered: {}, lookups: {}, rounded: [], refusals: [], flags: [] };
}

export function applyRow(c: CompiledRecipe, row: readonly string[], rowIndex: number): ApplyRow {
  const cells = (i: number) => row[i] ?? "";
  const firstCell = row.find((x) => x.trim() !== "");
  if (firstCell === undefined) return emptyRow(rowIndex, "blank");

  if (isTotalRow(c, row)) {
    const out = emptyRow(rowIndex, "refused");
    out.refusals.push({ field: null, code: "total_row" });
    return out;
  }

  for (const f of c.filters) {
    const hit = filterTest(f, cells(f.col.col));
    if ((f.action === "keep" && !hit) || (f.action === "drop" && hit)) return emptyRow(rowIndex, "dropped");
  }

  const out = emptyRow(rowIndex, "ok");
  for (const p of c.plans) {
    let text = "";
    if (p.constant !== null) text = p.constant;
    else if (p.period) text = c.periodAsOf ?? "";
    else {
      for (const col of p.cols) {
        const t = cells(col);
        if (t.trim() !== "") {
          text = t;
          break;
        }
      }
    }

    // `period_as_of` is already an ISO date.
    const steps = p.period ? [] : p.steps;
    const r = runSteps(steps, text, p.cx);
    if (!r.ok) {
      out.refusals.push({ field: p.field, code: r.code, ...(r.detail !== undefined ? { detail: r.detail } : {}) });
      continue;
    }
    const s = r.state;
    let value: string | number | null;
    if (s.number) {
      value = s.number.canonical;
      // The cell as the file had it, before any step (C24): the audit shows what was really there.
      out.entered[p.field] = { text: text.trim(), unit: s.number.unit };
      if (s.number.rounded) out.rounded.push(p.field);
    } else if (s.date !== null) {
      value = s.date;
    } else if (p.period) {
      value = c.periodAsOf;
    } else {
      value = s.text.trim() === "" ? null : s.text;
    }
    // A number or date step that found nothing leaves the field blank, whatever text came in.
    if (s.number === null && steps.some((x) => x.op === "number") && text.trim() === "") value = null;
    out.values[p.field] = value;
    if (s.lookup && typeof value === "string") out.lookups[p.field] = { resolver: s.lookup as ResolverId, text: value };
    checkField(out, p, value);
    if (s.number && typeof value === "number") checkRange(out, p, s.number);
  }

  // Required fields with no mapping or no value.
  for (const d of c.target.fields) {
    if (!d.required) continue;
    const v = out.values[d.name];
    if ((v === undefined || v === null) && !out.refusals.some((x) => x.field === d.name)) {
      out.refusals.push({ field: d.name, code: "blank_required" });
    }
  }
  if (out.refusals.length === 0 && c.target.checkRow) {
    const bad = c.target.checkRow(out.values);
    if (bad) out.refusals.push(bad);
  }
  if (out.refusals.length > 0) out.state = "refused";
  return out;
}

/** Registry limits (C8, C19): past `hard` is refused, outside `plausible` is flagged. Never changes the value. */
function checkRange(out: ApplyRow, p: FieldPlan, n: NumberValue) {
  const fieldId = p.def?.magnitude;
  if (!fieldId || out.refusals.some((r) => r.field === p.field)) return;
  const reg = registryUnitOf(n.kind, n.unit);
  // Feet and inches have no single decimal to read in another unit, so no unit is offered for them.
  const entered = reg && n.unit !== "ft_in" ? { text: n.decimal, unit: reg } : undefined;
  const v = checkMagnitude(fieldId, n.canonical, entered);
  if (v.ok) return;
  if (v.level === "refuse") {
    out.refusals.push({ field: p.field, code: "out_of_range" });
    return;
  }
  const likely = v.likelyUnit ? recipeUnitOf(n.kind, v.likelyUnit) : null;
  out.flags.push({
    field: p.field,
    code: "magnitude",
    side: v.side,
    likelyUnit: likely,
    likelyValue: likely !== null ? (v.likelyValue ?? null) : null,
  });
}

function checkField(out: ApplyRow, p: FieldPlan, value: string | number | null) {
  if (value === null || !p.def?.check) return;
  const code = p.def.check(value);
  if (code) out.refusals.push({ field: p.field, code });
}

/** Applies a recipe to every data row. `firstRowIndex` offsets `rowIndex` (a resumed or paged run). */
export function applyRecipe(recipe: Recipe, rows: readonly (readonly string[])[], opts: ApplyOptions & { firstRowIndex?: number } = {}): ApplyRow[] {
  const compiled = compileRecipe(recipe, opts);
  const first = opts.firstRowIndex ?? 0;
  return rows.map((row, i) => applyRow(compiled, row, first + i));
}

export type ApplySummary = { total: number; ok: number; blank: number; dropped: number; refused: number; byCode: Partial<Record<RefusalCode, number>> };

export function summarize(rows: readonly ApplyRow[]): ApplySummary {
  const s: ApplySummary = { total: rows.length, ok: 0, blank: 0, dropped: 0, refused: 0, byCode: {} };
  for (const r of rows) {
    s[r.state]++;
    for (const f of r.refusals) s.byCode[f.code] = (s.byCode[f.code] ?? 0) + 1;
  }
  return s;
}

export type { NumberValue };
