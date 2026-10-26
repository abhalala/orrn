import * as XLSX from "xlsx";

import {
  ORDER_BOOK_COLUMNS,
  orderBookCells,
  orderSheetCells,
  orderSheetColumns,
  PLAN_SHEET_COLUMNS,
  type OrderBookExportRow,
  type OrderSheetModel,
  type PlanSheetModel,
} from "./model";

type Cell = string | number | null;

function toBuffer(sheetName: string, aoa: Cell[][], cols: number[]): Uint8Array {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = cols.map((wch) => ({ wch }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
}

/** The order sheet: header block, one row per line, totals. Rate column only with rates. */
export function buildOrderSheetXlsxBuffer(model: OrderSheetModel): Uint8Array {
  const h = model.header;
  const aoa: Cell[][] = [
    ["Sales order"],
    ["Order", h.number],
    ["Customer", h.customerName],
    ["PO", h.poNumber ?? ""],
    ["Order date", h.orderDate],
    ["Expected by", h.expectedDate ?? ""],
    ["Status", h.status],
    [],
    orderSheetColumns(model),
    ...model.rows.map((r) => orderSheetCells(r, model.showRate)),
    ["Total", null, null, null, null, null, null, model.totals.pcs || null, +model.totals.orderedKg.toFixed(3), +model.totals.dispatchedKg.toFixed(3), +model.totals.bakiKg.toFixed(3)],
  ];
  return toBuffer("Order", aoa, [6, 22, 16, 7, 7, 10, 10, 8, 12, 13, 11, 11]);
}

/** The shift die list: per die, its lines and a die total. No rate. */
export function buildPlanSheetXlsxBuffer(model: PlanSheetModel): Uint8Array {
  const h = model.header;
  const aoa: Cell[][] = [["Shift die list"], ["Plan", h.number], ["Press", h.pressLine ?? ""], ["Window", h.window], []];
  for (const d of model.dies) {
    aoa.push([d.urgent ? `${d.title} (urgent)` : d.title]);
    aoa.push([...PLAN_SHEET_COLUMNS]);
    for (const r of d.rows) aoa.push([r.party, r.order, r.po, r.cutLengthFt, r.cutLengthIn, r.pcs, +r.kg.toFixed(3)]);
    aoa.push(["Die total", null, null, null, null, d.pcs || null, +d.kg.toFixed(3)]);
    aoa.push([]);
  }
  return toBuffer("Plan", aoa, [24, 14, 16, 7, 7, 8, 11]);
}

/** The order book: one row per order of the filter. No rate. */
export function buildOrderBookXlsxBuffer(rows: readonly OrderBookExportRow[]): Uint8Array {
  return toBuffer("Order book", [[...ORDER_BOOK_COLUMNS], ...rows.map(orderBookCells)], [10, 24, 12, 16, 11, 11, 11, 6, 12, 13, 12, 11, 9]);
}
