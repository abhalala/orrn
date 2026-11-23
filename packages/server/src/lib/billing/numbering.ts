/**
 * XE-BILL: gap-free tax invoice and credit note numbers (CONTRACTS item 5).
 *
 * `allocateDocNumbers` bumps the series OUTSIDE the document's batch, so a batch that fails after it leaves
 * a hole; AGENTS.md accepts that for plant documents, GST Rule 46 does not for invoices. Here the series bump,
 * the invoice's UPDATE that takes the number, and an abort that fails the batch unless that UPDATE landed are
 * three statements of ONE batch. D1 runs a batch as one transaction and one batch at a time, so:
 * - a refused issue rolls the bump back (no gap);
 * - two issues at once get consecutive numbers (no reuse);
 * - a cancelled invoice keeps its row, its seq and its number (never reused).
 * The number restarts each financial year because the series key is (company, doc type, FY).
 */
import { and, eq, sql, type SQL } from "drizzle-orm";

import { billingEvent, invoice, type InvoiceKind } from "@orrn/db/schema/billing";
import { docSeries } from "@orrn/db/schema/series";
import { company } from "@orrn/db/schema/tenant";

import type { OrrnDb, SqliteBatchItem } from "../atomic";
import { BILLING_NUMBER_PREFIX, shortFinancialYear } from "../docNumber";

export const BILLING_ABORT = "NOT NULL constraint failed: billing_event.id";

/** A batch statement that fails the whole batch unless `landed` holds (INSERT of a NULL id). */
export function billingAbortUnless(db: OrrnDb, companyId: string, landed: SQL): SqliteBatchItem {
  // Query builder only: a raw `db.run` cannot go in a D1 batch. Keys follow billing_event's column order.
  return db.insert(billingEvent).select(
    db
      .select({
        id: sql<string>`null`.as("id"),
        companyId: sql<string>`${company.id}`.as("company_id"),
        invoiceId: sql<string | null>`null`.as("invoice_id"),
        action: sql<string>`'abort'`.as("action"),
        outcome: sql<string>`'abort'`.as("outcome"),
        code: sql<string | null>`null`.as("code"),
        message: sql<string | null>`null`.as("message"),
        at: sql<number>`0`.as("at"),
      })
      .from(company)
      .where(and(eq(company.id, companyId), sql`not (${landed})`))
      .limit(1) as never,
  );
}

export function isBillingAbort(e: unknown): boolean {
  for (let cur: unknown = e, depth = 0; cur && depth < 6; depth += 1) {
    if ((cur instanceof Error ? cur.message : String(cur)).includes(BILLING_ABORT)) return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

const seriesValue = (companyId: string, kind: InvoiceKind, period: string) =>
  sql`(select ds.value from doc_series ds where ds.company_id = ${companyId} and ds.doc_type = ${kind} and ds.period = ${period} and ds.scope = '')`;

/**
 * The statements that give invoice `invoiceId` the next number of its series and set it issued (or
 * irn_pending). `extraSet` adds columns to the same UPDATE; `guard` is the issue's own write-time condition
 * (status still draft, its packing lists still current). Append the caller's other statements AFTER these
 * and guard them with `issuedLanded`.
 */
export function issueStatements(
  db: OrrnDb,
  input: {
    companyId: string;
    invoiceId: string;
    kind: InvoiceKind;
    period: string;
    invoiceDate: string;
    status: "issued" | "irn_pending";
    userId: string;
    seq: number;
    at: number;
    irnStatus: "none" | "pending";
    guard: SQL;
  },
): SqliteBatchItem[] {
  const { companyId, invoiceId, kind, period } = input;
  const prefix = `${BILLING_NUMBER_PREFIX[kind]}${shortFinancialYear(period)}/`;
  const value = seriesValue(companyId, kind, period);
  const at = new Date(input.at);
  return [
    db
      .insert(docSeries)
      .values({ id: crypto.randomUUID(), companyId, serverSeq: 0, docType: kind, period, scope: "", value: 1, createdBy: input.userId, createdAt: at, updatedAt: at })
      .onConflictDoUpdate({
        target: [docSeries.companyId, docSeries.docType, docSeries.period, docSeries.scope],
        set: { value: sql`${docSeries.value} + 1`, updatedAt: at },
      }),
    db
      .update(invoice)
      .set({
        status: input.status,
        period,
        seq: sql`${value}`,
        number: sql`${prefix} || ${value}`,
        invoiceDate: input.invoiceDate,
        irnStatus: input.irnStatus,
        issuedBy: input.userId,
        issuedAt: at,
        serverSeq: input.seq,
        updatedAt: at,
      })
      .where(and(eq(invoice.id, invoiceId), eq(invoice.companyId, companyId), eq(invoice.status, "draft"), input.guard)),
    billingAbortUnless(db, companyId, issuedLanded(companyId, invoiceId, input.seq)),
  ];
}

/** EXISTS: this request's issue landed (the invoice carries this request's server_seq and a number). */
export function issuedLanded(companyId: string, invoiceId: string, seq: number): SQL {
  return sql`exists (select 1 from invoice i where i.id = ${invoiceId} and i.company_id = ${companyId} and i.server_seq = ${seq} and i.number is not null)`;
}
