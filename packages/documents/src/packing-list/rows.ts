import { MM_PER_INCH, kgPer12ft, weightRange12ft } from "@orrn/domain";

import { kgPerPieceG } from "./snapshot";
import type { PackingListSnapshot, PackingListSnapshotItem } from "./types";

/** kg per piece (3 decimals) by the one rule, `kgPerPieceG` (review m-6). */
function kgPerPieceOf(weightG: number, pcs: number): number | null {
  const g = kgPerPieceG(weightG, pcs);
  return g == null ? null : g / 1000;
}

/**
 * The packing list as the plant prints it, built once from a parsed snapshot
 * and shared by the on-screen view, the PDF, the Excel file and the native
 * print HTML, so all four always agree.
 *
 * Columns: Sr · Bundle no · Item · Weight kg · Cut length ft · Cut length in ·
 * Pcs · kg/12ft · Weight range /12'. Rows are grouped by packing group label,
 * else by section (die); never by the packing session the bundle came from.
 */
export type PackingListRow = {
  /** 1..N across the whole list. */
  sr: number;
  bundleNo: string;
  /** Section code and name ("14701 Patti 1" × 1/8""). */
  item: string;
  groupKey: string;
  /** Whole kg as stored (grams / 1000). */
  weightKg: number;
  /** The cut length in feet, from the length rounded to a quarter inch (2 decimals). */
  cutLengthFt: number;
  /** The same cut length in inches, to the nearest quarter inch. */
  cutLengthIn: number;
  pcs: number;
  /** kg per 12 ft piece, 3 decimals; null without pieces or length. */
  kgPer12ft: number | null;
  /** The billed weight band, floor to 0.1 with 0.01 grace; null without kg/12ft. */
  weightRange12ft: number | null;
  /** FP-PK-13: kg per piece, 3 decimals; null without pieces. Shown only when the plant switches it on. */
  kgPerPiece: number | null;
};

export type PackingListGroup = {
  key: string;
  /** The packing group label ("A") when set, else the section ("14701 Patti 1" × 1/8""). */
  label: string;
  labelled: boolean;
  /** The section(s) in the group, comma separated when a label spans several. */
  dieLabel: string;
  rows: PackingListRow[];
  bundles: number;
  pieces: number;
  weightKg: number;
};

export type PackingListHeader = {
  companyName: string;
  customerName: string;
  customerTaxId: string | null;
  customerPhone: string | null;
  dispatchCode: string;
  /** Dispatch day (completed, else generated), ISO `YYYY-MM-DD` in the company's time zone. */
  date: string | null;
  shipDate: string | null;
  notes: string | null;
};

export type PackingListModel = {
  header: PackingListHeader;
  groups: PackingListGroup[];
  totals: { bundles: number; pieces: number; weightKg: number };
};

export type PackingListModelOptions = {
  /** Company time zone for header dates. Default Asia/Kolkata (spec §5). */
  timeZone?: string;
  /**
   * FP-PK-13: print the optional kg-per-piece column after the plant's columns (company setting
   * `packingList.kgPerPiece`, off by default). Range/12' stays the plant column (Q3).
   */
  kgPerPiece?: boolean;
};

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
/** setItemGroupLabel stores labels trimmed, uppercased, at most 32 characters. */
const MAX_LABEL = 32;

function round(value: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round((value + Number.EPSILON) * f) / f;
}

/** "14701 Patti 1" × 1/8"" when the die has a name, else "14701 PATTI" (code and series). */
export function packingItemLabel(die: { series?: string | null; sectionCode?: string | null; name?: string | null }): string {
  const code = die.sectionCode?.trim() ?? "";
  const name = die.name?.trim() || die.series?.trim() || "";
  return [code, name].filter(Boolean).join(" ");
}

/**
 * The packing group label of a snapshot line, or null. A later snapshot says
 * so in `groupLabel`. In v1, `groupId` holds the label or else the packing
 * session (bundle group) id; labels are stored uppercase and at most 32
 * characters, while session ids are lowercase UUIDs (or `dev-group-NNN` in
 * the seed), so only an uppercase, non-UUID value is read as a label.
 */
export function packingGroupLabel(item: Pick<PackingListSnapshotItem, "groupId" | "groupLabel">): string | null {
  if (item.groupLabel !== undefined) return item.groupLabel?.trim() || null;
  const g = item.groupId?.trim();
  if (!g || g.length > MAX_LABEL || g !== g.toUpperCase() || UUID.test(g)) return null;
  return g;
}

/** Cut length in inches (nearest quarter) and feet (2 decimals). */
export function cutLength(lengthMm: number): { ft: number; inches: number } {
  const inches = Math.round(lengthMm / MM_PER_INCH / 0.25) * 0.25;
  return { ft: round(inches / 12, 2), inches };
}

/** Calendar day of an ISO instant in `timeZone`, as `YYYY-MM-DD`. */
export function isoDay(iso: string | null | undefined, timeZone: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

/** Natural order for labels: "A" < "B" < "A2" < "A10". */
const byLabel = (a: string, b: string) => a.localeCompare(b, "en", { numeric: true, sensitivity: "base" });

export function packingListModel(pl: PackingListSnapshot, opts: PackingListModelOptions = {}): PackingListModel {
  const timeZone = opts.timeZone ?? "Asia/Kolkata";
  type Draft = { key: string; label: string; labelled: boolean; dies: string[]; items: PackingListSnapshotItem[]; order: number };
  const drafts = new Map<string, Draft>();

  pl.items.forEach((item, index) => {
    const itemLabel = packingItemLabel(item.die);
    const label = packingGroupLabel(item);
    const key = label ? `label:${label}` : `die:${item.die.sectionCode}|${item.die.series}|${item.die.name ?? ""}`;
    let draft = drafts.get(key);
    if (!draft) {
      draft = { key, label: label ?? itemLabel, labelled: Boolean(label), dies: [], items: [], order: index };
      drafts.set(key, draft);
    }
    if (!draft.dies.includes(itemLabel)) draft.dies.push(itemLabel);
    draft.items.push(item);
  });

  // Labelled groups first, in label order (the order the office wrote on the bundles); then
  // sections in the order they were scanned, as on the plant's paper list.
  const ordered = [...drafts.values()].sort((a, b) => {
    if (a.labelled !== b.labelled) return a.labelled ? -1 : 1;
    return a.labelled ? byLabel(a.label, b.label) : a.order - b.order;
  });

  let sr = 0;
  let totalG = 0;
  let totalPieces = 0;
  const groups: PackingListGroup[] = ordered.map((draft) => {
    let groupG = 0;
    let groupPieces = 0;
    const rows = draft.items.map((item): PackingListRow => {
      sr += 1;
      groupG += item.weightG;
      groupPieces += item.quantity;
      const kg12 = kgPer12ft({ weightG: item.weightG, pieces: item.quantity, lengthMm: item.lengthMm });
      const length = cutLength(item.lengthMm);
      return {
        sr,
        bundleNo: item.bundleSerial,
        item: packingItemLabel(item.die),
        groupKey: draft.key,
        weightKg: item.weightG / 1000,
        cutLengthFt: length.ft,
        cutLengthIn: length.inches,
        pcs: item.quantity,
        kgPer12ft: kg12 === null ? null : round(kg12, 3),
        weightRange12ft: kg12 === null ? null : weightRange12ft(kg12),
        kgPerPiece: kgPerPieceOf(item.weightG, item.quantity),
      };
    });
    totalG += groupG;
    totalPieces += groupPieces;
    return {
      key: draft.key,
      label: draft.label,
      labelled: draft.labelled,
      dieLabel: draft.dies.join(", "),
      rows,
      bundles: rows.length,
      pieces: groupPieces,
      weightKg: groupG / 1000,
    };
  });

  const completed = pl.dispatch.completedAt ?? pl.generatedAt;
  return {
    header: {
      companyName: pl.company.name,
      customerName: pl.dispatch.customer.name,
      customerTaxId: pl.dispatch.customer.taxId?.trim() || null,
      customerPhone: pl.dispatch.customer.phone?.trim() || null,
      dispatchCode: pl.dispatch.code,
      date: isoDay(completed, timeZone),
      // The ship date is a picked calendar day stored as UTC midnight (ruling T22): read it in UTC,
      // so a company west of UTC never prints the day before. `date` is a real instant.
      shipDate: isoDay(pl.dispatch.shipDate, "UTC"),
      notes: pl.dispatch.notes?.trim() || null,
    },
    groups,
    totals: { bundles: sr, pieces: totalPieces, weightKg: totalG / 1000 },
  };
}
