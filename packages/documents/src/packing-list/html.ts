import type { LengthUnit } from "@orrn/server/lib/length";

import { packingListModel, type PackingListModelOptions } from "./rows";
import type { PackingListSnapshot } from "./types";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const kgText = (kg: number, digits = 2) =>
  new Intl.NumberFormat("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(kg);
const num = (v: number | null, digits?: number) =>
  v === null ? "" : digits === undefined ? String(v) : v.toFixed(digits);
const bundlesText = (n: number) => `${n} ${n === 1 ? "bundle" : "bundles"}`;

/**
 * The packing list as an HTML page for expo-print on native: the same header,
 * columns, groups and totals as the web view, the PDF and the Excel sheet
 * (all built by `packingListModel`). `lengthUnit` is accepted for older
 * callers and ignored: the plant's PL always shows feet and inches.
 */
export function buildPackingListHtml(
  pl: PackingListSnapshot,
  code: string,
  _lengthUnit?: LengthUnit,
  opts: PackingListModelOptions = {},
): string {
  const { header, groups, totals } = packingListModel(pl, opts);
  const meta = [
    ["PL no", code],
    ["Dispatch", header.dispatchCode],
    ["Customer", header.customerName],
    ...(header.customerTaxId ? [["GSTIN", header.customerTaxId]] : []),
    ["Date", header.date ?? ""],
    ["Ship date", header.shipDate ?? ""],
  ];

  const body = groups
    .map((g) => {
      const head = `<tr class="group"><td colspan="9">${escapeHtml(g.labelled ? `${g.label}: ${g.dieLabel}` : g.label)}</td></tr>`;
      const rows = g.rows
        .map(
          (r) => `<tr>
        <td class="n">${r.sr}</td>
        <td>${escapeHtml(r.bundleNo)}</td>
        <td>${escapeHtml(r.item)}</td>
        <td class="n">${kgText(r.weightKg)}</td>
        <td class="n">${num(r.cutLengthFt)}</td>
        <td class="n">${num(r.cutLengthIn)}</td>
        <td class="n">${r.pcs}</td>
        <td class="n">${num(r.kgPer12ft, 3)}</td>
        <td class="n">${num(r.weightRange12ft, 1)}</td>
      </tr>`,
        )
        .join("");
      const sub = `<tr class="sub"><td></td><td>${bundlesText(g.bundles)}</td><td>Total ${escapeHtml(g.label)}</td><td class="n">${kgText(g.weightKg)}</td><td></td><td></td><td class="n">${g.pieces}</td><td></td><td></td></tr>`;
      return head + rows + sub;
    })
    .join("");

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(code)}</title>
  <style>
    body { font-family: Helvetica, Arial, sans-serif; font-size: 11px; color: #111; padding: 28px; }
    h1 { font-size: 18px; margin: 0; }
    h2 { font-size: 12px; color: #555; margin: 4px 0 0; font-weight: normal; }
    .header { display: flex; justify-content: space-between; gap: 24px; margin-bottom: 16px; }
    dl { display: grid; grid-template-columns: auto auto; gap: 2px 12px; margin: 0; }
    dt { color: #555; } dd { margin: 0; font-weight: bold; }
    .totals { font-size: 14px; font-weight: bold; margin: 8px 0 12px; }
    table { width: 100%; border-collapse: collapse; }
    th { background: #f3f4f6; text-align: left; font-size: 9px; color: #333; padding: 6px; border-bottom: 1px solid #d1d5db; }
    td { padding: 4px 6px; border-bottom: 1px solid #eee; font-size: 10px; }
    .n { text-align: right; font-variant-numeric: tabular-nums; }
    tr.group td { font-weight: bold; padding-top: 10px; border-bottom: 1px solid #d1d5db; }
    tr.sub td { font-weight: bold; background: #fafafa; }
    tr.grand td { font-weight: bold; font-size: 12px; border-top: 2px solid #111; }
    .notes { margin: 0 0 12px; }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1>${escapeHtml(header.companyName)}</h1>
      <h2>Packing list</h2>
    </div>
    <dl>${meta.map(([k, v]) => `<dt>${escapeHtml(k ?? "")}</dt><dd>${escapeHtml(v ?? "")}</dd>`).join("")}</dl>
  </div>
  <p class="totals">${bundlesText(totals.bundles)} · ${kgText(totals.weightKg)} kg</p>
  ${header.notes ? `<p class="notes">${escapeHtml(header.notes)}</p>` : ""}
  <table>
    <thead>
      <tr>
        <th>Sr</th><th>Bundle no</th><th>Item</th>
        <th class="n">Weight kg</th><th class="n">Cut length ft</th><th class="n">Cut length in</th>
        <th class="n">Pcs</th><th class="n">kg/12ft</th><th class="n">Weight range /12'</th>
      </tr>
    </thead>
    <tbody>${body}
      <tr class="grand"><td></td><td>${bundlesText(totals.bundles)}</td><td>Total</td><td class="n">${kgText(totals.weightKg)}</td><td></td><td></td><td class="n">${totals.pieces}</td><td></td><td></td></tr>
    </tbody>
  </table>
</body>
</html>`;
}
