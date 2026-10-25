import * as XLSX from "xlsx";

import { STOCK_ON_ORDER_COLUMNS, type StockOnOrderModel } from "./model";

type Cell = string | number | null;

/** One sheet: header block, the bundles by line with subtotals, the total, the baki strip. No rates. */
function workbook(model: StockOnOrderModel) {
  const h = model.header;
  const aoa: Cell[][] = [
    ["Stock held on this order"],
    ["Order", h.orderNumber],
    ["Customer", h.customerName],
    ["PO", h.poNumber ?? ""],
    ["Order date", h.orderDate],
    ["Expected by", h.expectedDate ?? ""],
    [],
    [...STOCK_ON_ORDER_COLUMNS],
  ];
  for (const g of model.groups) {
    aoa.push([g.title]);
    for (const r of g.rows) {
      aoa.push([r.bundleNo, r.die, r.copy, r.cutLengthFt, r.cutLengthIn, r.pcs, +r.weightKg.toFixed(3), r.yard, r.packedOn]);
    }
    aoa.push([`${g.bundles} ${g.bundles === 1 ? "bundle" : "bundles"}`, null, null, null, null, g.pcs, +g.weightKg.toFixed(3)]);
  }
  aoa.push([]);
  aoa.push([`${model.truncated ? "Partial total (bundles listed only)" : "Total"} ${model.totals.bundles} ${model.totals.bundles === 1 ? "bundle" : "bundles"}`, null, null, null, null, model.totals.pcs, +model.totals.weightKg.toFixed(3)]);
  aoa.push([]);
  aoa.push(["Ordered kg", +model.strip.orderedKg.toFixed(3)]);
  aoa.push(["Dispatched kg", +model.strip.dispatchedKg.toFixed(3)]);
  aoa.push(["In stock kg", +model.strip.inStockKg.toFixed(3)]);
  aoa.push(["Baki kg", +model.strip.bakiKg.toFixed(3)]);
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 18 }, { wch: 22 }, { wch: 12 }, { wch: 8 }, { wch: 8 }, { wch: 7 }, { wch: 11 }, { wch: 14 }, { wch: 12 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Stock on order");
  return wb;
}

export function buildStockOnOrderXlsxBuffer(model: StockOnOrderModel): Uint8Array {
  const arrayBuffer = XLSX.write(workbook(model), { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return new Uint8Array(arrayBuffer);
}
