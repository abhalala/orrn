import type { LengthUnit } from "@orrn/server/lib/length";
import { formatLengthValue } from "@orrn/server/lib/length";

import type { PLSnapshot } from "./snapshot";
import { groupPlItems } from "./group";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** HTML document for expo-print / browser print-to-PDF on native. */
export function buildPackingListHtml(
  pl: PLSnapshot,
  code: string,
  lengthUnit: LengthUnit = "mm",
  options: { draft?: boolean } = {},
): string {
  const shipDate = pl.dispatch.shipDate
    ? new Date(pl.dispatch.shipDate).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "—";
  const genDate = new Date(pl.generatedAt).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const cust = pl.dispatch.customer;
  const lenHeader = lengthUnit === "inch" ? "Len (in)" : "Len (mm)";

  const itemRow = (item: PLSnapshot["items"][number], i: number) => `
    <tr style="background:${i % 2 === 0 ? "#fff" : "#fafafa"}">
      <td>${escapeHtml(item.bundleSerial)}</td>
      <td>${escapeHtml(`${item.die.series} / ${item.die.sectionCode}`)}</td>
      <td>${escapeHtml((item.groupLabel ?? item.groupId) || "—")}</td>
      <td style="text-align:right">${item.quantity}</td>
      <td style="text-align:right">${(item.weightG / 1000).toFixed(3)}</td>
      <td style="text-align:right">${formatLengthValue(item.lengthMm, lengthUnit)}</td>
    </tr>`;
  const rows = pl.schemaVersion === 2
    ? (() => {
        const grouped = groupPlItems(pl.items, pl.groups);
        let index = 0;
        return `${grouped.groups.map((group) => `
          <tr class="group-header"><td colspan="6">${escapeHtml(group.label)}</td></tr>
          ${group.items.map((item) => itemRow(item, index++)).join("")}
          <tr class="subtotal"><td colspan="6">${escapeHtml(group.label)} — ${group.subtotal.bundles} BUNDLE / ${group.subtotal.weightKg.toFixed(3)} kg</td></tr>`).join("")}
          <tr class="net"><td colspan="3">NET</td><td style="text-align:right">${grouped.net.quantity}</td><td style="text-align:right">${grouped.net.weightKg.toFixed(3)} kg</td><td></td></tr>`;
      })()
    : pl.items
    .map(
      (item, i) => itemRow(item, i),
    )
    .join("");

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${options.draft ? "DRAFT · " : ""}${escapeHtml(code)}</title>
  <style>
    body { font-family: Helvetica, Arial, sans-serif; font-size: 11px; color: #111; padding: 28px; }
    h1 { font-size: 18px; margin: 0; }
    h2 { font-size: 12px; color: #555; margin: 4px 0 0; font-weight: normal; }
    .header { display: flex; justify-content: space-between; margin-bottom: 16px; }
    .meta { margin-bottom: 12px; }
    .label { font-size: 9px; color: #666; text-transform: uppercase; margin-bottom: 2px; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    th { background: #f3f4f6; text-align: left; font-size: 9px; color: #555; padding: 6px; border: 1px solid #e5e7eb; }
    td { padding: 5px 6px; border-bottom: 1px solid #f3f4f6; font-size: 10px; }
    .totals { display: flex; gap: 24px; justify-content: flex-end; margin-top: 12px; }
    .totals div { text-align: right; }
    .totals span { display: block; font-size: 9px; color: #555; }
    .totals strong { font-size: 12px; }
    .footer { margin-top: 24px; font-size: 8px; color: #aaa; text-align: center; }
    .notes { background: #fafafa; border: 1px solid #e5e7eb; padding: 8px; border-radius: 4px; }
    .draft { color: #b91c1c; font-size: 24px; font-weight: bold; letter-spacing: 5px; }
    .group-header td { background: #e5e7eb; font-weight: bold; border-top: 2px solid #9ca3af; }
    .subtotal td { font-weight: bold; text-align: right; background: #f3f4f6; }
    .net td { background: #FFF3BF; font-weight: bold; border-top: 2px solid #111; }
  </style>
</head>
<body>
  ${options.draft ? '<div class="draft">DRAFT</div>' : ""}
  <div class="header">
    <div>
      <h1>${escapeHtml(pl.company.name)}</h1>
      <h2>Packing List</h2>
    </div>
    <div style="text-align:right">
      <h1>${escapeHtml(code)}</h1>
      <h2>Dispatch: ${escapeHtml(pl.dispatch.code)}</h2>
      <h2>Generated: ${escapeHtml(genDate)}</h2>
    </div>
  </div>
  <div class="meta">
    <div class="label">Customer</div>
    <div><strong>${escapeHtml(cust.name)}</strong></div>
    ${cust.phone ? `<div>${escapeHtml(cust.phone)}</div>` : ""}
    ${cust.email ? `<div>${escapeHtml(cust.email)}</div>` : ""}
    ${cust.taxId ? `<div>Tax ID: ${escapeHtml(cust.taxId)}</div>` : ""}
    <div class="label" style="margin-top:8px">Ship Date</div>
    <div>${escapeHtml(shipDate)}</div>
  </div>
  ${
    pl.dispatch.notes
      ? `<div class="meta"><div class="label">Notes</div><div class="notes">${escapeHtml(pl.dispatch.notes)}</div></div>`
      : ""
  }
  <table>
    <thead>
      <tr>
        <th>Serial</th><th>Die</th><th>Group</th>
        <th style="text-align:right">Qty</th>
        <th style="text-align:right">Wt (kg)</th>
        <th style="text-align:right">${lenHeader}</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  ${pl.schemaVersion === 2 ? "" : `
  <div class="totals">
    <div><span>Bundles</span><strong>${pl.totals.totalBundles}</strong></div>
    <div><span>Total Qty</span><strong>${pl.totals.totalQuantity}</strong></div>
    <div><span>Total Wt</span><strong>${pl.totals.totalWeightKg} kg</strong></div>
    <div><span>Total Len</span><strong>${formatLengthValue(pl.totals.totalLengthM * 1000, lengthUnit)} ${lengthUnit === "inch" ? "in" : "mm"}</strong></div>
  </div>
  `}
  <div class="footer">${escapeHtml(pl.company.name)} · ${escapeHtml(code)} · System-generated document.</div>
</body>
</html>`;
}
