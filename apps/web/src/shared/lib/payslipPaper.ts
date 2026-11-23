/**
 * The payslip and the full and final statement as an A4 page: plain rows (`payslipPaperModel`,
 * `settlementPaperModel`, what the tests read) and one HTML string (`payslipHtml`, `settlementHtml`) printed from a
 * hidden frame (`printHtml`), so the browser's own fonts draw Hindi and Gujarati and the print dialog also saves a PDF
 * (the Worker never renders a PDF, and `@react-pdf` has no Devanagari or Gujarati glyphs in its built-in fonts). Every
 * label and sentence comes from `payroll.payslip.*` in the viewer's language through the `t` passed in; every figure
 * is the server's (`explain.ts`). No Intl, no clock: dates are cut from `YYYY-MM-DD`.
 */
import type { Translate } from "@orrn/i18n";
import type { SlipFigures } from "@orrn/server/lib/hr/payroll";

import { amountText, dmy, monthName, settlementView, slipView, type GratuityRates, type SettlementFigures, type SlipLine } from "@/features/payroll/explain";

export type PaperCompany = { name: string; lines?: string[] };

export type PaperTable = { heading: string; rows: { name: string; amount: string; why: string | null }[] };

export type PayslipPaper = {
  lang: string;
  title: string;
  company: PaperCompany | null;
  subtitle: string;
  facts: [string, string][];
  tables: PaperTable[];
  total: { label: string; amount: string };
  amountHeader: string;
  whyHeader: string;
  notes: string[];
  footer: string;
};

const rows = (lines: readonly SlipLine[]) => lines.map((l) => ({ name: l.name, amount: amountText(l.paise), why: l.why }));

export function payslipPaperModel(t: Translate, f: SlipFigures, lang: string, company: PaperCompany | null): PayslipPaper {
  const v = slipView(t, f);
  const p = f.person;
  const facts: [string, string][] = [
    [t("payroll.payslip.person.code"), p.code],
    [t("payroll.payslip.person.name"), p.name],
  ];
  if (p.department) facts.push([t("payroll.payslip.person.department"), p.department]);
  if (p.designation) facts.push([t("payroll.payslip.person.designation"), p.designation]);
  facts.push([t("payroll.payslip.person.joined"), dmy(p.joinedOn)]);
  if (p.uan) facts.push([t("payroll.payslip.person.uan"), p.uan]);
  if (p.esicIp) facts.push([t("payroll.payslip.person.esicIp"), p.esicIp]);
  if (p.bankMasked) facts.push([t("payroll.payslip.person.bank"), p.bankMasked]);
  facts.push([t("payroll.payslip.days.month"), String(v.monthDays)], [t("payroll.payslip.days.paid"), v.paidDays]);
  if (v.ncpDays > 0) facts.push([t("payroll.payslip.days.noPay"), String(v.ncpDays)]);
  if (v.overtime) facts.push([t("payroll.payslip.days.overtime"), v.overtime]);

  const tables: PaperTable[] = [
    { heading: t("payroll.payslip.earnings"), rows: rows(v.earnings) },
    { heading: t("payroll.payslip.deductions"), rows: rows(v.deductions) },
  ];
  if (v.employer.length > 0) tables.push({ heading: t("payroll.payslip.employer"), rows: rows(v.employer) });
  return {
    lang,
    title: t("payroll.payslip.title"),
    company,
    subtitle: t("payroll.payslip.forMonth", { month: monthName(t, f.month) }),
    facts,
    tables,
    total: { label: t("payroll.payslip.net"), amount: amountText(f.netPaise) },
    amountHeader: t("payroll.payslip.amount"),
    whyHeader: t("payroll.payslip.why"),
    notes: v.notes,
    footer: t("payroll.payslip.footer"),
  };
}

export function settlementPaperModel(t: Translate, f: SettlementFigures, rates: GratuityRates | null, lang: string, company: PaperCompany | null): PayslipPaper {
  const v = settlementView(t, f, rates);
  const facts: [string, string][] = [
    [t("payroll.payslip.person.code"), f.person.code],
    [t("payroll.payslip.person.name"), f.person.name],
    [t("payroll.payslip.fnf.joined"), dmy(f.person.joinedOn)],
    [t("payroll.payslip.fnf.left"), dmy(f.person.leftOn)],
  ];
  if (f.person.reason) facts.push([t("payroll.payslip.fnf.reason"), f.person.reason]);
  facts.push([t("payroll.payslip.fnf.service"), v.service]);
  return {
    lang,
    title: t("payroll.payslip.fnf.title"),
    company,
    subtitle: "",
    facts,
    tables: [{ heading: t("payroll.payslip.fnf.title"), rows: rows(v.lines) }],
    total: { label: t("payroll.payslip.fnf.net"), amount: amountText(v.netPaise) },
    amountHeader: t("payroll.payslip.fnf.amount"),
    whyHeader: t("payroll.payslip.why"),
    notes: [],
    footer: t("payroll.payslip.fnf.footer"),
  };
}

export const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const CSS = `
@page { size: A4 portrait; margin: 14mm; }
* { box-sizing: border-box; }
body { margin: 0; font: 11px/1.45 "Noto Sans", "Noto Sans Devanagari", "Noto Sans Gujarati", "Nirmala UI", "Mangal", "Shruti", Helvetica, Arial, sans-serif; color: #111; }
h1 { margin: 0; font-size: 18px; }
h2 { margin: 14px 0 4px; font-size: 12px; }
.sub { color: #555; }
.head { border-bottom: 1.5px solid #111; padding-bottom: 6px; margin-bottom: 8px; }
.facts { width: 100%; border-collapse: collapse; }
.facts td { padding: 2px 8px 2px 0; vertical-align: top; width: 25%; }
.facts td.k { color: #555; }
.facts td.v { font-weight: 700; }
table.lines { width: 100%; border-collapse: collapse; }
table.lines th { text-align: left; font-size: 10px; color: #555; border-bottom: 1px solid #111; padding: 3px 4px 3px 0; }
table.lines td { padding: 3px 4px 3px 0; border-bottom: 0.5px solid #d4d4d4; vertical-align: top; }
table.lines td.why { color: #555; font-size: 10px; }
.r { text-align: right; white-space: nowrap; }
.total { margin-top: 12px; padding: 8px; border: 1.5px solid #111; display: flex; justify-content: space-between; font-weight: 700; font-size: 14px; }
.notes { margin: 12px 0 0; padding-left: 16px; color: #333; }
.footer { margin-top: 18px; color: #555; font-size: 10px; }
tr { page-break-inside: avoid; }
`;

/** The A4 page of a payslip or statement as one HTML string. Everything typed by a person is escaped. */
export function paperHtml(p: PayslipPaper): string {
  const head = `<div class="head"><h1>${esc(p.company?.name ?? p.title)}</h1>${(p.company?.lines ?? []).map((l) => `<div class="sub">${esc(l)}</div>`).join("")}<div><b>${esc(p.title)}</b>${p.subtitle ? ` <span class="sub">${esc(p.subtitle)}</span>` : ""}</div></div>`;
  const pairs: string[] = [];
  for (let i = 0; i < p.facts.length; i += 2) {
    const a = p.facts[i]!;
    const b = p.facts[i + 1];
    pairs.push(`<tr><td class="k">${esc(a[0])}</td><td class="v">${esc(a[1])}</td>${b ? `<td class="k">${esc(b[0])}</td><td class="v">${esc(b[1])}</td>` : "<td></td><td></td>"}</tr>`);
  }
  const facts = `<table class="facts">${pairs.join("")}</table>`;
  const tables = p.tables
    .map(
      (tb) =>
        `<h2>${esc(tb.heading)}</h2><table class="lines"><thead><tr><th>${esc(tb.heading)}</th><th>${esc(p.whyHeader)}</th><th class="r">${esc(p.amountHeader)}</th></tr></thead><tbody>${tb.rows
          .map((r) => `<tr><td>${esc(r.name)}</td><td class="why">${r.why ? esc(r.why) : ""}</td><td class="r">${esc(r.amount)}</td></tr>`)
          .join("")}</tbody></table>`,
    )
    .join("");
  const notes = p.notes.length ? `<ul class="notes">${p.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : "";
  return `<!doctype html><html lang="${esc(p.lang)}"><head><meta charset="utf-8"><title>${esc(p.title)}</title><style>${CSS}</style></head><body>${head}${facts}${tables}<div class="total"><span>${esc(p.total.label)}</span><span>${esc(p.total.amount)}</span></div>${notes}<div class="footer">${esc(p.footer)}</div></body></html>`;
}

/** Print an HTML page from a hidden frame; the print dialog also saves a PDF. Browser only. */
export function printHtml(html: string): void {
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
