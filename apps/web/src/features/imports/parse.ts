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
 * junk, no `parseInt` truncation. A bad row is rejected with its sheet row
 * number and a reason (an i18n key under `imports.reason`); it is never coerced
 * to 0 and never dropped silently. Fully blank rows are skipped and counted.
 */
import { MM_PER_FOOT, MM_PER_INCH, parseDecimal, type LengthUnit } from "@orrn/domain";
import type { MessageKey } from "@orrn/i18n";
import { z } from "zod";

export type ImportKind = "bundles" | "dies" | "customers";

/** Unit read from a column name. */
export type HeaderUnit = "mm" | "in" | "ft" | "kg" | "g";

export type BundleImportRow = {
  dieSeries: string;
  dieSectionCode: string;
  quantity: number;
  weightG: number;
  lengthMm: number;
  poNumber: string | null;
};

export type DieImportRow = {
  series: string;
  sectionCode: string;
  name: string | null;
  weightMinG: number;
  weightMaxG: number;
  widthMm?: number;
  thicknessMm?: number;
  obliqueMm?: number;
  legMm?: number;
  dimensions: { heightMm?: number };
  status: "active" | "archived";
  notes: string | null;
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
  // Not produced by the parser: the dies sheet adds it after the server check.
  "deletedDie",
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
  blankRows: number;
};

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
};

function unitOf(text: string): HeaderUnit | null {
  const word = text.trim().toLowerCase().replace(/\.$/, "");
  return UNIT_WORDS[word] ?? null;
}

/**
 * Splits a header into a plain lowercase name and the unit it declares:
 * `"Length (mm)"` → `{ name: "length", unit: "mm" }`, `"weightG"` → `{ name: "weight", unit: "g" }`.
 * `kg/12ft` is kg (die weights are per 12 ft piece). Brackets that hold no unit are dropped.
 */
export function readHeader(raw: string): { name: string; unit: HeaderUnit | null } {
  // "kg/12ft", "kg per 12 ft", "kg/12'" all mean kg.
  let text = raw.replace(/\s*(?:\/|per)\s*12\s*(?:ft|feet|foot|')/gi, "");
  let unit: HeaderUnit | null = null;

  text = text.replace(/[([]([^)\]]*)[)\]]/g, (_whole, inner: string) => {
    unit ??= unitOf(inner);
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
  return { name: words.join(" "), unit };
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
    { id: "oblique", type: "length", aliases: ["oblique"] },
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

function matchColumns(kind: ImportKind, headers: readonly string[]) {
  const fields = IMPORT_FIELDS[kind];
  const used = new Map<string, MatchedColumn>();
  const ignored: string[] = [];
  for (const header of headers) {
    const { name, unit } = readHeader(header);
    const field = fields.find((f) => f.aliases.includes(name));
    const unitFits = field && (unit === null || UNITS_FOR[field.type].includes(unit));
    if (!field || !unitFits || used.has(field.id)) {
      if (header.trim() !== "") ignored.push(header);
      continue;
    }
    used.set(field.id, { field: field.id, header, unit });
  }
  const missing = fields.filter((f) => f.required && !used.has(f.id)).map((f) => f.id);
  return { used, ignored, missing };
}

// ---------------------------------------------------------------- values

class Reject {
  constructor(
    readonly reason: RejectReason,
    readonly vars?: Record<string, string | number>,
  ) {}
}

function number(text: string): number {
  const n = parseDecimal(text);
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

function buildRow(kind: ImportKind, v: Values): ParsedRow {
  const text = (k: string) => (v[k] as string | undefined) ?? null;
  if (kind === "bundles") {
    const lengthMm = Math.round(v.length as number);
    if (lengthMm <= 0) throw new FieldReject("length", new Reject("notPositive"));
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
    if (max < min) throw new FieldReject("weightMax", new Reject("rangeOrder"));
    // Die geometry keeps 0.1 mm (the oblique sets the die tier, ruling R16).
    const geo = (k: string) => (typeof v[k] === "number" ? Math.round((v[k] as number) * 10) / 10 : undefined);
    const row: DieImportRow = {
      series: v.series as string,
      sectionCode: v.sectionCode as string,
      name: text("name"),
      weightMinG: min,
      weightMaxG: max,
      dimensions: {},
      status: (v.status as "active" | "archived" | undefined) ?? "active",
      notes: text("notes"),
    };
    const width = geo("width");
    const thickness = geo("thickness");
    const oblique = geo("oblique");
    const leg = geo("leg");
    const height = geo("height");
    if (width !== undefined) row.widthMm = width;
    if (thickness !== undefined) row.thicknessMm = thickness;
    if (oblique !== undefined) row.obliqueMm = oblique;
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

  const { used, ignored, missing } = matchColumns(kind, headers);
  const result: ParseResult<ParsedRowByKind[K]> = {
    ok: [],
    okRows: [],
    rejected: [],
    columns: [...used.values()],
    missingColumns: missing,
    ignoredColumns: ignored,
    blankRows: 0,
  };
  if (missing.length > 0) return result;

  const fields = IMPORT_FIELDS[kind];
  const seen = new Map<string, number>();

  rows.forEach((raw, index) => {
    const rowNumber = first + index;
    if (Object.values(raw).every((cell) => String(cell ?? "").trim() === "")) {
      result.blankRows += 1;
      return;
    }
    const values: Values = {};
    const reject = (field: string, r: Reject) => {
      const column = used.get(field)!.header;
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
      parsed = buildRow(kind, values);
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

export function chunk<T>(items: readonly T[], size = IMPORT_CHUNK_SIZE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
