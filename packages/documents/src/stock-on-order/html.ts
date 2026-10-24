import { STOCK_ON_ORDER_COLUMNS, stockOnOrderCells, type StockOnOrderModel } from "./model";

const esc = (v: string | number) =>
  String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const kg = (v: number) => new Intl.NumberFormat("en-IN", { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(v);
const bundles = (n: number) => `${n} ${n === 1 ? "bundle" : "bundles"}`;
const NUMERIC = new Set([3, 4, 5, 6]);

/** The print page: header, one table per order line, a total and the baki strip. English, like the plant's paper lists. */
export function buildStockOnOrderHtml(model: StockOnOrderModel): string {
  const h = model.header;
  const head = STOCK_ON_ORDER_COLUMNS.map((c, i) => `<th${NUMERIC.has(i) ? ' class="n"' : ""}>${esc(c)}</th>`).join("");
  const body = model.groups
    .map((g) => {
      const rows = g.rows
        .map((r) => `<tr>${stockOnOrderCells(r).map((c, i) => `<td${NUMERIC.has(i) ? ' class="n"' : ""}>${esc(c)}</td>`).join("")}</tr>`)
        .join("");
      return `<tr class="group"><td colspan="9">${esc(g.title)} · ordered ${kg(g.orderedKg)} kg</td></tr>${rows}<tr class="sub"><td>${bundles(g.bundles)}</td><td colspan="4"></td><td class="n">${g.pcs}</td><td class="n">${kg(g.weightKg)}</td><td colspan="2"></td></tr>`;
    })
    .join("");
  const empty = model.groups.length === 0 ? `<p class="muted">No stock is held on this order.</p>` : "";
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Stock on ${esc(h.orderNumber)}</title>
  <style>
    @page { size: A4 landscape; margin: 12mm; }
    body { font-family: Helvetica, Arial, sans-serif; font-size: 10px; color: #111; margin: 0; }
    h1 { font-size: 16px; margin: 0; }
    .muted { color: #555; }
    .top { display: flex; justify-content: space-between; gap: 16px; border-bottom: 2px solid #111; padding-bottom: 8px; margin-bottom: 10px; }
    dl { display: grid; grid-template-columns: auto auto; gap: 2px 12px; margin: 0; }
    dt { color: #555; } dd { margin: 0; font-weight: bold; }
    table { width: 100%; border-collapse: collapse; }
    th { background: #f3f4f6; text-align: left; font-size: 8px; color: #333; padding: 4px; border: 1px solid #ddd; }
    td { padding: 3px 4px; border-bottom: 1px solid #eee; font-size: 9px; }
    .n { text-align: right; font-variant-numeric: tabular-nums; }
    tr.group td { background: #fafafa; font-weight: bold; border-top: 1px solid #ccc; }
    tr.sub td { font-weight: bold; border-bottom: 1px solid #ccc; }
    .total { margin-top: 10px; font-size: 13px; font-weight: bold; text-align: right; }
    .strip { margin-top: 8px; display: flex; gap: 18px; justify-content: flex-end; }
    .foot { margin-top: 14px; font-size: 8px; color: #777; }
  </style>
</head>
<body>
  <div class="top">
    <div>
      <h1>${esc(h.companyName || "Stock held on a sales order")}</h1>
      <div class="muted">Stock held on this order</div>
    </div>
    <dl>
      <dt>Order</dt><dd>${esc(h.orderNumber)}</dd>
      <dt>Customer</dt><dd>${esc(h.customerName)}</dd>
      <dt>PO</dt><dd>${esc(h.poNumber ?? "")}</dd>
      <dt>Order date</dt><dd>${esc(h.orderDate)}</dd>
      ${h.expectedDate ? `<dt>Expected by</dt><dd>${esc(h.expectedDate)}</dd>` : ""}
    </dl>
  </div>
  ${empty}
  ${model.groups.length > 0 ? `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>` : ""}
  <p class="total">${bundles(model.totals.bundles)} · ${model.totals.pcs} pcs · ${kg(model.totals.weightKg)} kg</p>
  <div class="strip">
    <span>Ordered <strong>${kg(model.strip.orderedKg)} kg</strong></span>
    <span>Dispatched <strong>${kg(model.strip.dispatchedKg)} kg</strong></span>
    <span>In stock <strong>${kg(model.strip.inStockKg)} kg</strong></span>
    <span>Baki <strong>${kg(model.strip.bakiKg)} kg</strong></span>
  </div>
  ${model.groups.some((g) => g.rows.some((r) => r.onDispatch)) ? `<p class="foot">* on a dispatch that is not complete yet; it still lies in the yard.</p>` : ""}
  ${model.truncated ? `<p class="foot">The list was cut at the first bundles; open the order for the rest.</p>` : ""}
</body>
</html>`;
}
