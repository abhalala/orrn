/**
 * Stock count screens (PL-10, FP stock count): view helpers over `count.*`. The server decides what
 * is phantom, found or moved; these only name it and shape what the floor types or pastes.
 */

/** A count's codes per request: the server takes at most 200 (a scanner burst or a pasted sheet). */
export const SCAN_CHUNK = 200;

/** Codes pasted from a sheet or a scanner dump: one per line or comma, trimmed, each once, in order. */
export function codesFromPaste(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of text.split(/[\n\r,;]+/)) {
    const code = part.trim().slice(0, 200);
    if (!code) continue;
    const key = code.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(code);
  }
  return out;
}

export function chunkCodes(codes: readonly string[], size = SCAN_CHUNK): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < codes.length; i += size) out.push(codes.slice(i, i + size));
  return out;
}

export type ScanMatch = "here" | "moved" | "elsewhere" | "not_in_stock" | "unknown" | "ambiguous";

/** The i18n key for what a scan found against the system, said at once so the floor hears the difference. */
export function matchKey(match: ScanMatch): `stock.count.match.${ScanMatch}` {
  return `stock.count.match.${match}`;
}

/** The chip tone of a scan: matches calm, a surprise amber, a code that is nothing red. */
export function matchTone(match: ScanMatch): "green" | "amber" | "red" {
  if (match === "here") return "green";
  if (match === "unknown" || match === "ambiguous") return "red";
  return "amber";
}

/** Basis points as the plant reads them: 120 -> "1.2%". */
export function bpText(bp: number): string {
  return `${(bp / 100).toFixed(1)}%`;
}

/** Variance with its sign: short is positive, extra is negative (the column says which). */
export function signed(n: number): string {
  return n > 0 ? `+${n.toLocaleString("en-IN")}` : n < 0 ? `-${Math.abs(n).toLocaleString("en-IN")}` : "0";
}

export type VarianceRow = { expected: number; counted: number; variance: number };

/** Σ of variance rows (a table footer): the same figures the server froze, added up here only to show a total. */
export function varianceTotal(rows: readonly VarianceRow[]): VarianceRow {
  return rows.reduce(
    (a, r) => ({ expected: a.expected + r.expected, counted: a.counted + r.counted, variance: a.variance + r.variance }),
    { expected: 0, counted: 0, variance: 0 },
  );
}

/** Whether a close must be confirmed: the server answered PRECONDITION_FAILED (a yard nobody scanned). */
export function needsUnscannedConfirm(error: unknown): boolean {
  return (error as { data?: { code?: string } } | null)?.data?.code === "PRECONDITION_FAILED";
}

/**
 * The yards to start a count over: a count over every active yard also expects bundles with no
 * yard (the server's rule); a subset does not.
 */
export function coversEveryYard(picked: ReadonlySet<string>, activeYardIds: readonly string[]): boolean {
  return activeYardIds.length > 0 && activeYardIds.every((id) => picked.has(id));
}
