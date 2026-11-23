/**
 * XE-BILL screens: the pure rules behind the billing pages (status words and tones, what a document may do,
 * month lists, rupee and rate boxes, payment allocation, ageing rows). No view code, no tRPC, no dates read
 * from the clock: the pages pass today in.
 */
import { AGEING_BUCKETS, parseDecimal, type AgeingBucket } from "@orrn/domain";
import type { AppRouter } from "@orrn/server/routers/index";
import type { inferRouterOutputs } from "@trpc/server";

/** What `billing.invoices.get` answers: an invoice or a credit note with its snapshot, IRN, e-way bill and payments. */
export type BillDoc = inferRouterOutputs<AppRouter>["billing"]["invoices"]["get"];

export type DocKind = "invoice" | "credit_note";
export type DocStatus = "draft" | "irn_pending" | "issued" | "cancel_pending" | "cancelled";
export type Tone = "green" | "blue" | "amber" | "red" | "neutral";

export const DOC_STATUSES: readonly DocStatus[] = ["draft", "irn_pending", "issued", "cancel_pending", "cancelled"];

export function statusTone(status: DocStatus): Tone {
  switch (status) {
    case "issued":
      return "green";
    case "cancelled":
      return "red";
    default:
      return "amber";
  }
}

/** Rupees typed in a box to whole paise; null when it is not a plain amount with at most two decimals. */
export function rupeesToPaise(text: string): number | null {
  const n = parseDecimal(text);
  if (n === null) return null;
  const cleaned = text.replace(/,/g, "").trim();
  const frac = cleaned.split(".")[1] ?? "";
  if (frac.length > 2) return null;
  return Math.round(n * 100);
}

/** Paise as the text a box starts from ("1250.5" for 125050), no grouping, no trailing zeros. */
export function paiseToBox(paise: number): string {
  const s = (paise / 100).toFixed(2);
  return s.replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}

/** "2026-11" for a book date. */
export function monthOf(ymd: string): string {
  return ymd.slice(0, 7);
}

/** The last `count` months ending at the month of `todayYmd`, newest first, as `YYYY-MM`. */
export function recentMonths(todayYmd: string, count = 18): string[] {
  let y = Number(todayYmd.slice(0, 4));
  let m = Number(todayYmd.slice(5, 7));
  const out: string[] = [];
  for (let i = 0; i < count; i += 1) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  return out;
}

/** First and last day of the Indian financial year (April to March) that holds `todayYmd`. */
export function financialYearRange(todayYmd: string): { from: string; to: string } {
  const y = Number(todayYmd.slice(0, 4));
  const m = Number(todayYmd.slice(5, 7));
  const start = m >= 4 ? y : y - 1;
  return { from: `${start}-04-01`, to: `${start + 1}-03-31` };
}

// ---------------------------------------------------------------------------
// What a document may do
// ---------------------------------------------------------------------------

export type DocFacts = {
  kind: DocKind;
  status: DocStatus;
  needsIrn: boolean;
  irnStatus: string;
  hasIrn: boolean;
  ewbStatus: string;
  cancelPendingApprovalId: string | null;
  /** The IRN is past its 24 h: it cannot be cancelled, only reduced by a credit note (review S1). */
  irnWindowClosed?: boolean;
};

export type DocActions = {
  issue: boolean;
  discard: boolean;
  askCancel: boolean;
  cancelPending: boolean;
  /** The cancel is approved and waits for the IRP (status cancel_pending). */
  cancelAtIrp: boolean;
  /** Say "issue a credit note instead": the IRN is too old to cancel. */
  creditNoteOnly: boolean;
  creditNote: boolean;
  payment: boolean;
  irnPanel: boolean;
  irnGenerate: boolean;
  ewbPanel: boolean;
  ewbFile: boolean;
};

export function docActions(d: DocFacts): DocActions {
  const issued = d.status === "issued";
  const live = issued || d.status === "irn_pending";
  const inv = d.kind === "invoice";
  return {
    issue: d.status === "draft",
    discard: d.status === "draft",
    askCancel: live && d.cancelPendingApprovalId === null && !d.irnWindowClosed,
    cancelPending: live && d.cancelPendingApprovalId !== null,
    cancelAtIrp: d.status === "cancel_pending",
    creditNoteOnly: issued && inv && !!d.irnWindowClosed,
    creditNote: inv && issued,
    payment: inv && issued,
    irnPanel: d.needsIrn && d.status !== "draft",
    irnGenerate: d.needsIrn && !d.hasIrn && live && (d.status === "irn_pending" || d.irnStatus === "failed"),
    ewbPanel: inv && issued,
    // Review S5: only a final invoice goes in the e-way bill file, never one still waiting for its IRN.
    ewbFile: inv && issued,
  };
}

export type IrnWord = "none" | "pending" | "retrying" | "generated" | "failed" | "cancelled";

export function irnWord(irnStatus: string): IrnWord {
  switch (irnStatus) {
    case "pending":
      return "pending";
    case "auto_retry":
      return "retrying";
    case "generated":
      return "generated";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    default:
      return "none";
  }
}

// ---------------------------------------------------------------------------
// Invoice new: rates and charges
// ---------------------------------------------------------------------------

export type RateBox = { key: string; label: string; text: string };

/** Typed per-kg rates for the groups that need one, as the server wants them (paise per kg). Missing or bad ones are reported. */
export function ratesFromBoxes(boxes: readonly RateBox[]): { rates: Record<string, number>; bad: string[]; empty: string[] } {
  const rates: Record<string, number> = {};
  const bad: string[] = [];
  const empty: string[] = [];
  for (const b of boxes) {
    if (!b.text.trim()) {
      empty.push(b.key);
      continue;
    }
    const p = rupeesToPaise(b.text);
    if (p === null || p <= 0) bad.push(b.key);
    else rates[b.key] = p;
  }
  return { rates, bad, empty };
}

export type ChargeBox = { label: string; amountText: string; hsnId: string };

/** Charge lines that were filled in; a half-filled or bad one is reported by its index. */
export function chargesFromBoxes(boxes: readonly ChargeBox[]): { charges: { label: string; amountPaise: number; hsnId?: string }[]; bad: number[] } {
  const charges: { label: string; amountPaise: number; hsnId?: string }[] = [];
  const bad: number[] = [];
  boxes.forEach((b, i) => {
    if (!b.label.trim() && !b.amountText.trim()) return;
    const p = rupeesToPaise(b.amountText);
    if (!b.label.trim() || p === null || p <= 0) {
      bad.push(i);
      return;
    }
    charges.push({ label: b.label.trim(), amountPaise: p, ...(b.hsnId ? { hsnId: b.hsnId } : {}) });
  });
  return { charges, bad };
}

/** The packing lists of one customer only: once one is ticked, the others of another customer cannot be. */
export function selectable<T extends { id: string; customerId: string }>(rows: readonly T[], pickedIds: ReadonlySet<string>): Set<string> {
  const first = rows.find((r) => pickedIds.has(r.id));
  const ok = new Set<string>();
  for (const r of rows) if (!first || r.customerId === first.customerId) ok.add(r.id);
  return ok;
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

export type OpenInvoice = { id: string; duePaise: number };
export type AllocationBox = { invoiceId: string; text: string };

/** Spread a payment over open invoices, oldest first (the list arrives oldest first). Anything left stays on account. */
export function autoAllocate(amountPaise: number, open: readonly OpenInvoice[]): { boxes: AllocationBox[]; onAccountPaise: number } {
  let left = amountPaise;
  const boxes: AllocationBox[] = [];
  for (const inv of open) {
    if (left <= 0) break;
    const take = Math.min(left, inv.duePaise);
    if (take > 0) boxes.push({ invoiceId: inv.id, text: paiseToBox(take) });
    left -= take;
  }
  return { boxes, onAccountPaise: left };
}

export type AllocationProblem = "amount" | "negative" | "over_due" | "over_amount";

export type AllocationResult = {
  allocations: { invoiceId: string; amountPaise: number }[];
  allocatedPaise: number;
  onAccountPaise: number;
  /** invoice id (or "total") to what is wrong */
  problems: Record<string, AllocationProblem>;
  ok: boolean;
};

export function checkAllocation(amountText: string, open: readonly OpenInvoice[], boxes: readonly AllocationBox[]): AllocationResult {
  const problems: Record<string, AllocationProblem> = {};
  const amount = rupeesToPaise(amountText);
  const allocations: { invoiceId: string; amountPaise: number }[] = [];
  let allocated = 0;
  for (const b of boxes) {
    if (!b.text.trim()) continue;
    const p = rupeesToPaise(b.text);
    if (p === null || p === 0) {
      problems[b.invoiceId] = "negative";
      continue;
    }
    const due = open.find((o) => o.id === b.invoiceId)?.duePaise ?? 0;
    if (p > due) problems[b.invoiceId] = "over_due";
    allocations.push({ invoiceId: b.invoiceId, amountPaise: p });
    allocated += p;
  }
  if (amount === null || amount <= 0) problems.total = "amount";
  else if (allocated > amount) problems.total = "over_amount";
  const ok = Object.keys(problems).length === 0;
  return { allocations, allocatedPaise: allocated, onAccountPaise: amount !== null ? Math.max(0, amount - allocated) : 0, problems, ok };
}

// ---------------------------------------------------------------------------
// Outstanding
// ---------------------------------------------------------------------------

export type OutstandingRow = {
  customerId: string;
  customerName: string;
  openInvoices: number;
  buckets: Record<AgeingBucket, number>;
  invoicesDuePaise: number;
  onAccountPaise: number;
  balancePaise: number;
};

export type OutstandingTable = {
  rows: OutstandingRow[];
  totals: { buckets: Record<AgeingBucket, number>; invoicesDuePaise: number; onAccountPaise: number; balancePaise: number };
};

export function emptyBuckets(): Record<AgeingBucket, number> {
  return { d0_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 };
}

/** The ageing table with a total row; a customer search narrows the rows and the totals follow what is shown. */
export function shapeOutstanding(rows: readonly OutstandingRow[], search = ""): OutstandingTable {
  const q = search.trim().toLowerCase();
  const shown = rows.filter((r) => !q || r.customerName.toLowerCase().includes(q));
  const buckets = emptyBuckets();
  let invoicesDuePaise = 0;
  let onAccountPaise = 0;
  let balancePaise = 0;
  for (const r of shown) {
    for (const b of AGEING_BUCKETS) buckets[b] += r.buckets[b] ?? 0;
    invoicesDuePaise += r.invoicesDuePaise;
    onAccountPaise += r.onAccountPaise;
    balancePaise += r.balancePaise;
  }
  return { rows: [...shown], totals: { buckets, invoicesDuePaise, onAccountPaise, balancePaise } };
}

export { AGEING_BUCKETS };

// ---------------------------------------------------------------------------
// Credit note lines
// ---------------------------------------------------------------------------

export type CreditBox = { kind: "weight" | "amount"; description: string; kgText: string; rateText: string; amountText: string; hsnId: string };

export type CreditLine =
  | { kind: "weight"; description: string; hsnId?: string; weightG: number; ratePaise: number }
  | { kind: "amount"; description: string; hsnId?: string; amountPaise: number };

/** Kg typed in a box to whole grams; null for anything but a plain amount with at most three decimals. */
export function kgToGrams(text: string): number | null {
  const n = parseDecimal(text);
  if (n === null) return null;
  const frac = text.replace(/,/g, "").trim().split(".")[1] ?? "";
  if (frac.length > 3) return null;
  return Math.round(n * 1000);
}

/** The credit note lines the server wants; a blank line is skipped, a half-filled or bad one is reported by index. */
export function creditLinesFromBoxes(boxes: readonly CreditBox[]): { lines: CreditLine[]; bad: number[] } {
  const lines: CreditLine[] = [];
  const bad: number[] = [];
  boxes.forEach((b, i) => {
    const blank = !b.description.trim() && !b.kgText.trim() && !b.rateText.trim() && !b.amountText.trim();
    if (blank) return;
    const description = b.description.trim();
    const hsn = b.hsnId ? { hsnId: b.hsnId } : {};
    if (b.kind === "weight") {
      const g = kgToGrams(b.kgText);
      const r = rupeesToPaise(b.rateText);
      if (!description || !g || g <= 0 || !r || r <= 0) bad.push(i);
      else lines.push({ kind: "weight", description, ...hsn, weightG: g, ratePaise: r });
    } else {
      const a = rupeesToPaise(b.amountText);
      if (!description || !a || a <= 0) bad.push(i);
      else lines.push({ kind: "amount", description, ...hsn, amountPaise: a });
    }
  });
  return { lines, bad };
}

/** A GST rate typed as a percent ("18", "2.5") to basis points; null when it is not a plain number of at most two decimals within 28%. */
export function percentToBp(text: string): number | null {
  const n = parseDecimal(text);
  if (n === null) return null;
  const frac = text.replace(/,/g, "").trim().split(".")[1] ?? "";
  if (frac.length > 2) return null;
  const bp = Math.round(n * 100);
  return bp >= 0 && bp <= 2800 ? bp : null;
}

/** Basis points as the percent text a box starts from ("18", "2.5"). */
export function bpToPercent(bp: number): string {
  return String(bp / 100);
}

/** The text of an optional box as the server wants it: trimmed, or null when empty. */
export function orNull(text: string): string | null {
  const v = text.trim();
  return v ? v : null;
}
