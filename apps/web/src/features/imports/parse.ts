/**
 * One parser for every sheet orrn imports (audit W1, W10).
 *
 * The unit of a number comes from its column name: `Length (mm)`, `Length (in)`,
 * `Length (ft)`, `Weight (kg)`, `Weight (g)`, `lengthMm`, `weightG`. Only a
 * column with no unit at all falls back to the company length unit (lengths)
 * or kg (weights). So a mm sheet imported into an inch company stays in mm and
 * nothing is ever 25.4 times off.
 *
 * Every number goes through `parseDecimal`: no exponent (`1e3`), no sign, no
 * junk, no `parseInt` truncation, and a comma only where it groups thousands
 * (`1,234.5` or `1,23,456.5`; `45,5` is refused, never read as 455). A bad row
 * is rejected with its sheet row number and a reason (an i18n key under
 * `imports.reason`); it is never coerced to 0 and never dropped silently.
 * Fully blank rows are skipped and counted.
 */
import { formatLength, MM_PER_FOOT, MM_PER_INCH, parseDecimal, type LengthUnit } from "@orrn/domain";
import type { MessageKey } from "@orrn/i18n";
import { z } from "zod";

export type ImportKind = "bundles" | "dies" | "customers";

/** Unit read from a column name. `m` (metres) is recognised only so such a column is never used as mm or inches. */
export type HeaderUnit = "mm" | "in" | "ft" | "kg" | "g" | "m";

export type BundleImportRow = {
  dieSeries: string;
  dieSectionCode: string;
  quantity: number;
  weightG: number;
  lengthMm: number;
  poNumber: string | null;
};

/**
 * Optional die fields are present only when the sheet has a filled cell for
 * them. "Update from this sheet" sends just those, so a column the sheet lacks
 * (or an empty cell) never clears what orrn has, and a sheet without a Status
 * column never re-activates an archived die. New dies get the server defaults.
 */
export type DieImportRow = {
  series: string;
  sectionCode: string;
  name?: string;
  weightMinG: number;
  weightMaxG: number;
  widthMm?: number;
  thicknessMm?: number;
  legMm?: number;
  dimensions: { heightMm?: number };
  status?: "active" | "archived";
  notes?: string;
};

export type CustomerImportRow = {
  name: string;
  phone: string | null;
  email: string | null;
  taxId: string | null;
  notes: string | null;
};

export type ParsedRowByKind = {
  bundles: BundleImportRow;
  dies: DieImportRow;
  customers: CustomerImportRow;
};

export type ParsedRow = ParsedRowByKind[ImportKind];

export const REJECT_REASONS = [
  "blank",
  "notNumber",
  "notWhole",
  "notPositive",
  "tooLong",
  "badEmail",
  "badStatus",
  "rangeOrder",
  "duplicate",
  "lengthRange",
  "weightRange",
  // Not produced by the parser: the sheets add them after the server check or the imported-rows check.
  "deletedDie",
  "dieDeleted",
  "alreadyImported",
] as const;
export type RejectReason = (typeof REJECT_REASONS)[number];
export type RejectReasonKey = `imports.reason.${RejectReason}` & MessageKey;

export type RejectedRow = {
  /** Row number as the person sees it in the sheet (the header is row 1). */
  row: number;
  /** i18n key, e.g. `imports.reason.blank`. Render with `t(reason, { column, ...vars })`. */
  reason: RejectReasonKey;
  /** The column header exactly as written in the sheet. */
  column: string;
  vars?: Record<string, string | number>;
};

export type MatchedColumn = { field: string; header: string; unit: HeaderUnit | null };

export type ParseResult<R> = {
  ok: R[];
  /** Sheet row number of each `ok` row, same order. */
  okRows: number[];
  rejected: RejectedRow[];
  /** How each used column was read (field, header as written, unit from the header). */
  columns: MatchedColumn[];
  /** Required fields with no column in the sheet. When non-empty nothing is parsed. */
  missingColumns: string[];
  /** Headers orrn does not use. */
  ignoredColumns: string[];
  /**
   * Length or weight columns not used because their unit is not one orrn reads
   * (`Length (m)`, `Weight (mm)`, `Length (approx)`). Listed apart so the person
   * learns why a column that looks right was skipped.
   */
  badUnitColumns: string[];
  /**
   * Fields that more than one column fills and that are not a unit pair
   * (feet + inches): `Length (mm)` with `Length (in)`, `Notes` with `Remarks`.
   * orrn cannot tell which is right, so when this is non-empty nothing is parsed.
   */
  conflictColumns: ColumnConflict[];
  blankRows: number;
};

export type ColumnConflict = { field: string; headers: string[] };

export type ParseContext = {
  companyUnit: LengthUnit;
  /** Sheet row number of the first data row. Default 2 (header on row 1). */
  firstDataRow?: number;
};

// ---------------------------------------------------------------- headers

const UNIT_WORDS: Record<string, HeaderUnit> = {
  mm: "mm",
  millimetre: "mm",
  millimetres: "mm",
  millimeter: "mm",
  millimeters: "mm",
  in: "in",
  inch: "in",
  inches: "in",
  ft: "ft",
  feet: "ft",
  foot: "ft",
  kg: "kg",
  kgs: "kg",
  kilogram: "kg",
  kilograms: "kg",
  g: "g",
  gm: "g",
  gms: "g",
  gram: "g",
  grams: "g",
  m: "m",
  mtr: "m",
  mtrs: "m",
  metre: "m",
  metres: "m",
  meter: "m",
  meters: "m",
};

function unitOf(text: string): HeaderUnit | null {
  const word = text.trim().toLowerCase().replace(/\.$/, "");
  return UNIT_WORDS[word] ?? null;
}

/** A header that names a die band: `Weight Kg/12ft`, `kg per 12 ft`, `Wt (kg/12')`. */
export function isPerTwelveFoot(raw: string): boolean {
  return /(?:\/|\bper)\s*12\s*(?:ft|feet|foot|')/i.test(raw);
}

export type HeaderRead = {
  name: string;
  unit: HeaderUnit | null;
  /** Bracket text that is not a unit (`Length (approx)`): a length or weight column with it is not used. */
  unknownUnit?: string;
};

/**
 * Splits a header into a plain lowercase name and the unit it declares:
 * `"Length (mm)"` → `{ name: "length", unit: "mm" }`, `"weightG"` → `{ name: "weight", unit: "g" }`.
 * `kg/12ft` is kg (die weights are per 12 ft piece). A bracket that names no
 * unit comes back as `unknownUnit`, so a typo (`(milimeters)`) or a note never
 * makes a length or weight fall back to the company unit.
 */
export function readHeader(raw: string): HeaderRead {
  // "kg/12ft", "kg per 12 ft", "kg/12'" all mean kg.
  let text = raw.replace(/\s*(?:\/|per)\s*12\s*(?:ft|feet|foot|')/gi, "");
  let unit: HeaderUnit | null = null;
  let unknownUnit: string | undefined;

  text = text.replace(/[([]([^)\]]*)[)\]]/g, (_whole, inner: string) => {
    // "(in mm)", "(in grams)", "(per kg)": the usual Indian office style names the unit after in/per.
    const found = unitOf(inner.replace(/^\s*(?:in|per)\s+/i, ""));
    if (found) unit ??= found;
    else if (inner.trim() !== "") unknownUnit ??= inner.trim();
    return " ";
  });

  const words = text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);

  if (unit === null && words.length > 1) {
    const last = unitOf(words[words.length - 1]!);
    if (last) {
      unit = last;
      words.pop();
      // "Weight in kg" → "weight".
      while (words.length > 1 && (words[words.length - 1] === "in" || words[words.length - 1] === "per")) words.pop();
    }
  }
  const read: HeaderRead = { name: words.join(" "), unit };
  if (unit === null && unknownUnit !== undefined) read.unknownUnit = unknownUnit;
  return read;
}

// ---------------------------------------------------------------- fields

type FieldType = "text" | "count" | "weight" | "length" | "email" | "status";

type FieldDef = {
  id: string;
  type: FieldType;
  aliases: readonly string[];
  required?: boolean;
};

const UNITS_FOR: Record<FieldType, readonly HeaderUnit[]> = {
  text: [],
  count: [],
  email: [],
  status: [],
  weight: ["kg", "g"],
  length: ["mm", "in", "ft"],
};

export const IMPORT_FIELDS: Record<ImportKind, readonly FieldDef[]> = {
  bundles: [
    { id: "dieSeries", type: "text", required: true, aliases: ["die series", "series"] },
    {
      id: "dieSectionCode",
      type: "text",
      required: true,
      aliases: ["die section code", "section code", "section", "die section", "section no"],
    },
    { id: "quantity", type: "count", required: true, aliases: ["quantity", "qty", "pieces", "pcs", "piece", "nos"] },
    { id: "weight", type: "weight", required: true, aliases: ["weight", "net weight", "bundle weight", "wt"] },
    { id: "length", type: "length", required: true, aliases: ["length", "cut length", "len"] },
    { id: "poNumber", type: "text", aliases: ["po number", "po no", "po", "po ref", "purchase order", "po num"] },
  ],
  dies: [
    { id: "series", type: "text", required: true, aliases: ["series", "die series"] },
    { id: "sectionCode", type: "text", required: true, aliases: ["section code", "section", "die section code", "die section"] },
    { id: "name", type: "text", aliases: ["name", "die name", "description"] },
    {
      id: "weightMin",
      type: "weight",
      required: true,
      aliases: ["min weight", "weight min", "min", "minimum weight", "min wt", "range min"],
    },
    {
      id: "weightMax",
      type: "weight",
      required: true,
      aliases: ["max weight", "weight max", "max", "maximum weight", "max wt", "range max"],
    },
    { id: "width", type: "length", aliases: ["width", "dimensions width"] },
    { id: "height", type: "length", aliases: ["height", "dimensions height"] },
    { id: "thickness", type: "length", aliases: ["thickness", "dimensions thickness", "thk"] },
    { id: "leg", type: "length", aliases: ["leg"] },
    { id: "status", type: "status", aliases: ["status"] },
    { id: "notes", type: "text", aliases: ["notes", "note", "remarks"] },
  ],
  customers: [
    { id: "name", type: "text", required: true, aliases: ["name", "customer", "customer name", "party", "party name"] },
    { id: "phone", type: "text", aliases: ["phone", "mobile", "phone number", "mobile number", "contact"] },
    { id: "email", type: "email", aliases: ["email", "e mail", "email address"] },
    { id: "taxId", type: "text", aliases: ["gstin", "gst", "gst no", "gst number", "gstin no", "tax id"] },
    { id: "notes", type: "text", aliases: ["notes", "note", "remarks"] },
  ],
};

/** Server text limit for every imported string. */
const MAX_TEXT = 500;

/**
 * A bundle shorter than 1 ft or longer than 30 ft is not a real bundle: the
 * column almost certainly carries the wrong unit (a mm sheet with no unit in an
 * inch company reads 3658 as 304 ft). Q-OWNER (T25), default 1 ft to 30 ft.
 */
export const BUNDLE_MAX_WEIGHT_G = 5_000_000;
/** A die band above 50 kg per 12 ft is a unit slip (a 2.4 typed as 2400 g). */
export const DIE_MAX_BAND_G = 50_000;

export const BUNDLE_LENGTH_MM = { min: Math.round(MM_PER_FOOT), max: Math.round(30 * MM_PER_FOOT) } as const;

function matchColumns(kind: ImportKind, headers: readonly string[]) {
  const fields = IMPORT_FIELDS[kind];
  const candidates = new Map<string, MatchedColumn[]>();
  const ignored: string[] = [];
  const badUnit: string[] = [];
  for (const header of headers) {
    if (header.trim() === "") continue;
    const { name, unit, unknownUnit } = readHeader(header);
    // Whole-name match only (no "contains"), so `Weight Kg/12ft` is never a near-miss of `Bundle Weight`.
    const field = fields.find((f) => f.aliases.includes(name));
    if (!field) {
      ignored.push(header);
      continue;
    }
    const measured = field.type === "weight" || field.type === "length";
    // A kg-per-12-ft column is a die band. On a bundles sheet it is never the weight of a bundle (W1/W10).
    const dieBand = kind === "bundles" && isPerTwelveFoot(header);
    const unitFits = dieBand
      ? false
      : unit === null
        ? !(measured && unknownUnit !== undefined)
        : UNITS_FOR[field.type].includes(unit);
    if (!unitFits) {
      (measured ? badUnit : ignored).push(header);
      continue;
    }
    const list = candidates.get(field.id) ?? [];
    list.push({ field: field.id, header, unit });
    candidates.set(field.id, list);
  }

  const used = new Map<string, MatchedColumn>();
  /** The inches column of a length given as feet + inches. */
  const complements = new Map<string, MatchedColumn>();
  const conflicts: ColumnConflict[] = [];
  for (const [id, list] of candidates) {
    if (list.length === 1) {
      used.set(id, list[0]!);
      continue;
    }
    const ft = list.find((c) => c.unit === "ft");
    const inch = list.find((c) => c.unit === "in");
    if (list.length === 2 && ft && inch) {
      used.set(id, ft);
      complements.set(id, inch);
    } else {
      conflicts.push({ field: id, headers: list.map((c) => c.header) });
    }
  }
  const missing = fields.filter((f) => f.required && !used.has(f.id) && !candidates.has(f.id)).map((f) => f.id);
  return { used, complements, ignored, badUnit, missing, conflicts };
}

// ---------------------------------------------------------------- values

class Reject {
  constructor(
    readonly reason: RejectReason,
    readonly vars?: Record<string, string | number>,
  ) {}
}

/** Thousands grouping: western `1,234,567.5` or Indian `12,34,567.5`. Any other comma is a typo or a decimal comma. */
const WESTERN_GROUPS = /^\d{1,3}(?:,\d{3})+(?:\.\d*)?$/;
const INDIAN_GROUPS = /^\d{1,2}(?:,\d{2})*,\d{3}(?:\.\d*)?$/;

function number(text: string): number {
  const t = text.trim();
  // `parseDecimal` drops every comma, which would read `45,5` kg as 455 kg: only real grouping passes.
  if (t.includes(",") && !WESTERN_GROUPS.test(t) && !INDIAN_GROUPS.test(t)) throw new Reject("notNumber");
  const n = parseDecimal(t);
  if (n === null) throw new Reject("notNumber");
  return n;
}

/** `11 ft 6 in`, `11' 6"`, `11'6`, `12 ft`, `6 in`, or a plain number in `plain` units. Returns inches. */
function feetAndInches(text: string, plain: "in" | "ft"): number {
  const t = text.trim().toLowerCase();
  const fi = t.match(/^([\d.,]+)\s*(?:ft|feet|foot|')\s*(?:([\d.,]+)\s*(?:in|inch|inches|"|'')?)?$/);
  if (fi) return number(fi[1]!) * 12 + (fi[2] ? number(fi[2]) : 0);
  const inOnly = t.match(/^([\d.,]+)\s*(?:in|inch|inches|"|'')$/);
  if (inOnly) return number(inOnly[1]!);
  const n = number(t);
  return plain === "ft" ? n * 12 : n;
}

function toMm(text: string, unit: HeaderUnit | null, companyUnit: LengthUnit): number {
  // Never reached for metres (the column is not used), but never guess either.
  if (unit === "m") throw new Reject("notNumber");
  const effective = unit ?? (companyUnit === "mm" ? "mm" : "in");
  if (effective === "mm") return number(text);
  const inches = feetAndInches(text, effective === "ft" ? "ft" : "in");
  return inches * MM_PER_INCH;
}

function toGrams(text: string, unit: HeaderUnit | null): number {
  const n = number(text);
  return unit === "g" ? n : n * 1000;
}

const emailSchema = z.string().email();

type Cell = { text: string; column: MatchedColumn };

function readField(def: FieldDef, cell: Cell | undefined, companyUnit: LengthUnit): unknown {
  const text = (cell?.text ?? "").trim();
  if (text === "") {
    if (def.required) throw new Reject("blank");
    return undefined;
  }
  const unit = cell!.column.unit;
  switch (def.type) {
    case "text":
      if (text.length > MAX_TEXT) throw new Reject("tooLong", { max: MAX_TEXT });
      return text;
    case "email":
      if (text.length > MAX_TEXT) throw new Reject("tooLong", { max: MAX_TEXT });
      if (!emailSchema.safeParse(text).success) throw new Reject("badEmail");
      return text;
    case "status": {
      const s = text.toLowerCase();
      if (s !== "active" && s !== "archived") throw new Reject("badStatus");
      return s;
    }
    case "count": {
      const n = number(text);
      if (!Number.isInteger(n)) throw new Reject("notWhole");
      if (n <= 0) throw new Reject("notPositive");
      return n;
    }
    case "weight": {
      const g = Math.round(toGrams(text, unit));
      if (g < 1) throw new Reject("notPositive");
      return g;
    }
    case "length":
      return toMm(text, unit, companyUnit);
  }
}

// ---------------------------------------------------------------- rows

type Values = Record<string, unknown>;

function buildRow(kind: ImportKind, v: Values, companyUnit: LengthUnit): ParsedRow {
  const text = (k: string) => (v[k] as string | undefined) ?? null;
  if (kind === "bundles") {
    const lengthMm = Math.round(v.length as number);
    if (lengthMm <= 0) throw new FieldReject("length", new Reject("notPositive"));
    if (lengthMm < BUNDLE_LENGTH_MM.min || lengthMm > BUNDLE_LENGTH_MM.max) {
      throw new FieldReject("length", new Reject("lengthRange", { length: formatLength(lengthMm, companyUnit) }));
    }
    if ((v.weight as number) > BUNDLE_MAX_WEIGHT_G) {
      throw new FieldReject("weight", new Reject("weightRange", { weight: `${kgText(v.weight as number)} kg` }));
    }
    return {
      dieSeries: v.dieSeries as string,
      dieSectionCode: v.dieSectionCode as string,
      quantity: v.quantity as number,
      weightG: v.weight as number,
      lengthMm,
      poNumber: text("poNumber"),
    };
  }
  if (kind === "dies") {
    const min = v.weightMin as number;
    const max = v.weightMax as number;
    for (const [field, g] of [["weightMin", min], ["weightMax", max]] as const) {
      if (g > DIE_MAX_BAND_G) throw new FieldReject(field, new Reject("weightRange", { weight: `${kgText(g)} kg per 12 ft` }));
    }
    if (max < min) throw new FieldReject("weightMax", new Reject("rangeOrder"));
    // Die geometry keeps 0.1 mm (a die's tier changes only through a tier change, never from a sheet column).
    const geo = (k: string) => (typeof v[k] === "number" ? Math.round((v[k] as number) * 10) / 10 : undefined);
    const row: DieImportRow = {
      series: v.series as string,
      sectionCode: v.sectionCode as string,
      weightMinG: min,
      weightMaxG: max,
      dimensions: {},
    };
    // Only filled cells: an absent or empty column must not clear the die on update (see DieImportRow).
    if (typeof v.name === "string") row.name = v.name;
    if (v.status === "active" || v.status === "archived") row.status = v.status;
    if (typeof v.notes === "string") row.notes = v.notes;
    const width = geo("width");
    const thickness = geo("thickness");
    const leg = geo("leg");
    const height = geo("height");
    if (width !== undefined) row.widthMm = width;
    if (thickness !== undefined) row.thicknessMm = thickness;
    if (leg !== undefined) row.legMm = leg;
    if (height !== undefined) row.dimensions.heightMm = height;
    return row;
  }
  return {
    name: v.name as string,
    phone: text("phone"),
    email: text("email"),
    taxId: text("taxId"),
    notes: text("notes"),
  };
}

/** Grams as kg with grouping, for a problem message (`47,900`). */
function kgText(g: number): string {
  return (g / 1000).toLocaleString("en-US", { maximumFractionDigits: 3 });
}

class FieldReject {
  constructor(
    readonly field: string,
    readonly reject: Reject,
  ) {}
}

function uniqueKey(kind: ImportKind, row: ParsedRow): { key: string; field: string } | null {
  if (kind !== "dies") return null;
  const die = row as DieImportRow;
  return { key: `${die.series}\u0000${die.sectionCode}`, field: "sectionCode" };
}

/**
 * Parses sheet rows (header → cell text) for one import kind. Pure: no network,
 * no React. See the file comment for the rules.
 */
export function parseImport<K extends ImportKind>(
  kind: K,
  rows: readonly Record<string, string>[],
  ctx: ParseContext,
): ParseResult<ParsedRowByKind[K]> {
  const first = ctx.firstDataRow ?? 2;
  const headers: string[] = [];
  for (const row of rows) for (const h of Object.keys(row)) if (!headers.includes(h)) headers.push(h);

  const { used, complements, ignored, badUnit, missing, conflicts } = matchColumns(kind, headers);
  const result: ParseResult<ParsedRowByKind[K]> = {
    ok: [],
    okRows: [],
    rejected: [],
    columns: [...used.values(), ...complements.values()],
    missingColumns: missing,
    ignoredColumns: ignored,
    badUnitColumns: badUnit,
    conflictColumns: conflicts,
    blankRows: 0,
  };
  if (missing.length > 0 || conflicts.length > 0) return result;

  const fields = IMPORT_FIELDS[kind];
  const seen = new Map<string, number>();

  rows.forEach((raw, index) => {
    const rowNumber = first + index;
    if (Object.values(raw).every((cell) => String(cell ?? "").trim() === "")) {
      result.blankRows += 1;
      return;
    }
    const values: Values = {};
    const reject = (field: string, r: Reject, header?: string) => {
      const column = header ?? used.get(field)!.header;
      result.rejected.push({
        row: rowNumber,
        reason: `imports.reason.${r.reason}` as RejectReasonKey,
        column,
        ...(r.vars ? { vars: r.vars } : {}),
      });
    };

    for (const def of fields) {
      const column = used.get(def.id);
      if (!column) continue;
      const inchColumn = complements.get(def.id);
      if (inchColumn) {
        // Length as feet + inches in two columns: each in its own unit, then added.
        let total: number | undefined;
        let failedHeader = column.header;
        try {
          for (const c of [column, inchColumn]) {
            failedHeader = c.header;
            const part = readField({ ...def, required: false }, { text: String(raw[c.header] ?? ""), column: c }, ctx.companyUnit);
            if (typeof part === "number") total = (total ?? 0) + part;
          }
          if (total === undefined) {
            failedHeader = column.header;
            throw new Reject("blank");
          }
          values[def.id] = total;
        } catch (error) {
          if (!(error instanceof Reject)) throw error;
          reject(def.id, error, failedHeader);
          return;
        }
        continue;
      }
      try {
        values[def.id] = readField(def, { text: String(raw[column.header] ?? ""), column }, ctx.companyUnit);
      } catch (error) {
        if (!(error instanceof Reject)) throw error;
        reject(def.id, error);
        return;
      }
    }

    let parsed: ParsedRow;
    try {
      parsed = buildRow(kind, values, ctx.companyUnit);
    } catch (error) {
      if (!(error instanceof FieldReject)) throw error;
      reject(error.field, error.reject);
      return;
    }

    const unique = uniqueKey(kind, parsed);
    if (unique) {
      const other = seen.get(unique.key);
      if (other !== undefined) {
        reject(unique.field, new Reject("duplicate", { other }));
        return;
      }
      seen.set(unique.key, rowNumber);
    }

    result.ok.push(parsed as ParsedRowByKind[K]);
    result.okRows.push(rowNumber);
  });

  return result;
}

// ---------------------------------------------------------------- csv out

/** A cell that a spreadsheet would run as a formula. Signed numbers and phone numbers are left alone. */
function looksLikeFormula(cell: string): boolean {
  if (/^[=@\t\r]/.test(cell)) return true;
  return /^[+-]/.test(cell) && !/^[+-][\d\s().,-]*$/.test(cell);
}

/** RFC 4180 CSV (CRLF), with formula-looking cells prefixed by `'` so Excel shows them as text. */
export function toCsv(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  const cell = (value: string) => {
    const safe = looksLikeFormula(value) ? `'${value}` : value;
    return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return [headers, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

/** Rows per server call. The server takes up to 2000; 500 keeps each call well inside Worker CPU and D1 limits. */
export const IMPORT_CHUNK_SIZE = 500;

/** A die catalogue is one row per section, so a plant's whole book goes in as few calls as the server allows (it takes 2000). */
export const DIE_IMPORT_CHUNK_SIZE = 2000;

/** Rows per call for a kind of sheet (FP-DR-01: 3,000 dies go in two calls). */
export function importChunkSize(kind: ImportKind): number {
  return kind === "dies" ? DIE_IMPORT_CHUNK_SIZE : IMPORT_CHUNK_SIZE;
}

export function chunk<T>(items: readonly T[], size = IMPORT_CHUNK_SIZE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
