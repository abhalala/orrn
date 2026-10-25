import { orderSheetCells, orderSheetColumns, PLAN_SHEET_COLUMNS, type OrderSheetModel, type PlanSheetModel } from "./model";

const esc = (v: string | number) =>
  String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const kg = (v: number) => new Intl.NumberFormat("en-IN", { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(v);
const rupees = (v: number) => new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);

const STYLE = `
    @page { size: A4 landscape; margin: 12mm; }
    body { font-family: Helvetica, Arial, sans-serif; font-size: 10px; color: #111; margin: 0; }
    h1 { font-size: 16px; margin: 0; }
    h2 { font-size: 12px; margin: 12px 0 4px; }
    .muted { color: #555; }
    .top { display: flex; justify-content: space-between; gap: 16px; border-bottom: 2px solid #111; padding-bottom: 8px; margin-bottom: 10px; }
    dl { display: grid; grid-template-columns: auto auto; gap: 2px 12px; margin: 0; }
    dt { color: #555; } dd { margin: 0; font-weight: bold; }
    table { width: 100%; border-collapse: collapse; }
    th { background: #f3f4f6; text-align: left; font-size: 8px; color: #333; padding: 4px; border: 1px solid #ddd; }
    td { padding: 3px 4px; border-bottom: 1px solid #eee; font-size: 9px; }
    .n { text-align: right; font-variant-numeric: tabular-nums; }
    tr.sub td { font-weight: bold; border-top: 1px solid #ccc; }
    .urgent { color: #b42318; font-weight: bold; }
    .foot { margin-top: 14px; font-size: 8px; color: #777; }`;

/** The sales order sheet print: header, one row per line, totals. The rate column only when the model has rates. */
export function buildOrderSheetHtml(model: OrderSheetModel): string {
  const h = model.header;
  const cols = orderSheetColumns(model);
  const numeric = new Set([0, 3, 4, 7, 8, 9, 10, 11]);
  const head = cols.map((c, i) => `<th${numeric.has(i) ? ' class="n"' : ""}>${esc(c)}</th>`).join("");
  const body = model.rows
    .map((r) => {
      const cells = orderSheetCells(r, model.showRate).map((c, i) => {
        const text = typeof c === "number" && i >= 8 && i <= 10 ? kg(c) : i === 11 && typeof c === "number" ? rupees(c) : c;
        return `<td${numeric.has(i) ? ' class="n"' : ""}>${esc(text)}</td>`;
      });
      const note = r.note ? `<tr><td></td><td colspan="${cols.length - 1}" class="muted">${esc(r.note)}</td></tr>` : "";
      return `<tr>${cells.join("")}</tr>${note}`;
    })
    .join("");
  const t = model.totals;
  const sub = `<tr class="sub"><td colspan="7">Total</td><td class="n">${t.pcs || ""}</td><td class="n">${kg(t.orderedKg)}</td><td class="n">${kg(t.dispatchedKg)}</td><td class="n">${kg(t.bakiKg)}</td>${model.showRate ? "<td></td>" : ""}</tr>`;
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Order ${esc(h.number)}</title>
  <style>${STYLE}
  </style>
</head>
<body>
  <div class="top">
    <div>
      <h1>${esc(h.companyName || "Sales order")}</h1>
      <div class="muted">Sales order</div>
    </div>
    <dl>
      <dt>Order</dt><dd>${esc(h.number)}</dd>
      <dt>Customer</dt><dd>${esc(h.customerName)}</dd>
      ${h.customerGstin ? `<dt>GSTIN</dt><dd>${esc(h.customerGstin)}</dd>` : ""}
      <dt>PO</dt><dd>${esc(h.poNumber ?? "")}</dd>
      <dt>Order date</dt><dd>${esc(h.orderDate)}</dd>
      ${h.expectedDate ? `<dt>Expected by</dt><dd>${esc(h.expectedDate)}</dd>` : ""}
      <dt>Status</dt><dd>${esc(h.status)}</dd>
    </dl>
  </div>
  <table><thead><tr>${head}</tr></thead><tbody>${body}${sub}</tbody></table>
  ${h.note ? `<p class="muted">${esc(h.note)}</p>` : ""}
  ${model.showRate ? `<p class="foot">Rates are per kg on weighed kg. This is not a tax invoice.</p>` : ""}
</body>
</html>`;
}

/** The shift die list print: one table per die, its order lines with cut length, pcs and kg. Never a rate. */
export function buildPlanSheetHtml(model: PlanSheetModel): string {
  const h = model.header;
  const numeric = new Set([3, 4, 5, 6]);
  const head = PLAN_SHEET_COLUMNS.map((c, i) => `<th${numeric.has(i) ? ' class="n"' : ""}>${esc(c)}</th>`).join("");
  const blocks = model.dies
    .map((d) => {
      const rows = d.rows
        .map(
          (r) =>
            `<tr><td>${esc(r.party)}</td><td>${esc(r.order)}</td><td>${esc(r.po)}</td><td class="n">${r.cutLengthFt}</td><td class="n">${r.cutLengthIn}</td><td class="n">${r.pcs ?? ""}</td><td class="n">${kg(r.kg)}</td></tr>`,
        )
        .join("");
      return `<h2>${esc(d.title)}${d.urgent ? ' <span class="urgent">URGENT</span>' : ""}</h2><table><thead><tr>${head}</tr></thead><tbody>${rows}<tr class="sub"><td colspan="5">Die total</td><td class="n">${d.pcs || ""}</td><td class="n">${kg(d.kg)}</td></tr></tbody></table>`;
    })
    .join("");
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Plan ${esc(h.number)}</title>
  <style>${STYLE}
  </style>
</head>
<body>
  <div class="top">
    <div>
      <h1>${esc(h.companyName || "Press plan")}</h1>
      <div class="muted">Shift die list</div>
    </div>
    <dl>
      <dt>Plan</dt><dd>${esc(h.number)}</dd>
      ${h.pressLine ? `<dt>Press</dt><dd>${esc(h.pressLine)}</dd>` : ""}
      <dt>Window</dt><dd>${esc(h.window)}</dd>
      <dt>Status</dt><dd>${esc(h.status)}</dd>
    </dl>
  </div>
  ${model.dies.length === 0 ? `<p class="muted">No dies on this plan.</p>` : blocks}
  <p class="foot">${model.totals.dies} ${model.totals.dies === 1 ? "die" : "dies"} · ${model.totals.pcs} pcs · ${kg(model.totals.kg)} kg${h.note ? ` · ${esc(h.note)}` : ""}</p>
</body>
</html>`;
}
