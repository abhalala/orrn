/**
 * The three papers of the pricing documents (quote, proforma invoice, works order) as plain strings, built from what
 * the server answered with the PAPER formatter and the paper words (`usePaperFmt()` / `paperT(t)` in the hosts, never
 * the plant's screen units). Pure, so the mapping is unit-tested; the lazy HTML builder (`paper-html.ts`) and the
 * works order screen read the same model.
 *
 * The works order carries no price field at all: its rows are built from an explicit list of production facts.
 */
import type { Fmt } from "@orrn/domain";
import type { Translate } from "@orrn/i18n";
import type { AppRouter } from "@orrn/server/routers/index";
import type { inferRouterOutputs } from "@trpc/server";

import { countText, kgGrouped3, massUnit, rateText, rupeeText, sectionText, sectionUnit } from "@/shared/lib/fmt-text";

type Outputs = inferRouterOutputs<AppRouter>;
export type QuoteGet = Outputs["pricing"]["quotes"]["get"];
export type WorksOrderGet = Outputs["pricing"]["worksOrder"]["get"];

export type PaperLetterhead = { legalName?: string | null; gstin?: string | null; address?: string | null; phone?: string | null } | null | undefined;

export type PaperDoc = {
  /** The file and window title. */
  fileName: string;
  /** The document's name at the top ("Quotation", "Proforma invoice"). */
  title: string;
  /** A line under the title that must stay with it ("Proforma invoice. Not a tax invoice."). */
  banner: string | null;
  number: string;
  company: string;
  companyLines: string[];
  meta: [label: string, value: string][];
  party: { label: string; name: string; lines: string[] } | null;
  columns: string[];
  /** "r" right-aligns a column (numbers). */
  align: ("l" | "r")[];
  rows: string[][];
  /** Lines under each row (the rate breakdown); same length as `rows`, or empty. */
  details: string[][];
  totals: [label: string, value: string][];
  notes: string[];
};

const clean = (v: string | null | undefined): string => (v ?? "").trim();

/** A billing address stored as text or as a record of text parts (street, city, ...), as one line. */
export function addressText(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (v && typeof v === "object") return Object.values(v as Record<string, unknown>).flatMap((x) => (typeof x === "string" && x.trim() ? [x.trim()] : [])).join(", ");
  return "";
}

export function letterheadLines(l: PaperLetterhead): { company: string; lines: string[] } {
  return { company: clean(l?.legalName), lines: [clean(l?.address), clean(l?.phone), clean(l?.gstin)].filter(Boolean) };
}

/** "18" for 1800 basis points, "12.5" for 1250. */
export function taxPercentText(bp: number): string {
  const v = bp / 100;
  return Number.isInteger(v) ? String(v) : String(Number(v.toFixed(2)));
}

const sectionCell = (code: string | null, name: string | null): string => [clean(code), clean(name)].filter(Boolean).join(" ");
const alloyCell = (alloy: string | null, temper: string | null): string => [clean(alloy), clean(temper)].filter(Boolean).join(" ");
export const finishCell = (finish: string | null, t: Translate): string => {
  const f = clean(finish).toLowerCase();
  return f === "anodise" || f === "pvd" ? t(`orders.finish.${f}`) : f ? clean(finish) : t("orders.finish.none");
};

type PricedLine = {
  lineNo: number;
  sectionCode: string | null;
  sectionName: string | null;
  alloy: string | null;
  temper: string | null;
  finish: string | null;
  cutLengthMm: number;
  pcs: number | null;
  kgG: number;
  ratePaise: number;
  amountPaise: number;
};

function pricedColumns(fmt: Fmt, t: Translate): { columns: string[]; align: ("l" | "r")[] } {
  return {
    columns: [t("price.quotes.paper.no"), t("price.quotes.paper.section"), t("price.quotes.paper.alloy"), t("price.quotes.paper.finish"), t("price.quotes.paper.length"), t("price.quotes.paper.pcs"), `${t("price.quotes.paper.weight")} ${massUnit(fmt)}`, t("price.quotes.paper.rate"), t("price.quotes.paper.amount")],
    align: ["l", "l", "l", "l", "r", "r", "r", "r", "r"],
  };
}

function pricedRow(l: PricedLine, fmt: Fmt, t: Translate): string[] {
  return [
    String(l.lineNo),
    sectionCell(l.sectionCode, l.sectionName),
    alloyCell(l.alloy, l.temper),
    finishCell(l.finish, t),
    fmt.q("bundle.length", l.cutLengthMm),
    l.pcs != null ? countText(fmt, l.pcs) : "",
    kgGrouped3(fmt, l.kgG),
    rateText(fmt, l.ratePaise),
    rupeeText(fmt, l.amountPaise),
  ];
}

/** The quote as a paper: lines with rate and amount, valid until, the note. */
export function buildQuotePaper(data: QuoteGet, fmt: Fmt, t: Translate): PaperDoc {
  const q = data.quote;
  const head = letterheadLines(data.letterhead);
  const { columns, align } = pricedColumns(fmt, t);
  const notes = [t("price.quotes.paper.taxNote"), t("price.quotes.paper.perKg")];
  if (clean(q.note)) notes.unshift(clean(q.note));
  return {
    fileName: `${t("price.quotes.paper.title")} ${q.number}`,
    title: t("price.quotes.paper.title"),
    banner: null,
    number: q.number,
    company: head.company,
    companyLines: head.lines,
    meta: [
      [t("price.quotes.paper.number"), q.number],
      [t("price.quotes.paper.date"), fmt.day(q.quoteDate)],
      [t("price.quotes.paper.validUntil"), fmt.day(q.validUntil)],
    ],
    party: { label: t("price.quotes.paper.to"), name: clean(data.customer.name), lines: [addressText(data.customer.billingAddress), clean(data.customer.taxId) ? `${t("price.quotes.paper.taxId")} ${clean(data.customer.taxId)}` : ""].filter(Boolean) },
    columns,
    align,
    rows: data.lines.map((l) => pricedRow({ ...l, ratePaise: l.ratePaise, amountPaise: l.amountPaise }, fmt, t)),
    details: [],
    totals: [[t("price.quotes.paper.total"), rupeeText(fmt, data.totals.totalPaise)]],
    notes,
  };
}

/** The frozen proforma, as `pricing.proforma.create` returns it and `pricing.proforma.get` stores it. */
export type ProformaSnapshot = {
  number: string;
  date: string;
  source: { kind: "order" | "quote"; id: string; number: string; date: string; poNumber: string | null };
  letterhead: PaperLetterhead;
  customer: { name: string; gstin: string | null; billingAddress: unknown };
  lines: (PricedLine & {
    breakup: {
      metalPaisePerKg: number;
      conversionPaisePerKg: number;
      alloyPaisePerKg: number;
      finishPaisePerKg: number;
      componentsPaisePerKg: number;
      discountPaisePerKg: number;
    } | null;
  })[];
  charges: { label?: string; paise?: number }[];
  totals: { subtotalPaise: number; gstBp: number; gstPaise: number; totalPaise: number };
  bank: Record<string, unknown> | null;
};

/** The snapshot of a stored proforma row (`row.snapshot`), or null for something that is not one. */
export function readSnapshot(raw: unknown): ProformaSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Partial<ProformaSnapshot>;
  if (typeof s.number !== "string" || !Array.isArray(s.lines) || !s.totals || !s.customer || !s.source) return null;
  return s as ProformaSnapshot;
}

/** The bank lines a snapshot carries (text values in their stored order); empty while no bank is set. */
export function bankLines(bank: Record<string, unknown> | null | undefined): string[] {
  if (!bank) return [];
  return Object.values(bank).flatMap((v) => (typeof v === "string" && v.trim() ? [v.trim()] : []));
}

export function breakupLine(b: NonNullable<ProformaSnapshot["lines"][number]["breakup"]>, fmt: Fmt, t: Translate): string {
  return t("price.proforma.paper.breakup", {
    metal: rateText(fmt, b.metalPaisePerKg),
    conversion: rateText(fmt, b.conversionPaisePerKg),
    alloy: rateText(fmt, b.alloyPaisePerKg),
    finish: rateText(fmt, b.finishPaisePerKg),
    addons: rateText(fmt, b.componentsPaisePerKg),
    discount: rateText(fmt, b.discountPaisePerKg),
  });
}

/** The proforma invoice as a paper. States it is not a tax invoice, shows the tax as an estimate, never adds charges twice. */
export function buildProformaPaper(s: ProformaSnapshot, fmt: Fmt, t: Translate): PaperDoc {
  const head = letterheadLines(s.letterhead);
  const { columns, align } = pricedColumns(fmt, t);
  const percent = taxPercentText(s.totals.gstBp);
  const bank = bankLines(s.bank);
  const sourceWord = s.source.kind === "quote" ? t("price.proforma.paper.fromQuote") : t("price.proforma.paper.fromOrder");
  const notes: string[] = [t("price.proforma.paper.estimateNote", { percent })];
  const charges = (s.charges ?? []).filter((c) => clean(c.label) && typeof c.paise === "number");
  if (charges.length > 0) notes.push(t("price.proforma.paper.charges", { list: charges.map((c) => `${clean(c.label)} ${rupeeText(fmt, c.paise!)}`).join(", ") }));
  notes.push(bank.length > 0 ? `${t("price.proforma.paper.bank")}: ${bank.join(", ")}` : t("price.proforma.paper.noBank"));
  return {
    fileName: `${t("price.proforma.paper.title")} ${s.number}`,
    title: t("price.proforma.paper.title"),
    banner: t("price.proforma.paper.banner"),
    number: s.number,
    company: head.company,
    companyLines: head.lines,
    meta: [
      [t("price.proforma.paper.number"), s.number],
      [t("price.proforma.paper.date"), fmt.day(s.date)],
      [sourceWord, s.source.number],
      ...(clean(s.source.poNumber) ? ([[t("price.proforma.paper.po"), clean(s.source.poNumber)]] as [string, string][]) : []),
    ],
    party: { label: t("price.quotes.paper.to"), name: clean(s.customer.name), lines: [addressText(s.customer.billingAddress), clean(s.customer.gstin) ? `${t("price.quotes.paper.taxId")} ${clean(s.customer.gstin)}` : ""].filter(Boolean) },
    columns,
    align,
    rows: s.lines.map((l) => pricedRow(l, fmt, t)),
    details: s.lines.map((l) => (l.breakup ? [breakupLine(l.breakup, fmt, t)] : [])),
    totals: [
      [t("price.proforma.paper.subtotal"), rupeeText(fmt, s.totals.subtotalPaise)],
      [t("price.proforma.paper.tax", { percent }), rupeeText(fmt, s.totals.gstPaise)],
      [t("price.proforma.paper.total"), rupeeText(fmt, s.totals.totalPaise)],
    ],
    notes,
  };
}

/** The production facts of one works order line. Nothing here is a price. */
export type WorksOrderRow = {
  lineNo: number;
  section: string;
  alloy: string;
  temper: string;
  finish: string;
  cutLength: string;
  pcs: string;
  kg: string;
  kgPer12ft: string;
  tier: string;
  note: string;
};

export function worksOrderRows(data: WorksOrderGet, fmt: Fmt, t: Translate): WorksOrderRow[] {
  return data.lines.map((l) => ({
    lineNo: l.lineNo,
    section: sectionCell(l.sectionCode, l.sectionName),
    alloy: clean(l.alloy),
    temper: clean(l.temper),
    finish: finishCell(l.finish, t),
    cutLength: fmt.q("bundle.length", l.cutLengthMm),
    pcs: l.pcs != null ? countText(fmt, l.pcs) : "",
    kg: kgGrouped3(fmt, l.kgG),
    kgPer12ft: l.kgPer12ftMilli != null ? `${sectionText(fmt, l.kgPer12ftMilli)} ${sectionUnit(fmt)}` : "",
    tier: l.tierRank != null ? t("orders.line.tierOrBetter", { rank: l.tierRank }) : "",
    note: clean(l.note),
  }));
}

export function worksOrderCells(r: WorksOrderRow): string[] {
  return [String(r.lineNo), r.section, r.alloy, r.temper, r.finish, r.cutLength, r.pcs, r.kg, r.kgPer12ft, r.tier, r.note];
}

/** The works order as a paper. `number` is the issued WO number (null until it is issued). */
export function buildWorksOrderPaper(data: WorksOrderGet, number: string | null, fmt: Fmt, t: Translate): PaperDoc {
  const head = letterheadLines(data.letterhead);
  const o = data.order;
  return {
    fileName: `${t("price.worksOrder.paper.title")} ${number ?? o.number}`,
    title: t("price.worksOrder.paper.title"),
    banner: null,
    number: number ?? "",
    company: head.company,
    companyLines: head.lines,
    meta: [
      [t("price.worksOrder.paper.number"), number ?? t("price.worksOrder.paper.notIssued")],
      [t("price.worksOrder.paper.order"), o.number],
      [t("price.worksOrder.paper.orderDate"), fmt.day(o.orderDate)],
      ...(o.expectedDate ? ([[t("price.worksOrder.paper.expected"), fmt.day(o.expectedDate)]] as [string, string][]) : []),
      ...(clean(o.poNumber) ? ([[t("price.worksOrder.paper.po"), clean(o.poNumber)]] as [string, string][]) : []),
    ],
    party: { label: t("price.worksOrder.paper.customer"), name: clean(o.customerName), lines: [] },
    columns: [
      t("price.quotes.paper.no"),
      t("price.worksOrder.paper.section"),
      t("price.quotes.paper.alloy"),
      t("price.worksOrder.paper.temper"),
      t("price.quotes.paper.finish"),
      t("price.worksOrder.paper.cutLength"),
      t("price.quotes.paper.pcs"),
      `${t("price.quotes.paper.weight")} ${massUnit(fmt)}`,
      sectionUnit(fmt),
      t("price.worksOrder.paper.tier"),
      t("price.worksOrder.paper.note"),
    ],
    align: ["l", "l", "l", "l", "l", "r", "r", "r", "r", "l", "l"],
    rows: worksOrderRows(data, fmt, t).map(worksOrderCells),
    details: [],
    totals: [],
    notes: clean(o.note) ? [clean(o.note)] : [],
  };
}

export type EnquiryBadge = "overdue" | "dueToday" | "open" | "closed";

/** The follow-up state of an enquiry on the list: overdue before today, due today, open, or closed (won, lost, dropped). */
export function enquiryBadge(e: { status: string; followUpDate: string | null; overdue?: boolean }, today: string): EnquiryBadge {
  if (e.status !== "open" && e.status !== "quoted") return "closed";
  if (e.overdue === true || (e.followUpDate != null && e.followUpDate < today)) return "overdue";
  if (e.followUpDate != null && e.followUpDate === today) return "dueToday";
  return "open";
}

/** Whole days an open enquiry is past its follow-up date (0 when it is not). */
export function daysOverdue(followUpDate: string | null, today: string): number {
  if (!followUpDate || followUpDate >= today) return 0;
  return Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${followUpDate}T00:00:00Z`)) / 86_400_000);
}

export type QuoteListRow = {
  number: string;
  customerName: string;
  quoteDate: string;
  validUntil: string;
  status: string;
  expired: boolean;
};

/** The status a quote row shows: draft and sent quotes past their date read as expired. */
export function quoteShownStatus(r: Pick<QuoteListRow, "status" | "expired">): "draft" | "sent" | "converted" | "cancelled" | "expired" {
  if (r.expired) return "expired";
  const s = r.status;
  return s === "sent" || s === "converted" || s === "cancelled" ? s : "draft";
}

/**
 * The quote rows narrowed by what was typed: number or customer text, and a quote date range. The server filters by status
 * and customer; the other columns (valid until, kg, amount) are read in the table, so this works on the rows loaded.
 */
export function filterQuoteRows<T extends QuoteListRow>(rows: readonly T[], f: { text?: string; from?: string; to?: string }): T[] {
  const q = (f.text ?? "").trim().toLowerCase();
  return rows.filter((r) => {
    if (q && !r.number.toLowerCase().includes(q) && !r.customerName.toLowerCase().includes(q)) return false;
    if (f.from && r.quoteDate < f.from) return false;
    if (f.to && r.quoteDate > f.to) return false;
    return true;
  });
}
