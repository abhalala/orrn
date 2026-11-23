/**
 * XE-BILL row 97: receivables, bounded. Outstanding per invoice and per customer, ageing buckets, the
 * customer statement, and the Tally XML vouchers. No general ledger and no purchase accounting: Tally stays
 * the books; orrn exports what it billed and what it was paid.
 */
import { daysBetweenYmd } from "./einvoice";
import { rupeesText } from "./gstInvoice";

export const AGEING_BUCKETS = ["d0_30", "d31_60", "d61_90", "d90_plus"] as const;
export type AgeingBucket = (typeof AGEING_BUCKETS)[number];

/** Days since the invoice date: 0 to 30, 31 to 60, 61 to 90, more than 90. */
export function ageingBucket(days: number): AgeingBucket {
  if (days <= 30) return "d0_30";
  if (days <= 60) return "d31_60";
  if (days <= 90) return "d61_90";
  return "d90_plus";
}

export type ReceivableInvoice = {
  id: string;
  number: string;
  invoiceDate: string;
  totalPaise: number;
  /** Payments allocated to it (active payments only). */
  paidPaise: number;
  /** Issued credit notes against it. */
  creditedPaise: number;
};

export function invoiceOutstanding(i: ReceivableInvoice): number {
  return i.totalPaise - i.paidPaise - i.creditedPaise;
}

export type AgeingRow = { outstandingPaise: number; buckets: Record<AgeingBucket, number>; onAccountPaise: number };

/**
 * Sum outstanding into buckets by days from invoice date to `asOf` (YYYY-MM-DD). Fully settled invoices add
 * nothing. An invoice credited after it was paid owes a negative amount: that is money on account (review N1),
 * never an ageing bucket.
 */
export function ageInvoices(invoices: readonly ReceivableInvoice[], asOf: string): AgeingRow {
  const buckets: Record<AgeingBucket, number> = { d0_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 };
  let outstandingPaise = 0;
  let onAccountPaise = 0;
  for (const inv of invoices) {
    const due = invoiceOutstanding(inv);
    if (due === 0) continue;
    if (due < 0) {
      onAccountPaise -= due;
      continue;
    }
    outstandingPaise += due;
    buckets[ageingBucket(Math.max(0, daysBetweenYmd(inv.invoiceDate, asOf)))] += due;
  }
  return { outstandingPaise, buckets, onAccountPaise };
}

export type StatementEntry = {
  date: string;
  kind: "invoice" | "credit_note" | "payment";
  number: string;
  debitPaise: number;
  creditPaise: number;
};

export type StatementLine = StatementEntry & { balancePaise: number };

/**
 * A customer statement: opening balance (everything before `from`), then each entry in date order
 * (invoices before credits on the same day, then by number), with a running balance. Positive = owed to the plant.
 */
export function buildStatement(entries: readonly StatementEntry[], from: string, to: string) {
  const order = { invoice: 0, credit_note: 1, payment: 2 } as const;
  const sorted = [...entries].sort(
    (a, b) => a.date.localeCompare(b.date) || order[a.kind] - order[b.kind] || a.number.localeCompare(b.number, "en", { numeric: true }),
  );
  let openingPaise = 0;
  const lines: StatementLine[] = [];
  let balance = 0;
  for (const e of sorted) {
    if (e.date < from) {
      openingPaise += e.debitPaise - e.creditPaise;
      continue;
    }
    if (e.date > to) continue;
    if (lines.length === 0) balance = openingPaise;
    balance += e.debitPaise - e.creditPaise;
    lines.push({ ...e, balancePaise: balance });
  }
  const debitPaise = lines.reduce((n, l) => n + l.debitPaise, 0);
  const creditPaise = lines.reduce((n, l) => n + l.creditPaise, 0);
  return { openingPaise, lines, debitPaise, creditPaise, closingPaise: openingPaise + debitPaise - creditPaise };
}

// ---------------------------------------------------------------------------
// Tally XML (Tally Prime / ERP 9 "Import Data" envelope)
// ---------------------------------------------------------------------------

export type TallyLedgers = {
  sales: string;
  cgst: string;
  sgst: string;
  igst: string;
  roundOff: string;
  cash: string;
  bank: string;
};

export const DEFAULT_TALLY_LEDGERS: TallyLedgers = {
  sales: "Sales",
  cgst: "Output CGST",
  sgst: "Output SGST",
  igst: "Output IGST",
  roundOff: "Round Off",
  cash: "Cash",
  bank: "Bank",
};

export function readTallyLedgers(raw: Record<string, unknown> | null | undefined): TallyLedgers {
  const out = { ...DEFAULT_TALLY_LEDGERS };
  for (const k of Object.keys(out) as (keyof TallyLedgers)[]) {
    const v = raw?.[k];
    if (typeof v === "string" && v.trim() && v.trim().length <= 100) out[k] = v.trim();
  }
  return out;
}

export type TallyVoucher =
  | {
      type: "Sales" | "Credit Note";
      number: string;
      date: string;
      party: string;
      partyGstin: string | null;
      placeOfSupply: string | null;
      reference: string | null;
      taxablePaise: number;
      cgstPaise: number;
      sgstPaise: number;
      igstPaise: number;
      roundOffPaise: number;
      totalPaise: number;
      narration: string;
    }
  | {
      type: "Receipt";
      number: string;
      date: string;
      party: string;
      /** cash goes to the cash ledger, every other mode to the bank ledger. */
      mode: string;
      amountPaise: number;
      against: { number: string; amountPaise: number }[];
      narration: string;
    };

export function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    // Control characters other than tab, line feed and carriage return are not allowed in XML 1.0.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

/** Tally amounts: rupees with two decimals, and Tally's sign rule (debit negative, credit positive). */
function amt(paise: number, debit: boolean): string {
  const v = rupeesText(paise).replace(/,/g, "");
  return debit ? `-${v}` : v;
}

const tallyDate = (ymd: string) => ymd.replace(/-/g, "");

function ledger(name: string, signedPaise: number, side: boolean, isParty: boolean, bill?: { name: string; type: string }[]): string {
  // A negative amount (a round off down) sits on the other side with a positive amount.
  const debit = signedPaise < 0 ? !side : side;
  const paise = Math.abs(signedPaise);
  const bills = (bill ?? [])
    .map(
      (b) =>
        `<BILLALLOCATIONS.LIST><NAME>${xmlEscape(b.name)}</NAME><BILLTYPE>${b.type}</BILLTYPE><AMOUNT>${amt(paise, debit)}</AMOUNT></BILLALLOCATIONS.LIST>`,
    )
    .join("");
  return `<ALLLEDGERENTRIES.LIST><LEDGERNAME>${xmlEscape(name)}</LEDGERNAME><ISDEEMEDPOSITIVE>${debit ? "Yes" : "No"}</ISDEEMEDPOSITIVE><ISPARTYLEDGER>${isParty ? "Yes" : "No"}</ISPARTYLEDGER><AMOUNT>${amt(paise, debit)}</AMOUNT>${bills}</ALLLEDGERENTRIES.LIST>`;
}

/**
 * Every voucher balances (debits = credits) by construction: Sales debits the party with the total and credits
 * sales, the tax heads and the round off (a negative round off is a debit); a Credit Note is the mirror;
 * a Receipt debits cash or bank and credits the party, with bill-wise allocations against the invoices.
 */
export function tallyVoucherXml(v: TallyVoucher, ledgers: TallyLedgers): string {
  const head = (type: string) =>
    `<VOUCHER VCHTYPE="${type}" ACTION="Create"><DATE>${tallyDate(v.date)}</DATE><VOUCHERTYPENAME>${type}</VOUCHERTYPENAME><VOUCHERNUMBER>${xmlEscape(v.number)}</VOUCHERNUMBER><PARTYLEDGERNAME>${xmlEscape(v.party)}</PARTYLEDGERNAME><NARRATION>${xmlEscape(v.narration)}</NARRATION>`;
  if (v.type === "Receipt") {
    const cash = v.mode === "cash";
    const bills = v.against.length > 0 ? v.against.map((a) => ({ name: a.number, type: "Agst Ref" })) : [{ name: v.number, type: "On Account" }];
    const partyEntries =
      v.against.length > 0
        ? v.against.map((a) => ledger(v.party, a.amountPaise, false, true, [{ name: a.number, type: "Agst Ref" }])).join("")
        : ledger(v.party, v.amountPaise, false, true, bills);
    const onAccount = v.amountPaise - v.against.reduce((n, a) => n + a.amountPaise, 0);
    const rest = v.against.length > 0 && onAccount > 0 ? ledger(v.party, onAccount, false, true, [{ name: v.number, type: "On Account" }]) : "";
    return `${head("Receipt")}${ledger(cash ? ledgers.cash : ledgers.bank, v.amountPaise, true, false)}${partyEntries}${rest}</VOUCHER>`;
  }
  const sales = v.type === "Sales";
  // Sales: party debit, the rest credit. Credit Note: the mirror.
  const partySide = sales;
  const gst = v.partyGstin ? `<PARTYGSTIN>${xmlEscape(v.partyGstin)}</PARTYGSTIN>` : "";
  const pos = v.placeOfSupply ? `<PLACEOFSUPPLY>${xmlEscape(v.placeOfSupply)}</PLACEOFSUPPLY>` : "";
  const ref = v.reference ? `<REFERENCE>${xmlEscape(v.reference)}</REFERENCE>` : "";
  const lines = [
    ledger(v.party, v.totalPaise, partySide, true, [{ name: v.type === "Sales" ? v.number : (v.reference ?? v.number), type: sales ? "New Ref" : "Agst Ref" }]),
    ledger(ledgers.sales, v.taxablePaise, !partySide, false),
    v.cgstPaise ? ledger(ledgers.cgst, v.cgstPaise, !partySide, false) : "",
    v.sgstPaise ? ledger(ledgers.sgst, v.sgstPaise, !partySide, false) : "",
    v.igstPaise ? ledger(ledgers.igst, v.igstPaise, !partySide, false) : "",
    v.roundOffPaise ? ledger(ledgers.roundOff, v.roundOffPaise, !partySide, false) : "",
  ].join("");
  return `${head(v.type)}${gst}${pos}${ref}${lines}</VOUCHER>`;
}

export function tallyEnvelope(vouchers: readonly TallyVoucher[], ledgers: TallyLedgers, companyName: string | null): string {
  const body = vouchers.map((v) => `<TALLYMESSAGE xmlns:UDF="TallyUDF">${tallyVoucherXml(v, ledgers)}</TALLYMESSAGE>`).join("\n");
  const company = companyName ? `<STATICVARIABLES><SVCURRENTCOMPANY>${xmlEscape(companyName)}</SVCURRENTCOMPANY></STATICVARIABLES>` : "";
  return `<?xml version="1.0" encoding="UTF-8"?>\n<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME>${company}</REQUESTDESC><REQUESTDATA>\n${body}\n</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>\n`;
}
