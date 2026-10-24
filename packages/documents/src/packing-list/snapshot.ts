import type { PlGroup, PlRow, PlSnapshotV2 } from "@orrn/server/lib/packingListSnapshot";

export type { PlGroup, PlRow, PlSnapshotV2 };

/**
 * Immutable packing list snapshot stored in D1 and used for client exports.
 *
 * @deprecated as a v1 parse target: parse stored snapshots with
 * `parsePackingListSnapshot` (types.ts) and build rows with `packingListModel`
 * (rows.ts); never show `totals.totalLengthM` (S12/W7).
 *
 * v1 keys (`dispatch`, `company`, `items`, `totals`, `generatedAt`) are on every snapshot. A v2
 * snapshot (PL-8, `version: 2`) adds the real PL: `header` (letterhead, bill-to / ship-to, PL
 * number, date, vehicle, driver, PO and invoice numbers), the 11 `columns`, rows `groups`ed by order
 * line or section, and `summary` ("N bundles · X kg"). Check with `isPlSnapshotV2`.
 */
export type PLSnapshot = {
  version?: 1 | 2;
  dispatch: {
    code: string;
    customer: {
      name: string;
      phone?: string | null;
      email?: string | null;
      billingAddress?: Record<string, unknown> | null;
      shippingAddress?: Record<string, unknown> | null;
      taxId?: string | null;
    };
    shipDate: string | null;
    notes: string;
    completedAt: string | null;
  };
  company: { id: string; name: string };
  items: Array<{
    bundleSerial: string;
    die: { series: string; sectionCode: string };
    groupId: string;
    quantity: number;
    weightG: number;
    lengthMm: number;
  }>;
  totals: {
    totalBundles: number;
    totalQuantity: number;
    totalWeightKg: number;
    totalLengthM: number;
  };
  generatedAt: string;
  header?: PlSnapshotV2["header"];
  columns?: PlSnapshotV2["columns"];
  groups?: PlSnapshotV2["groups"];
  summary?: PlSnapshotV2["summary"];
};

type MaybeV2 = {
  version?: number | null;
  header?: PlSnapshotV2["header"] | null;
  groups?: PlSnapshotV2["groups"] | null;
  summary?: PlSnapshotV2["summary"] | null;
};

/** True when a snapshot (raw `PLSnapshot` or parsed `PackingListSnapshot`) carries the PL-8 v2 blocks. */
export function isPlSnapshotV2<T extends MaybeV2>(
  pl: T,
): pl is T & { version: 2; header: PlSnapshotV2["header"]; groups: PlSnapshotV2["groups"]; summary: PlSnapshotV2["summary"] } {
  return pl.version === 2 && Boolean(pl.header && pl.groups && pl.summary);
}

/** A safe file name for a PL number: "PL/2026-27/14" → "PL-2026-27-14" (slashes would make folders). */
export function plFileName(code: string): string {
  return code.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "packing-list";
}

/** Printed column headings, in order (the PL is a customer document, printed in English). */
export const PL_COLUMN_HEADINGS = [
  "Sr",
  "Bundle no",
  "Section",
  "Item",
  "Weight kg",
  "Cut ft",
  "Cut in",
  "Pcs",
  "kg/12ft",
  "Range /12'",
  "PO",
] as const;

const kg3 = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 3, maximumFractionDigits: 3 });

/** "25.500" — kg with Indian grouping, gram precision (rows add up to the total exactly). */
export function formatPlKg(weightG: number): string {
  return kg3.format(weightG / 1000);
}

/** One printed row as the 11 cell texts. */
export function plRowCells(r: PlRow): string[] {
  return [
    String(r.sr),
    r.bundleNo,
    r.section,
    r.item,
    formatPlKg(r.weightG),
    String(r.cutFt),
    String(r.cutIn),
    String(r.pcs),
    r.kgPer12ftMilli == null ? "—" : (r.kgPer12ftMilli / 1000).toFixed(3),
    r.range12ft == null ? "—" : r.range12ft.toFixed(1),
    r.po ?? "",
  ];
}

/**
 * "SO-12 / 1 · 12170 · Domal (Anodise) · PO 778" or "12170 · Domal" for bundles without a line. SO
 * numbers repeat every FY: pass the PL's groups and a number that two periods share prints its
 * period too ("SO-3 (2026-27) / 1").
 */
export function plGroupTitle(g: PlGroup, all: readonly PlGroup[] = []): string {
  const shared =
    g.orderNumber != null &&
    all.some((o) => o.orderNumber === g.orderNumber && (o.orderPeriod ?? null) !== (g.orderPeriod ?? null));
  const order = g.orderNumber ? `${g.orderNumber}${shared && g.orderPeriod ? ` (${g.orderPeriod})` : ""} / ${g.lineNo}` : null;
  const parts = [order, g.sectionCode, g.item, g.poNumber ? `PO ${g.poNumber}` : null];
  return parts.filter(Boolean).join(" · ");
}

/** "1 bundle", "157 bundles" (ruling PL8-R19). */
export function bundlesText(n: number): string {
  return `${n} ${n === 1 ? "bundle" : "bundles"}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
/** IST is UTC+05:30 all year (no DST): the plant's clock for snapshots made before `header.shipDate`. */
const IST_OFFSET_MS = 330 * 60_000;

/**
 * The dispatch's ship date as printed ("05 Oct 2026"), or null when none was set. `shipYmd` is the
 * snapshot's `header.shipDate` (the company's calendar day, review round 3 m-5); without it the
 * instant is read on the plant's clock (IST). Formatted by hand, so neither the reader's timezone nor
 * the runtime's Intl support (Hermes on native) can move the day.
 */
export function plShipDateText(shipDate: string | null | undefined, shipYmd?: string | null): string | null {
  let ymd = shipYmd && /^\d{4}-\d{2}-\d{2}$/.test(shipYmd) ? shipYmd : null;
  if (!ymd) {
    if (!shipDate) return null;
    const at = new Date(shipDate).getTime();
    if (Number.isNaN(at)) return null;
    ymd = new Date(at + IST_OFFSET_MS).toISOString().slice(0, 10);
  }
  const [y, m, d] = ymd.split("-");
  return `${d} ${MONTHS[Number(m) - 1]} ${y}`;
}
