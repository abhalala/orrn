import { cutLength, packingItemLabel } from "../packing-list/rows";

/**
 * FP-OP-19 print and export (W4-NEXTROWS): the sales order sheet and the press plan's shift die
 * list, built once here and shared by the print page and the Excel sheet so both agree. English,
 * like the plant's paper. The order sheet shows a rate column only when the caller passes rates
 * (the server sends `ratePaise` only to `order.price` holders with `priceOnSalesOrder` on); the
 * shift list never has a rate.
 */

const kgOf = (g: number) => g / 1000;

export type OrderSheetInput = {
  companyName: string | null;
  order: {
    number: string;
    poNumber: string | null;
    orderDate: string;
    expectedDate: string | null;
    customerName: string;
    customerGstin: string | null;
    status: string;
    note: string | null;
  };
  lines: {
    lineNo: number;
    sectionCode: string;
    series: string;
    sectionName: string | null;
    cutLengthMm: number;
    /** "12170-2", "Tier 1 or better" or "" (the die room picks). */
    copy: string;
    alloy: string | null;
    temper: string | null;
    finish: string | null;
    orderedPcs: number | null;
    orderedG: number;
    dispatchedG: number;
    bakiG: number;
    /** Present only for a caller allowed to see rates. */
    ratePaise?: number | null;
    note: string | null;
  }[];
};

export type OrderSheetRow = {
  lineNo: number;
  die: string;
  copy: string;
  cutLengthFt: number;
  cutLengthIn: number;
  alloyTemper: string;
  finish: string;
  pcs: number | null;
  orderedKg: number;
  dispatchedKg: number;
  bakiKg: number;
  /** ₹ per kg, or null (no rate on the line, or rates hidden). */
  rateRupees: number | null;
  note: string;
};

export type OrderSheetModel = {
  header: OrderSheetInput["order"] & { companyName: string };
  showRate: boolean;
  rows: OrderSheetRow[];
  totals: { pcs: number; orderedKg: number; dispatchedKg: number; bakiKg: number };
};

export function orderSheetModel(input: OrderSheetInput): OrderSheetModel {
  // A rate column only when the server sent the field at all (never for floor roles).
  const showRate = input.lines.some((l) => "ratePaise" in l);
  const rows = input.lines
    .slice()
    .sort((a, b) => a.lineNo - b.lineNo)
    .map((l) => {
      const len = cutLength(l.cutLengthMm);
      return {
        lineNo: l.lineNo,
        die: packingItemLabel({ sectionCode: l.sectionCode, name: l.sectionName, series: l.series }),
        copy: l.copy,
        cutLengthFt: len.ft,
        cutLengthIn: len.inches,
        alloyTemper: [l.alloy, l.temper].filter(Boolean).join(" "),
        finish: l.finish ?? "",
        pcs: l.orderedPcs,
        orderedKg: kgOf(l.orderedG),
        dispatchedKg: kgOf(l.dispatchedG),
        bakiKg: kgOf(l.bakiG),
        rateRupees: showRate && l.ratePaise != null ? l.ratePaise / 100 : null,
        note: l.note ?? "",
      };
    });
  return {
    header: { ...input.order, companyName: input.companyName ?? "" },
    showRate,
    rows,
    totals: {
      pcs: input.lines.reduce((s, l) => s + (l.orderedPcs ?? 0), 0),
      orderedKg: kgOf(input.lines.reduce((s, l) => s + l.orderedG, 0)),
      dispatchedKg: kgOf(input.lines.reduce((s, l) => s + l.dispatchedG, 0)),
      bakiKg: kgOf(input.lines.reduce((s, l) => s + l.bakiG, 0)),
    },
  };
}

export const ORDER_SHEET_COLUMNS = ["Line", "Die", "Copy / tier", "Cut ft", "Cut in", "Alloy", "Finish", "Pcs", "Ordered kg", "Dispatched kg", "Baki kg"] as const;
export const ORDER_SHEET_RATE_COLUMN = "Rate Rs/kg";

export function orderSheetColumns(model: Pick<OrderSheetModel, "showRate">): string[] {
  return model.showRate ? [...ORDER_SHEET_COLUMNS, ORDER_SHEET_RATE_COLUMN] : [...ORDER_SHEET_COLUMNS];
}

/** One row as printed cells (numbers stay numbers for Excel). */
export function orderSheetCells(r: OrderSheetRow, showRate: boolean): (string | number)[] {
  const cells: (string | number)[] = [
    r.lineNo,
    r.die,
    r.copy,
    r.cutLengthFt,
    r.cutLengthIn,
    r.alloyTemper,
    r.finish,
    r.pcs ?? "",
    +r.orderedKg.toFixed(3),
    +r.dispatchedKg.toFixed(3),
    +r.bakiKg.toFixed(3),
  ];
  if (showRate) cells.push(r.rateRupees == null ? "" : +r.rateRupees.toFixed(2));
  return cells;
}

export function orderSheetFileName(orderNumber: string): string {
  return `order-${orderNumber.replace(/[^A-Za-z0-9._-]+/g, "-")}`;
}

/** Shift die list of a press plan: one block per die, its order lines, no rate. */
export type PlanSheetInput = {
  companyName: string | null;
  plan: {
    number: string;
    status: string;
    purpose: string;
    pressLine: string | null;
    windowStart: number;
    windowEnd: number;
    note: string | null;
  };
  dies: {
    sectionCode: string;
    sectionName: string | null;
    urgent: boolean;
    lines: { customerName: string; orderNumber: string; poNumber: string | null; lineNo: number; cutLengthMm: number; pcs: number | null; kgG: number }[];
  }[];
};

export type PlanSheetModel = {
  header: Omit<PlanSheetInput["plan"], "windowStart" | "windowEnd"> & { companyName: string; window: string };
  dies: {
    title: string;
    urgent: boolean;
    rows: { party: string; order: string; po: string; cutLengthFt: number; cutLengthIn: number; pcs: number | null; kg: number }[];
    pcs: number;
    kg: number;
  }[];
  totals: { dies: number; pcs: number; kg: number };
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "25 Oct, 08:00" in `timeZone`, built from parts so no ICU wording ("at") creeps in. */
function stamp(at: number, timeZone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(at))
      .map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  return `${Number(parts.day)} ${MONTHS[Number(parts.month) - 1]}, ${parts.hour}:${parts.minute}`;
}

function windowText(start: number, end: number, timeZone: string): string {
  return `${stamp(start, timeZone)} to ${stamp(end, timeZone)}`;
}

export function planSheetModel(input: PlanSheetInput, opts: { timeZone?: string } = {}): PlanSheetModel {
  const timeZone = opts.timeZone ?? "Asia/Kolkata";
  const { windowStart, windowEnd, ...plan } = input.plan;
  const dies = input.dies.map((d) => {
    const rows = d.lines.map((l) => {
      const len = cutLength(l.cutLengthMm);
      return {
        party: l.customerName,
        order: `${l.orderNumber} / ${l.lineNo}`,
        po: l.poNumber ?? "",
        cutLengthFt: len.ft,
        cutLengthIn: len.inches,
        pcs: l.pcs,
        kg: kgOf(l.kgG),
      };
    });
    return {
      title: d.sectionName ? `${d.sectionCode} ${d.sectionName}` : d.sectionCode,
      urgent: d.urgent,
      rows,
      pcs: rows.reduce((s, r) => s + (r.pcs ?? 0), 0),
      kg: rows.reduce((s, r) => s + r.kg, 0),
    };
  });
  return {
    header: { ...plan, companyName: input.companyName ?? "", window: windowText(windowStart, windowEnd, timeZone) },
    dies,
    totals: { dies: dies.length, pcs: dies.reduce((s, d) => s + d.pcs, 0), kg: dies.reduce((s, d) => s + d.kg, 0) },
  };
}

export const PLAN_SHEET_COLUMNS = ["Party", "Order / line", "PO", "Cut ft", "Cut in", "Pcs", "Kg"] as const;

export function planSheetFileName(planNumber: string): string {
  return `plan-${planNumber.replace(/[^A-Za-z0-9._-]+/g, "-")}`;
}

/** The order book as one sheet (FP-OP-19 "export the order book"): one row per order of the filter, no rate. */
export type OrderBookExportRow = {
  number: string;
  customerName: string;
  city: string | null;
  poNumber: string | null;
  orderDate: string;
  expectedDate: string | null;
  status: string;
  lines: number;
  orderedG: number;
  dispatchedG: number;
  bakiG: number;
  inStockG: number;
  lateDays: number | null;
};

export const ORDER_BOOK_COLUMNS = ["Order", "Party", "City", "PO", "Order date", "Expected", "Status", "Lines", "Ordered kg", "Dispatched kg", "In stock kg", "Baki kg", "Late days"] as const;

export function orderBookCells(r: OrderBookExportRow): (string | number)[] {
  return [
    r.number,
    r.customerName,
    r.city ?? "",
    r.poNumber ?? "",
    r.orderDate,
    r.expectedDate ?? "",
    r.status,
    r.lines,
    +kgOf(r.orderedG).toFixed(3),
    +kgOf(r.dispatchedG).toFixed(3),
    +kgOf(r.inStockG).toFixed(3),
    +kgOf(r.bakiG).toFixed(3),
    r.lateDays ?? "",
  ];
}

export function orderBookFileName(day: string): string {
  return `order-book-${day.replace(/[^0-9-]+/g, "")}`;
}
