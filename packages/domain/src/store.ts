/**
 * XE store (rows 69 to 73): pure rules for buying and valuing store items. Quantities are integer
 * milli-units of the item's unit (1000 = 1 kg, 1 litre, 1 piece), money is integer paise, GST and the
 * over-receipt tolerance are basis points. The server computes every number with these (and the SQL in
 * `packages/server/src/lib/storeValue.ts` uses the same formulas; a test runs both on the same examples).
 */

/** 100,000 units, the store's cap on one entry (MAX_STORE_QTY_MILLI on the server). */
export const STORE_MAX_QTY_MILLI = 100_000_000;

/** ₹1 crore per unit: a rate cap far above any store item. */
export const STORE_MAX_RATE_PAISE = 1_000_000_000;

/** GST up to 28 % in basis points (the schedule's top slab; cess is not a store concern). */
export const STORE_MAX_GST_BP = 2_800;

/** Default over-receipt tolerance on a PO line when the plant sets none: 5 %. */
export const DEFAULT_PO_OVER_RECEIPT_BP = 500;

/** Tolerance cap: 50 %. Beyond that it is a new order, not an over-delivery. */
export const MAX_PO_OVER_RECEIPT_BP = 5_000;

/** Lines on one indent or purchase order. */
export const STORE_MAX_DOC_LINES = 40;

/**
 * Money of a quantity at a rate: round(qty × rate / 1000), exact in integers. Callers keep
 * qty × rate within `Number.MAX_SAFE_INTEGER` (`rateFitsQty`).
 */
export function lineValuePaise(qtyMilli: number, ratePaise: number): number {
  return Math.round((qtyMilli * ratePaise) / 1000);
}

/** qty × rate stays an exact integer (both in JS and in SQLite's 64-bit integers). */
export function rateFitsQty(qtyMilli: number, ratePaise: number): boolean {
  return Number.isSafeInteger(qtyMilli * ratePaise);
}

/** What a GRN adds to the store's value: quantity × rate, or 0 when it has no rate ("no rate"). */
export function grnValuePaise(qtyMilli: number, ratePaise: number | null): number {
  return ratePaise === null ? 0 : lineValuePaise(qtyMilli, ratePaise);
}

/**
 * What an issue of `issueMilli` takes out, at the weighted average of what is held: value × qty / held,
 * rounded. The issue that takes everything left takes all the value left, so an empty item holds
 * nothing. Never negative (a GRN cancelled after issues can leave the held value below 0). Computed in
 * floating point exactly as the SQL does (`value * 1.0 * qty / held`), so both round the same way.
 */
export function issueValuePaise(heldMilli: number, heldValuePaise: number, issueMilli: number): number {
  if (heldMilli <= 0 || heldValuePaise <= 0) return 0;
  if (issueMilli >= heldMilli) return heldValuePaise;
  return Math.max(0, Math.round((heldValuePaise * 1.0 * issueMilli) / heldMilli));
}

/** Average rate in paise per unit of what is held; null when nothing is held. */
export function averageRatePaise(heldMilli: number, heldValuePaise: number): number | null {
  if (heldMilli <= 0) return null;
  return Math.round((Math.max(0, heldValuePaise) * 1000) / heldMilli);
}

/** The value shown for a holding: 0 when nothing is held, never below 0. */
export function heldValueShown(heldMilli: number, heldValuePaise: number): number {
  return heldMilli > 0 ? Math.max(0, heldValuePaise) : 0;
}

/** The most a PO line may receive (accepted) under the tolerance: ordered + floor(ordered × bp / 10 000). */
export function maxReceivableMilli(orderedMilli: number, toleranceBp: number): number {
  return orderedMilli + Math.floor((orderedMilli * toleranceBp) / 10_000);
}

/** A plant's tolerance from its settings value, falling back to the default for anything malformed. */
export function readPoOverReceiptBp(raw: unknown): number {
  return typeof raw === "number" && Number.isInteger(raw) && raw >= 0 && raw <= MAX_PO_OVER_RECEIPT_BP
    ? raw
    : DEFAULT_PO_OVER_RECEIPT_BP;
}

export type PoLineMoney = { qtyMilli: number; ratePaise: number; gstBp: number };

/** One line's amount before GST, its GST and its total. GST rounds per line, as on the printed order. */
export function poLineMoney(line: PoLineMoney): { amountPaise: number; gstPaise: number; totalPaise: number } {
  const amountPaise = lineValuePaise(line.qtyMilli, line.ratePaise);
  const gstPaise = Math.round((amountPaise * line.gstBp) / 10_000);
  return { amountPaise, gstPaise, totalPaise: amountPaise + gstPaise };
}

/** Totals over the lines of an order. */
export function poTotals(lines: readonly PoLineMoney[]): { amountPaise: number; gstPaise: number; totalPaise: number } {
  let amountPaise = 0;
  let gstPaise = 0;
  for (const l of lines) {
    const m = poLineMoney(l);
    amountPaise += m.amountPaise;
    gstPaise += m.gstPaise;
  }
  return { amountPaise, gstPaise, totalPaise: amountPaise + gstPaise };
}

export type PoReceiptState = "issued" | "part_received" | "closed";

/**
 * Where an issued order stands from what its lines received (accepted, live GRNs): nothing yet =
 * issued, every line at or above its ordered quantity = closed, anything else = part received.
 */
export function poStatusFromReceipts(lines: readonly { orderedMilli: number; receivedMilli: number }[]): PoReceiptState {
  if (lines.length === 0 || lines.every((l) => l.receivedMilli <= 0)) return "issued";
  return lines.every((l) => l.receivedMilli >= l.orderedMilli) ? "closed" : "part_received";
}

export type StoreIndentStatus = "open" | "approved" | "rejected" | "ordered" | "cancelled";
export type StoreIndentAction = "approve" | "reject" | "order" | "cancel";

/** The indent status flow: open → approved | rejected | cancelled; approved → ordered | cancelled. */
export function nextIndentStatus(from: StoreIndentStatus, action: StoreIndentAction): StoreIndentStatus | null {
  switch (action) {
    case "approve":
      return from === "open" ? "approved" : null;
    case "reject":
      return from === "open" ? "rejected" : null;
    case "order":
      return from === "approved" ? "ordered" : null;
    case "cancel":
      return from === "open" || from === "approved" ? "cancelled" : null;
  }
}

export type StorePoStatus = "draft" | "issued" | "part_received" | "closed" | "cancelled";

/** Lines and header fields change only while the order is a draft. */
export function poEditable(status: StorePoStatus): boolean {
  return status === "draft";
}

/** A draft or an issued order with nothing received may be cancelled; after a delivery, close it short instead. */
export function poCancellable(status: StorePoStatus, receivedAny: boolean): boolean {
  return status === "draft" || (status === "issued" && !receivedAny);
}

/** Only a part received order is closed by hand (short close); a full delivery closes it by itself. */
export function poClosableByHand(status: StorePoStatus): boolean {
  return status === "part_received";
}

/** An item is below its reorder point when it has a minimum and holds less than it. */
export function belowMinimum(balanceMilli: number, minMilli: number | null): boolean {
  return minMilli !== null && minMilli > 0 && balanceMilli < minMilli;
}

/**
 * What "make indent" asks for: the reorder quantity when set, else enough to reach the minimum again.
 * Never less than 1 milli-unit; countable units round up to a whole number.
 */
export function reorderQtyMilli(item: {
  balanceMilli: number;
  minMilli: number | null;
  reorderMilli: number | null;
  countable: boolean;
}): number {
  const want =
    item.reorderMilli !== null && item.reorderMilli > 0
      ? item.reorderMilli
      : Math.max(1, (item.minMilli ?? 0) - Math.max(0, item.balanceMilli));
  const qty = item.countable ? Math.max(1000, Math.ceil(want / 1000) * 1000) : want;
  return Math.min(qty, STORE_MAX_QTY_MILLI);
}

/** One entry's effect on the month report, frozen on the row. */
export type ValuationEntry = {
  kind: "grn" | "mrs";
  qtyMilli: number;
  valuePaise: number;
  createdAt: number;
  cancelledAt: number | null;
};

export type MonthValuation = {
  openingMilli: number;
  openingPaise: number;
  inMilli: number;
  inPaise: number;
  outMilli: number;
  outPaise: number;
  closingMilli: number;
  closingPaise: number;
};

/**
 * The month report for one item over `[from, to)`: what was held at `from`, what came in (GRNs) and
 * went out (MRSs) during the month, and what was held at `to`. An entry counts at its `createdAt`; its
 * cancel undoes it at `cancelledAt`, inside its own column (a GRN cancelled this month lowers this
 * month's "in", so "in" can be negative when the GRN was from an earlier month).
 */
export function monthValuation(entries: readonly ValuationEntry[], from: number, to: number): MonthValuation {
  const r: MonthValuation = {
    openingMilli: 0, openingPaise: 0, inMilli: 0, inPaise: 0, outMilli: 0, outPaise: 0, closingMilli: 0, closingPaise: 0,
  };
  const add = (e: ValuationEntry, undo: boolean, at: number) => {
    const sign = (e.kind === "grn" ? 1 : -1) * (undo ? -1 : 1);
    if (at < from) {
      r.openingMilli += sign * e.qtyMilli;
      r.openingPaise += sign * e.valuePaise;
    } else if (at < to) {
      const mag = undo ? -1 : 1;
      if (e.kind === "grn") {
        r.inMilli += mag * e.qtyMilli;
        r.inPaise += mag * e.valuePaise;
      } else {
        r.outMilli += mag * e.qtyMilli;
        r.outPaise += mag * e.valuePaise;
      }
    }
  };
  for (const e of entries) {
    add(e, false, e.createdAt);
    if (e.cancelledAt !== null) add(e, true, e.cancelledAt);
  }
  r.closingMilli = r.openingMilli + r.inMilli - r.outMilli;
  r.closingPaise = r.openingPaise + r.inPaise - r.outPaise;
  return r;
}
