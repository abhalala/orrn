export type ImportRow = {
  dieSeries: string;
  dieSectionCode: string;
  quantity: number;
  weightG: number;
  lengthMm: number;
  poNumber?: string | null;
};

export type ParsedFile = { rows: ImportRow[]; skipped: number[] };

/** Split normalized rows into valid ones and the 1-based data-row numbers that were dropped. */
export function partitionRows(list: Partial<ImportRow>[]): ParsedFile {
  const rows: ImportRow[] = [];
  const skipped: number[] = [];
  list.forEach((row, i) => {
    if (isValidRow(row)) rows.push(row);
    else skipped.push(i + 1);
  });
  return { rows, skipped };
}

export function describeSkipped(skipped: number[]) {
  const first = skipped.slice(0, 5).join(", ");
  const more = skipped.length > 5 ? ` and ${skipped.length - 5} more` : "";
  return `Skipped data row${skipped.length === 1 ? "" : "s"} ${first}${more}.`;
}

export function normalizeRow(
  row: Record<string, unknown>,
  parseLength: (raw: string) => number | undefined,
): Partial<ImportRow> {
  // CSVs come in with everything as strings; JSON can have native numbers.
  // Support both `lengthMm` (canonical) and `lengthIn` (operator-friendly via
  // the active unit's parser) so the importer matches the rest of the app.
  const lengthRaw = row.lengthMm ?? row.lengthIn ?? row.length;
  const length = typeof lengthRaw === "number"
    ? lengthRaw
    : typeof lengthRaw === "string" && lengthRaw.length > 0
      ? parseLength(lengthRaw)
      : undefined;

  return {
    dieSeries: String(row.dieSeries ?? row.series ?? "").trim(),
    dieSectionCode: String(row.dieSectionCode ?? row.sectionCode ?? "").trim(),
    // Blank or missing cells stay undefined (never coerced to 0) so isValidRow drops the row.
    quantity: toNumber(row.quantity),
    weightG: roundedOrUndefined(toNumber(row.weightG ?? row.weight)),
    lengthMm: typeof length === "number" ? Math.round(length) : undefined,
    poNumber: String(row.poNumber ?? row.po_number ?? row.po ?? "").trim() || null,
  };
}

function toNumber(raw: unknown): number | undefined {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : undefined;
  if (typeof raw === "string" && raw.trim().length > 0) {
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function roundedOrUndefined(n: number | undefined): number | undefined {
  return n === undefined ? undefined : Math.round(n);
}

export function isValidRow(row: Partial<ImportRow>): row is ImportRow {
  return (
    !!row.dieSeries &&
    !!row.dieSectionCode &&
    typeof row.quantity === "number" &&
    Number.isInteger(row.quantity) &&
    row.quantity > 0 &&
    typeof row.weightG === "number" &&
    row.weightG > 0 &&
    typeof row.lengthMm === "number" &&
    row.lengthMm > 0
  );
}
