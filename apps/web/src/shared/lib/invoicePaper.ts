/**
 * The tax invoice, credit note and customer statement as plain text rows: what the A4 PDFs print
 * (`invoicePdf.tsx`, `statementPdf.tsx`) and what the tests read. The paper is English and in kg whatever the
 * plant chose on screen, and every figure comes from the frozen snapshot the server made at issue: nothing is
 * worked out again here. No Intl, no clock: dates are cut from `YYYY-MM-DD`.
 */
import { bankPrintParts, GST_STATE_CODES, kgQtyText, rupeesText, taxHeadsFor, type BankForPrint } from "@orrn/domain";

import type { InvoiceSnapshot } from "@orrn/server/lib/billing/snapshot";

export type PaperDoc = {
  kind: "invoice" | "credit_note";
  /** cancel_pending prints as issued: it stays a valid tax invoice until the IRP confirms the cancel. */
  status: "draft" | "irn_pending" | "issued" | "cancel_pending" | "cancelled";
  number: string | null;
  invoiceDate: string | null;
  noteReason: string | null;
  reason: string | null;
  snapshot: InvoiceSnapshot;
  irn: { irn: string | null; ackNo: string | null; ackDt: string | null; signedQrCode: string | null };
  /** The plant's default bank (`billing.invoices.get` `bank`); null or missing prints "bank details not set". */
  bank?: BankForPrint | null;
};

export type PaperParty = { label: string; name: string; lines: string[]; gstin: string };

export type InvoicePaper = {
  title: string;
  /** A loud mark under the title: draft, IRN pending, or cancelled. Null on an issued document. */
  mark: string | null;
  seller: { legalName: string; gstin: string; address: string; state: string; phone: string | null };
  meta: { label: string; value: string }[];
  parties: PaperParty[];
  columns: string[];
  rows: string[][];
  tax: { label: string; value: string }[];
  roundOff: string | null;
  total: string;
  words: string;
  hsnColumns: string[];
  hsnRows: string[][];
  ack: { label: string; value: string }[];
  signedQr: string | null;
  bank: string;
  terms: string | null;
  forLine: string;
  signatory: string | null;
};

export const BANK_NOT_SET = "bank details not set";

export function dmy(ymd: string | null | undefined): string {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}/.test(ymd)) return ymd ?? "";
  return `${ymd.slice(8, 10)}-${ymd.slice(5, 7)}-${ymd.slice(0, 4)}`;
}

const rs = (paise: number) => rupeesText(paise);
const pct = (bp: number) => `${(bp / 100).toFixed(bp % 100 === 0 ? 0 : 2)}%`;

function stateText(code: string): string {
  const name = GST_STATE_CODES[code];
  return name ? `${name} (${code})` : code;
}

function creditReasonText(r: string | null): string | null {
  if (r === "return") return "goods returned";
  if (r === "rate_difference") return "rate difference";
  if (r === "other") return "other";
  return null;
}

export function paperTitle(doc: Pick<PaperDoc, "kind" | "status">): { title: string; mark: string | null } {
  const credit = doc.kind === "credit_note";
  if (doc.status === "irn_pending") return { title: credit ? "Draft credit note" : "Draft invoice", mark: "Draft, IRN pending" };
  if (doc.status === "draft") return { title: credit ? "Draft credit note" : "Draft invoice", mark: "Draft" };
  return { title: credit ? "Credit Note" : "Tax Invoice", mark: doc.status === "cancelled" ? "Cancelled" : null };
}

export function invoicePaperModel(doc: PaperDoc): InvoicePaper {
  const s = doc.snapshot;
  const t = s.totals;
  const { title, mark } = paperTitle(doc);
  const heads = taxHeadsFor(s.supplyType);
  const credit = doc.kind === "credit_note";

  const meta: { label: string; value: string }[] = [
    { label: credit ? "Credit note no" : "Invoice no", value: doc.number ?? "Not numbered yet" },
    { label: "Date", value: doc.invoiceDate ? dmy(doc.invoiceDate) : "" },
    { label: "Place of supply", value: stateText(s.placeOfSupply) },
  ];
  if (s.against) meta.push({ label: "Against invoice", value: `${s.against.number} dated ${dmy(s.against.date)}` });
  const why = creditReasonText(doc.noteReason);
  if (credit && why) meta.push({ label: "Reason", value: doc.reason ? `${why}, ${doc.reason}` : why });
  if (s.sources.length) meta.push({ label: "Packing list", value: s.sources.map((x) => x.plCode).join(", ") });
  if (s.poNumbers.length) meta.push({ label: "PO no", value: s.poNumbers.join(", ") });
  if (s.vehicleNo) meta.push({ label: "Vehicle", value: s.vehicleNo });

  const p = s.party;
  const parties: PaperParty[] = [
    {
      label: "Bill to",
      name: p.name,
      lines: [p.address, [p.place, p.pincode].filter(Boolean).join(" "), `State: ${stateText(p.stateCode)}`].filter(Boolean),
      gstin: p.gstin ?? "Unregistered",
    },
  ];
  const ship = p.shipTo;
  parties.push(
    ship
      ? {
          label: "Ship to",
          name: ship.legalName,
          lines: [ship.address1, [ship.place, ship.pincode].filter(Boolean).join(" "), `State: ${stateText(ship.stateCode)}`].filter(Boolean),
          gstin: ship.gstin ?? "",
        }
      : { label: "Ship to", name: "Same as bill to", lines: [], gstin: "" },
  );

  const rows = t.lines.map((l, i) => [
    String(i + 1),
    l.description,
    l.hsn,
    l.weightG === null ? "" : `${kgQtyText(l.weightG)} kg`,
    l.ratePaise === null ? "" : rs(l.ratePaise),
    pct(l.gstRateBp),
    rs(l.taxablePaise),
  ]);

  const tax: { label: string; value: string }[] = [{ label: "Taxable value", value: rs(t.taxablePaise) }];
  if (heads === "cgst_sgst") {
    tax.push({ label: "CGST", value: rs(t.cgstPaise) }, { label: "SGST", value: rs(t.sgstPaise) });
  } else if (heads === "igst") {
    tax.push({ label: "IGST", value: rs(t.igstPaise) });
  } else {
    tax.push({ label: "Tax", value: "Nil, supply without payment of tax" });
  }

  const hsnRows = t.hsnSummary.map((h) => [
    h.hsn,
    rs(h.taxablePaise),
    pct(h.gstRateBp),
    heads === "igst" ? rs(h.igstPaise) : heads === "cgst_sgst" ? `${rs(h.cgstPaise)} + ${rs(h.sgstPaise)}` : "0.00",
  ]);

  const ack: { label: string; value: string }[] = [];
  if (doc.irn.irn) {
    ack.push({ label: "IRN", value: doc.irn.irn });
    if (doc.irn.ackNo) ack.push({ label: "Ack no", value: doc.irn.ackNo });
    if (doc.irn.ackDt) ack.push({ label: "Ack date", value: doc.irn.ackDt });
  }

  const plant = s.plant;
  return {
    title,
    mark,
    seller: { legalName: plant.legalName, gstin: plant.gstin, address: [plant.address, [plant.place, plant.pincode].filter(Boolean).join(" ")].filter(Boolean).join(", "), state: stateText(plant.stateCode), phone: plant.phone },
    meta,
    parties,
    columns: ["Sr", "Description", "HSN", "Qty", "Rate per kg", "GST", "Taxable"],
    rows,
    tax,
    roundOff: t.roundOffPaise === 0 ? null : `${t.roundOffPaise < 0 ? "-" : ""}${rs(Math.abs(t.roundOffPaise))}`,
    total: rs(t.totalPaise),
    words: s.amountInWords,
    hsnColumns: ["HSN", "Taxable", "Rate", heads === "igst" ? "IGST" : "CGST + SGST"],
    hsnRows,
    ack,
    signedQr: doc.irn.signedQrCode,
    bank: doc.bank ? bankPrintParts(doc.bank).join(", ") : BANK_NOT_SET,
    terms: plant.terms,
    forLine: `For ${plant.legalName}`,
    signatory: plant.signatory,
  };
}

export function invoicePdfFileName(doc: Pick<PaperDoc, "kind" | "number" | "status">): string {
  const base = (doc.number ?? "draft").replace(/[^A-Za-z0-9._-]+/g, "-");
  return `${doc.kind === "credit_note" ? "credit-note" : doc.status === "issued" ? "invoice" : "invoice-draft"}-${base}.pdf`;
}

// ---------------------------------------------------------------------------
// Customer statement
// ---------------------------------------------------------------------------

export type StatementDoc = {
  customer: { name: string; gstin: string | null };
  plant: { legalName: string; gstin: string; address: string } | null;
  from: string;
  to: string;
  openingPaise: number;
  lines: { date: string; kind: "invoice" | "credit_note" | "payment"; number: string; debitPaise: number; creditPaise: number; balancePaise: number }[];
  debitPaise: number;
  creditPaise: number;
  closingPaise: number;
};

export type StatementPaper = {
  title: string;
  seller: string[];
  customer: string[];
  period: string;
  columns: string[];
  rows: string[][];
  opening: string;
  totals: string[];
  closing: string;
  closingNote: string;
};

const KIND_WORD = { invoice: "Invoice", credit_note: "Credit note", payment: "Payment received" } as const;

/** Balance with its side: positive means the customer owes the plant. */
export function balanceText(paise: number): string {
  if (paise === 0) return "0.00";
  return `${rs(Math.abs(paise))} ${paise > 0 ? "Dr" : "Cr"}`;
}

export function statementPaperModel(d: StatementDoc): StatementPaper {
  return {
    title: "Statement of account",
    seller: d.plant ? [d.plant.legalName, `GSTIN ${d.plant.gstin}`, d.plant.address].filter(Boolean) : [],
    customer: [d.customer.name, d.customer.gstin ? `GSTIN ${d.customer.gstin}` : ""].filter(Boolean),
    period: `${dmy(d.from)} to ${dmy(d.to)}`,
    columns: ["Date", "Particulars", "Number", "Debit", "Credit", "Balance"],
    rows: d.lines.map((l) => [dmy(l.date), KIND_WORD[l.kind], l.number, l.debitPaise ? rs(l.debitPaise) : "", l.creditPaise ? rs(l.creditPaise) : "", balanceText(l.balancePaise)]),
    opening: balanceText(d.openingPaise),
    totals: [rs(d.debitPaise), rs(d.creditPaise)],
    closing: balanceText(d.closingPaise),
    closingNote: d.closingPaise > 0 ? "Amount due from you" : d.closingPaise < 0 ? "Amount in your favour" : "Nothing due",
  };
}

export function statementPdfFileName(name: string, to: string): string {
  return `statement-${name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${to}.pdf`;
}
