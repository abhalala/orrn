import type { LengthUnit } from "@orrn/server/lib/length";

import { packingListModel, type PackingListModelOptions } from "./rows";
import {
  formatPlKg,
  isPlSnapshotV2,
  PL_COLUMN_HEADINGS,
  plGroupTitle,
  plRowCells,
  plExtraColumns,
  plKgPerPiece,
  plProfileLines,
  plRevisionText,
  plRowExtras,
  plDispatchCodesText,
  plSectionSubtotalAfter,
  plShipDateText,
  type PlSnapshotV2,
} from "./snapshot";
import type { PackingListSnapshot } from "./types";

/** A parsed snapshot that also carries the PL-8 v2 blocks (header, groups, summary). */
type V2Snapshot = PackingListSnapshot & { header: PlSnapshotV2["header"]; groups: PlSnapshotV2["groups"]; summary: PlSnapshotV2["summary"] };

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
function buildPackingListHtmlV2(pl: V2Snapshot, opts: PackingListModelOptions = {}): string {
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
  // FP-PK-13: optional Party no / Original SO columns, section subtotals, profile-kind summary.
  const extra = plExtraColumns(pl);
  const extraHeads = [...(extra.partyNo ? ["Party no"] : []), ...(extra.originalSo ? ["Original SO"] : []), ...(opts.kgPerPiece ? ["kg/pc"] : [])];
  const span = 11 + extraHeads.length;
  const tail = span - 8;
  const head = [
    ...PL_COLUMN_HEADINGS.map((c, i) => `<th${NUMERIC_COLUMNS.has(i) ? ' class="num"' : ""}>${escapeHtml(c)}</th>`),
    ...extraHeads.map((c) => `<th>${escapeHtml(c)}</th>`),
  ].join("");
  const sectionAfter = plSectionSubtotalAfter(pl);
  const body = pl.groups
    .map((g, gi) => {
      const rows = g.rows
        .map((r) => {
          const cells = [
            ...plRowCells(r),
            ...(extra.partyNo ? [plRowExtras(pl, r).partyNo] : []),
            ...(extra.originalSo ? [plRowExtras(pl, r).originalSo] : []),
            ...(opts.kgPerPiece ? [plKgPerPiece(r)] : []),
          ];
          return `<tr>${cells.map((c, i) => `<td${NUMERIC_COLUMNS.has(i) ? ' class="num"' : ""}>${escapeHtml(c)}</td>`).join("")}</tr>`;
        })
        .join("");
      const sec = sectionAfter.get(gi);
      return `
      <tr class="group"><td colspan="${span}">${escapeHtml(plGroupTitle(g, pl.groups))}</td></tr>
      ${rows}
      <tr class="sub"><td colspan="4">${bundlesText(g.subtotal.bundles)}</td><td class="num">${formatPlKg(g.subtotal.weightG)}</td><td></td><td></td><td class="num">${g.subtotal.pcs}</td><td colspan="${tail}"></td></tr>${
        sec
          ? `
      <tr class="sub"><td colspan="4">${escapeHtml(`Section ${sec.sectionCode}`)} · ${bundlesText(sec.bundles)}</td><td class="num">${formatPlKg(sec.weightG)}</td><td></td><td></td><td class="num">${sec.pcs}</td><td colspan="${tail}"></td></tr>`
          : ""
      }`;
    })
    .join("");
  const brand = pl.issue?.branding;
  const profiles = plProfileLines(pl);
  const revision = plRevisionText(pl);

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
    .kinds { margin-top: 8px; display: flex; gap: 16px; justify-content: flex-end; font-size: 10px; }
    .logo { max-height: 36px; max-width: 160px; margin-bottom: 4px; }
    .footer { margin-top: 18px; font-size: 8px; color: #999; display: flex; justify-content: space-between; }
  </style>
</head>
<body>
  <div class="top">
    <div>
      ${brand?.show && brand.logoUrl ? `<img class="logo" src="${e(brand.logoUrl)}" alt="" />` : ""}
      <h1>${e(h.company.legalName ?? h.company.name)}</h1>
      ${brand?.show && brand.tagline ? `<div class="muted">${e(brand.tagline)}</div>` : ""}
      ${h.company.address ? `<div>${e(h.company.address)}</div>` : ""}
      ${h.company.gstin ? `<div>GSTIN ${e(h.company.gstin)}</div>` : ""}
      ${h.company.phone ? `<div class="muted">${e(h.company.phone)}</div>` : ""}
    </div>
    <div class="doc">
      <div class="title">PACKING LIST</div>
      <div><strong>${e(h.plNumber)}</strong>${revision ? ` · ${escapeHtml(revision)}` : ""}</div>
      <div>${escapeHtml(ddMmmYyyy(h.date))}</div>
      <div class="muted">Dispatch ${e(plDispatchCodesText(pl))}</div>
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
  ${profiles.length > 0 ? `<div class="kinds">${profiles.map((l) => `<span>${escapeHtml(l)}</span>`).join("")}</div>` : ""}
  <div class="total">${escapeHtml(pl.summary.text)}</div>
  <div class="footer"><span>${e(h.company.name)} · ${e(h.plNumber)}</span><span>Receiver's signature ____________________</span></div>
</body>
</html>`;
}

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
  if (isPlSnapshotV2(pl)) return buildPackingListHtmlV2(pl, opts);
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
