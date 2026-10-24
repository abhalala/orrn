import type { LengthUnit } from "@orrn/server/lib/length";
import { formatLengthValue } from "@orrn/server/lib/length";

import {
  bundlesText,
  formatPlKg,
  isPlSnapshotV2,
  PL_COLUMN_HEADINGS,
  plGroupTitle,
  plRowCells,
  plShipDateText,
  type PLSnapshot,
} from "./snapshot";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function ddMmmYyyy(ymd: string | null | undefined): string {
  if (!ymd) return "—";
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

const NUMERIC_COLUMNS = new Set([0, 4, 5, 6, 7, 8, 9]);

/** v2: the plant's PL — letterhead, bill-to / ship-to, transport, refs, 11 columns grouped by order line. */
function buildPackingListHtmlV2(pl: PLSnapshot & { header: NonNullable<PLSnapshot["header"]>; groups: NonNullable<PLSnapshot["groups"]>; summary: NonNullable<PLSnapshot["summary"]> }): string {
  const h = pl.header;
  const e = (v: string | null | undefined) => escapeHtml(v ?? "");
  const party = (label: string, p: { name: string; gstin: string | null; address: string | null }) => `
    <div class="box">
      <div class="label">${label}</div>
      <div><strong>${e(p.name)}</strong></div>
      ${p.address ? `<div>${e(p.address)}</div>` : ""}
      ${p.gstin ? `<div>GSTIN ${e(p.gstin)}</div>` : ""}
    </div>`;
  const shipDate = plShipDateText(pl.dispatch.shipDate, pl.header?.shipDate);
  const head = PL_COLUMN_HEADINGS.map((c, i) => `<th${NUMERIC_COLUMNS.has(i) ? ' class="num"' : ""}>${escapeHtml(c)}</th>`).join("");
  const body = pl.groups
    .map((g) => {
      const rows = g.rows
        .map(
          (r) =>
            `<tr>${plRowCells(r)
              .map((c, i) => `<td${NUMERIC_COLUMNS.has(i) ? ' class="num"' : ""}>${escapeHtml(c)}</td>`)
              .join("")}</tr>`,
        )
        .join("");
      return `
      <tr class="group"><td colspan="11">${escapeHtml(plGroupTitle(g, pl.groups))}</td></tr>
      ${rows}
      <tr class="sub"><td colspan="4">${bundlesText(g.subtotal.bundles)}</td><td class="num">${formatPlKg(g.subtotal.weightG)}</td><td></td><td></td><td class="num">${g.subtotal.pcs}</td><td colspan="3"></td></tr>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${e(h.plNumber)}</title>
  <style>
    body { font-family: Helvetica, Arial, sans-serif; font-size: 10px; color: #111; padding: 24px; }
    h1 { font-size: 16px; margin: 0; }
    .muted { color: #555; }
    .top { display: flex; justify-content: space-between; gap: 16px; border-bottom: 2px solid #111; padding-bottom: 8px; }
    .doc { text-align: right; }
    .doc .title { font-size: 14px; font-weight: bold; letter-spacing: 1px; }
    .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 10px 0; }
    .box { border: 1px solid #ddd; padding: 6px; }
    .label { font-size: 8px; color: #666; text-transform: uppercase; margin-bottom: 2px; }
    table { width: 100%; border-collapse: collapse; }
    th { background: #f3f4f6; text-align: left; font-size: 8px; color: #333; padding: 4px; border: 1px solid #ddd; }
    td { padding: 3px 4px; border-bottom: 1px solid #eee; font-size: 9px; }
    .num { text-align: right; font-variant-numeric: tabular-nums; }
    tr.group td { background: #fafafa; font-weight: bold; border-top: 1px solid #ccc; }
    tr.sub td { font-weight: bold; border-bottom: 1px solid #ccc; }
    .notes { border: 1px solid #ddd; padding: 6px; margin-bottom: 10px; white-space: pre-wrap; }
    .total { margin-top: 10px; text-align: right; font-size: 13px; font-weight: bold; }
    .footer { margin-top: 18px; font-size: 8px; color: #999; display: flex; justify-content: space-between; }
  </style>
</head>
<body>
  <div class="top">
    <div>
      <h1>${e(h.company.legalName ?? h.company.name)}</h1>
      ${h.company.address ? `<div>${e(h.company.address)}</div>` : ""}
      ${h.company.gstin ? `<div>GSTIN ${e(h.company.gstin)}</div>` : ""}
      ${h.company.phone ? `<div class="muted">${e(h.company.phone)}</div>` : ""}
    </div>
    <div class="doc">
      <div class="title">PACKING LIST</div>
      <div><strong>${e(h.plNumber)}</strong></div>
      <div>${escapeHtml(ddMmmYyyy(h.date))}</div>
      <div class="muted">Dispatch ${e(h.dispatchCode)}</div>
    </div>
  </div>
  <div class="grid">
    ${party("Bill to", h.billTo)}
    ${party("Ship to", h.shipTo)}
    <div class="box">
      <div class="label">Transport</div>
      <div>Vehicle <strong>${e(h.vehicleNo ?? "—")}</strong></div>
      ${h.driverName || h.driverPhone ? `<div>Driver ${e([h.driverName, h.driverPhone].filter(Boolean).join(" · "))}</div>` : ""}
      ${h.transporter ? `<div>${e(h.transporter)}</div>` : ""}
    </div>
    <div class="box">
      <div class="label">References</div>
      <div>PO ${e(h.poNumbers.length ? h.poNumbers.join(", ") : "—")}</div>
      <div>Invoice ${e(h.invoiceNumber ?? "—")}${h.invoiceDate ? ` · ${escapeHtml(ddMmmYyyy(h.invoiceDate))}` : ""}</div>
      ${shipDate ? `<div>Ship date ${e(shipDate)}</div>` : ""}
    </div>
  </div>
  ${pl.dispatch.notes ? `<div class="notes"><span class="label">Notes</span> ${e(pl.dispatch.notes)}</div>` : ""}
  <table>
    <thead><tr>${head}</tr></thead>
    <tbody>${body}</tbody>
  </table>
  <div class="total">${escapeHtml(pl.summary.text)}</div>
  <div class="footer"><span>${e(h.company.name)} · ${e(h.plNumber)}</span><span>Receiver's signature ____________________</span></div>
</body>
</html>`;
}

/** HTML document for expo-print / browser print-to-PDF on native. */
export function buildPackingListHtml(
  pl: PLSnapshot,
  code: string,
  lengthUnit: LengthUnit = "mm",
): string {
  if (isPlSnapshotV2(pl)) return buildPackingListHtmlV2(pl);
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

  const rows = pl.items
    .map(
      (item, i) => `
    <tr style="background:${i % 2 === 0 ? "#fff" : "#fafafa"}">
      <td>${escapeHtml(item.bundleSerial)}</td>
      <td>${escapeHtml(`${item.die.series} / ${item.die.sectionCode}`)}</td>
      <td>${escapeHtml(item.groupId || "—")}</td>
      <td style="text-align:right">${item.quantity}</td>
      <td style="text-align:right">${(item.weightG / 1000).toFixed(3)}</td>
      <td style="text-align:right">${formatLengthValue(item.lengthMm, lengthUnit)}</td>
    </tr>`,
    )
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
  </style>
</head>
<body>
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
  <div class="totals">
    <div><span>Bundles</span><strong>${pl.totals.totalBundles}</strong></div>
    <div><span>Total Qty</span><strong>${pl.totals.totalQuantity}</strong></div>
    <div><span>Total Wt</span><strong>${pl.totals.totalWeightKg} kg</strong></div>
    <div><span>Total Len</span><strong>${formatLengthValue(pl.totals.totalLengthM * 1000, lengthUnit)} ${lengthUnit === "inch" ? "in" : "mm"}</strong></div>
  </div>
  <div class="footer">${escapeHtml(pl.company.name)} · ${escapeHtml(code)} · System-generated document.</div>
</body>
</html>`;
}
