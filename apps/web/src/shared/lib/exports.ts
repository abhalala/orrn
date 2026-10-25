/**
 * The only door to heavy export code. `@react-pdf/renderer` (~1.4 MB) and the
 * xlsx writer load via `await import()` when a user clicks Download, never as
 * part of an initial or route chunk (W3). Import these functions, not
 * `packingListPdf` or `@orrn/documents/packing-list` directly. Pass the
 * snapshot already parsed by `parsePackingListSnapshot` (W17).
 */
import type { PackingListSnapshot } from "@orrn/documents/packing-list/model";

export type { PackingListSnapshot };

export type ExportOptions = { timeZone?: string; /** FP-PK-13: the optional kg-per-piece column. */ kgPerPiece?: boolean };

export async function downloadPackingListPdf(pl: PackingListSnapshot, code: string, opts: ExportOptions = {}) {
  const { downloadPackingListPdf: run } = await import("./packingListPdf");
  await run(pl, code, opts);
}

export async function downloadPackingListXlsx(pl: PackingListSnapshot, code: string, opts: ExportOptions = {}) {
  const { buildPackingListXlsxBuffer, plFileName } = await import("@orrn/documents/packing-list");
  const buffer = buildPackingListXlsxBuffer(pl, code, undefined, opts);
  const blob = new Blob([new Uint8Array(buffer)], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${plFileName(code)}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Print the packing list from the browser: the same HTML the native print uses, in a hidden frame so
 * no popup is needed. The HTML builder loads on click like the other exports.
 */
export async function printPackingList(pl: PackingListSnapshot, code: string, opts: ExportOptions = {}) {
  const { buildPackingListHtml } = await import("@orrn/documents/packing-list");
  const html = buildPackingListHtml(pl, code, undefined, opts);
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  document.body.appendChild(frame);
  const done = new Promise<void>((resolve) => {
    frame.onload = () => {
      try {
        frame.contentWindow?.focus();
        frame.contentWindow?.print();
      } finally {
        // The print dialog is modal in most browsers; remove the frame once it is gone.
        setTimeout(() => {
          frame.remove();
          resolve();
        }, 1000);
      }
    };
  });
  frame.srcdoc = html;
  await done;
}

export type { StockOnOrderInput } from "@orrn/documents/stock-on-order/model";

export async function downloadStockOnOrderPdf(data: import("@orrn/documents/stock-on-order/model").StockOnOrderInput, opts: ExportOptions = {}) {
  const { downloadStockOnOrderPdf: run } = await import("./stockOnOrderPdf");
  await run(data, opts);
}

export async function downloadStockOnOrderXlsx(data: import("@orrn/documents/stock-on-order/model").StockOnOrderInput, opts: ExportOptions = {}) {
  const { buildStockOnOrderXlsxBuffer, stockOnOrderFileName, stockOnOrderModel } = await import("@orrn/documents/stock-on-order");
  const model = stockOnOrderModel(data, opts);
  const buffer = buildStockOnOrderXlsxBuffer(model);
  const blob = new Blob([new Uint8Array(buffer)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${stockOnOrderFileName(model.header.orderNumber)}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Print the list: the HTML page in a hidden frame, then the browser's print dialog. */
export async function printStockOnOrder(data: import("@orrn/documents/stock-on-order/model").StockOnOrderInput, opts: ExportOptions = {}) {
  const { buildStockOnOrderHtml, stockOnOrderModel } = await import("@orrn/documents/stock-on-order/model");
  const html = buildStockOnOrderHtml(stockOnOrderModel(data, opts));
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  if (!doc || !frame.contentWindow) {
    frame.remove();
    throw new Error("print frame unavailable");
  }
  doc.open();
  doc.write(html);
  doc.close();
  const win = frame.contentWindow;
  win.addEventListener("afterprint", () => frame.remove(), { once: true });
  // Some browsers never fire afterprint on a hidden frame.
  setTimeout(() => frame.remove(), 60_000);
  win.focus();
  win.print();
}

// FP-OP-19 (W4-NEXTROWS): the order sheet, the plan's shift die list and the order book. Same rules
// as above: the document builders load on click, never with a route chunk.

export type { OrderBookExportRow, OrderSheetInput, PlanSheetInput } from "@orrn/documents/order-sheet/model";

function saveXlsx(buffer: Uint8Array, fileName: string) {
  const blob = new Blob([new Uint8Array(buffer)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${fileName}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** An HTML page in a hidden frame, then the browser's print dialog. */
function printHtml(html: string) {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  if (!doc || !frame.contentWindow) {
    frame.remove();
    throw new Error("print frame unavailable");
  }
  doc.open();
  doc.write(html);
  doc.close();
  const win = frame.contentWindow;
  win.addEventListener("afterprint", () => frame.remove(), { once: true });
  setTimeout(() => frame.remove(), 60_000);
  win.focus();
  win.print();
}

export async function printOrderSheet(data: import("@orrn/documents/order-sheet/model").OrderSheetInput) {
  const { buildOrderSheetHtml, orderSheetModel } = await import("@orrn/documents/order-sheet/model");
  printHtml(buildOrderSheetHtml(orderSheetModel(data)));
}

export async function downloadOrderSheetXlsx(data: import("@orrn/documents/order-sheet/model").OrderSheetInput) {
  const { buildOrderSheetXlsxBuffer, orderSheetFileName, orderSheetModel } = await import("@orrn/documents/order-sheet");
  saveXlsx(buildOrderSheetXlsxBuffer(orderSheetModel(data)), orderSheetFileName(data.order.number));
}

export async function printPlanSheet(data: import("@orrn/documents/order-sheet/model").PlanSheetInput, opts: ExportOptions = {}) {
  const { buildPlanSheetHtml, planSheetModel } = await import("@orrn/documents/order-sheet/model");
  printHtml(buildPlanSheetHtml(planSheetModel(data, opts)));
}

export async function downloadPlanSheetXlsx(data: import("@orrn/documents/order-sheet/model").PlanSheetInput, opts: ExportOptions = {}) {
  const { buildPlanSheetXlsxBuffer, planSheetFileName, planSheetModel } = await import("@orrn/documents/order-sheet");
  saveXlsx(buildPlanSheetXlsxBuffer(planSheetModel(data, opts)), planSheetFileName(data.plan.number));
}

export async function downloadOrderBookXlsx(rows: readonly import("@orrn/documents/order-sheet/model").OrderBookExportRow[], day: string) {
  const { buildOrderBookXlsxBuffer, orderBookFileName } = await import("@orrn/documents/order-sheet");
  saveXlsx(buildOrderBookXlsxBuffer(rows), orderBookFileName(day));
}
