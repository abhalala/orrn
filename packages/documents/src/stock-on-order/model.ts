import { cutLength, isoDay, packingItemLabel } from "../packing-list/rows";

/**
 * "Stock held on this SO" (FP-OP-19): the order's in-yard bundles by line, as the server's
 * `orders.stockOn` answers (read from `bundle.sales_order_line_id`, never the PO text typed at pack
 * time). Built once here and shared by the print, the PDF and the Excel sheet so all three agree.
 * No rate appears anywhere: the answer carries none and a price is not part of a stock list.
 */
export type StockOnOrderInput = {
  order: {
    number: string;
    poNumber: string | null;
    orderDate: string;
    expectedDate: string | null;
    customerName: string;
    status: string;
  };
  companyName: string | null;
  lines: {
    lineNo: number;
    sectionCode: string;
    series: string;
    sectionName: string | null;
    cutLengthMm: number;
    orderedG: number;
    orderedPcs: number | null;
    pcs: number;
    weightG: number;
    bundles: {
      serial: string;
      partyNo: string | null;
      status: string;
      pcs: number;
      weightG: number;
      lengthMm: number;
      copyCode: string | null;
      yard: string | null;
      packedAt: number;
    }[];
  }[];
  total: { bundles: number; pcs: number; weightG: number };
  strip: { orderedG: number; dispatchedG: number; bakiG: number; inStockG: number };
  truncated: boolean;
};

export type StockOnOrderRow = {
  bundleNo: string;
  die: string;
  copy: string;
  cutLengthFt: number;
  cutLengthIn: number;
  pcs: number;
  weightKg: number;
  yard: string;
  packedOn: string;
  /** On a draft dispatch: it still lies in the yard. */
  onDispatch: boolean;
};

export type StockOnOrderGroup = {
  key: string;
  title: string;
  orderedKg: number;
  rows: StockOnOrderRow[];
  bundles: number;
  pcs: number;
  weightKg: number;
};

export type StockOnOrderModel = {
  header: {
    companyName: string;
    orderNumber: string;
    poNumber: string | null;
    customerName: string;
    orderDate: string;
    expectedDate: string | null;
  };
  groups: StockOnOrderGroup[];
  totals: { bundles: number; pcs: number; weightKg: number };
  strip: { orderedKg: number; dispatchedKg: number; inStockKg: number; bakiKg: number };
  truncated: boolean;
};

export function stockOnOrderModel(input: StockOnOrderInput, opts: { timeZone?: string } = {}): StockOnOrderModel {
  const timeZone = opts.timeZone ?? "Asia/Kolkata";
  const groups: StockOnOrderGroup[] = input.lines
    .filter((l) => l.bundles.length > 0)
    .map((l) => {
      const die = packingItemLabel({ sectionCode: l.sectionCode, name: l.sectionName, series: l.series });
      const length = cutLength(l.cutLengthMm);
      return {
        key: `line-${l.lineNo}`,
        title: `Line ${l.lineNo} · ${die} · ${length.ft} ft`,
        orderedKg: l.orderedG / 1000,
        rows: l.bundles.map((b) => {
          const len = cutLength(b.lengthMm);
          return {
            bundleNo: b.partyNo && b.partyNo !== b.serial ? `${b.serial} (${b.partyNo})` : b.serial,
            die,
            copy: b.copyCode ?? "",
            cutLengthFt: len.ft,
            cutLengthIn: len.inches,
            pcs: b.pcs,
            weightKg: b.weightG / 1000,
            yard: b.yard ?? "",
            packedOn: isoDay(new Date(b.packedAt).toISOString(), timeZone) ?? "",
            onDispatch: b.status === "reserved",
          };
        }),
        bundles: l.bundles.length,
        pcs: l.pcs,
        weightKg: l.weightG / 1000,
      };
    });
  return {
    header: {
      companyName: input.companyName ?? "",
      orderNumber: input.order.number,
      poNumber: input.order.poNumber,
      customerName: input.order.customerName,
      orderDate: input.order.orderDate,
      expectedDate: input.order.expectedDate,
    },
    groups,
    totals: { bundles: input.total.bundles, pcs: input.total.pcs, weightKg: input.total.weightG / 1000 },
    strip: {
      orderedKg: input.strip.orderedG / 1000,
      dispatchedKg: input.strip.dispatchedG / 1000,
      inStockKg: input.strip.inStockG / 1000,
      bakiKg: input.strip.bakiG / 1000,
    },
    truncated: input.truncated,
  };
}

export const STOCK_ON_ORDER_COLUMNS = ["Bundle no", "Die", "Copy", "Cut ft", "Cut in", "Pcs", "Weight kg", "Yard", "Packed on"] as const;

/** The row as the nine printed cells. */
export function stockOnOrderCells(r: StockOnOrderRow): (string | number)[] {
  return [r.bundleNo + (r.onDispatch ? " *" : ""), r.die, r.copy, r.cutLengthFt, r.cutLengthIn, r.pcs, r.weightKg.toFixed(3), r.yard, r.packedOn];
}

export function stockOnOrderFileName(orderNumber: string): string {
  return `stock-on-${orderNumber.replace(/[^A-Za-z0-9._-]+/g, "-")}`;
}
