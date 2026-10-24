/**
 * The A4 sticker sheet (explorer High 13): the fallback when no label printer is connected. Pure
 * layout: how many stickers go on a page, where a half-used sheet starts, and what a sticker says.
 */
export const SHEET_SIZES = [10, 21] as const;
export type SheetSize = (typeof SHEET_SIZES)[number];

/** Columns × rows of each sheet size (10 = 2×5 big stickers, 21 = 3×7 small ones). */
export const SHEET_GRID: Record<SheetSize, { cols: number; rows: number }> = {
  10: { cols: 2, rows: 5 },
  21: { cols: 3, rows: 7 },
};

export function isSheetSize(n: unknown): n is SheetSize {
  return n === 10 || n === 21;
}

/**
 * Pages of stickers. `skip` empty positions lead the first page (a sheet already part used), so the
 * labels land on the stickers that are left. Every page has exactly `size` slots; empty slots are null.
 */
export function paginateLabels<T>(labels: readonly T[], size: SheetSize, skip = 0): (T | null)[][] {
  const lead = Math.max(0, Math.min(Math.trunc(skip), size - 1));
  const slots: (T | null)[] = [...Array.from({ length: lead }, () => null), ...labels];
  const pages: (T | null)[][] = [];
  for (let i = 0; i < slots.length; i += size) {
    const page = slots.slice(i, i + size);
    while (page.length < size) page.push(null);
    pages.push(page);
  }
  return pages;
}

/** Pages needed for `count` labels (at least one, even with none, so the sheet is never blank). */
export function pageCount(count: number, size: SheetSize, skip = 0): number {
  const lead = Math.max(0, Math.min(Math.trunc(skip), size - 1));
  return Math.max(1, Math.ceil((count + lead) / size));
}

export type StickerLabel = {
  bundleId: string;
  serial: string;
  partyNo: string;
  qr: string;
  cast: string;
  salesOrder: string;
  standard: string;
  cml: string;
  showLogo: boolean;
  sectionCode: string;
  series: string;
  dieName: string | null;
  weightG: number;
  pieces: number;
  lengthMm: number;
  kgPer12ftMilli: number | null;
  poNumber: string | null;
};

/** The standard line as printed: "IS 733 · CM/L 123" (either part may be missing). */
export function standardLine(l: Pick<StickerLabel, "standard" | "cml">): string {
  return [l.standard, l.cml ? `CM/L ${l.cml}` : ""].filter(Boolean).join(" · ");
}

/** The party number on a sticker: only when it differs from the serial. */
export function stickerPartyNo(l: Pick<StickerLabel, "serial" | "partyNo">): string | null {
  return l.partyNo && l.partyNo !== l.serial ? l.partyNo : null;
}
