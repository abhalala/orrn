import {
  castSeriesFirstSeq,
  formatDocNumberWith,
  isFormattableDocType,
  readDocFormats,
  type DocFormats,
  formatBundleNo,
  formatCastCode,
  formatPartyBundleNo,
  partyBundlePeriod,
  readCastSeriesStart,
  type BundleNumberPolicy,
  type CastSeriesStart,
} from "@orrn/domain";
import { company, docSeries, type DocType } from "@orrn/db/schema";
import { and, eq, getTableColumns, sql, type SQL } from "drizzle-orm";

import type { OrrnDb, SqliteBatchItem } from "./atomic";
import { DEFAULT_TIMEZONE, isValidTimezone, zonedYmd } from "./dayWindow";

export type { DocType };

export type DocNumber = { seq: number; number: string; period: string };
export type DocNumberBlock = { period: string; seqs: number[]; numbers: string[] };

/** Prefix for the `{TYPE}-{seq}` families (spec P7). */
const TYPE_PREFIX: Record<Exclude<DocType, "bundle" | "cast" | "pl" | "cert" | "party_bundle" | "invoice" | "credit_note">, string> = {
  lot: "LOT",
  mrs: "MRS",
  grn: "GRN",
  so: "SO",
  press_run: "PR",
  dc_note: "DCN",
  count: "CNT",
  press_plan: "PP",
  ageing: "AG",
  die_maker_job: "DM",
  complaint: "CMP",
  quote: "Q",
  proforma: "PI",
  works_order: "WO",
  // XE-BILL: payments received.
  payment: "PAY",
  indent: "IND",
  store_po: "PO",
  // Maintenance work orders: MWO, so they never read like a works order WO- (XE-PRICE).
  maint_wo: "MWO",
};

/**
 * XE-BILL: tax invoice and credit note numbers, `INV/26-27/12` and `CN/26-27/3`. The financial year is
 * short so a five-digit sequence still fits GST Rule 46's 16 characters (and the IRP's DocDtls.No pattern).
 * Billing takes these numbers inside the issuing batch (lib/billing/numbering.ts) so none is ever skipped;
 * `nextDocNumber` formats them the same way for any other caller.
 */
export const BILLING_NUMBER_PREFIX = { invoice: "INV/", credit_note: "CN/" } as const;

/** `2026-27` -> `26-27`. */
export function shortFinancialYear(period: string): string {
  return period.slice(2);
}

const DEFAULT_PL_PREFIX = "PL/";
const MAX_PL_PREFIX_LENGTH = 20;

type SeriesSettings = {
  timezone: string;
  plPrefix: string;
  plStart: number;
  castSeriesStart: CastSeriesStart | null;
  /** XE ADM #77: the plant's own number formats (`settings.docFormats`); a missing type prints as today. */
  docFormats: DocFormats;
};

/** Read the tenant's numbering settings, falling back to defaults for anything malformed. */
function readSettings(raw: Record<string, unknown> | null): SeriesSettings {
  const tz = raw?.timezone;
  const timezone = typeof tz === "string" && isValidTimezone(tz) ? tz : DEFAULT_TIMEZONE;
  const pl = raw?.plSeries;
  let plPrefix = DEFAULT_PL_PREFIX;
  let plStart = 1;
  if (pl && typeof pl === "object") {
    const { prefix, start } = pl as { prefix?: unknown; start?: unknown };
    if (typeof prefix === "string" && prefix.length <= MAX_PL_PREFIX_LENGTH) plPrefix = prefix;
    if (typeof start === "number" && Number.isInteger(start) && start >= 1) plStart = start;
  }
  return { timezone, plPrefix, plStart, castSeriesStart: readCastSeriesStart(raw?.castSeriesStart), docFormats: readDocFormats(raw?.docFormats) };
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** `2026-27`: Indian financial year (1 Apr to 31 Mar) of the local date. */
function financialYear({ year, month }: { year: number; month: number }): string {
  const start = month >= 4 ? year : year - 1;
  return `${start}-${pad2((start + 1) % 100)}`;
}

/**
 * Period key for a document type at instant `at`, on the tenant's wall clock (IST by default):
 * `YYYY-MM` for bundle/cast (sequence resets monthly), the financial year for everything else.
 */
export function docPeriod(docType: DocType, at: Date, timezone: string = DEFAULT_TIMEZONE): string {
  const ymd = zonedYmd(timezone, at.getTime());
  return docType === "bundle" || docType === "cast" ? `${ymd.year}-${pad2(ymd.month)}` : financialYear(ymd);
}

function formatNumber(docType: DocType, period: string, seq: number, settings: SeriesSettings): string {
  // XE ADM #77: only the text changes. The sequence still comes from the one counter per (company,
  // doc type, period), so a format set mid-year continues the count and the year still restarts it.
  const own = isFormattableDocType(docType) ? settings.docFormats[docType] : undefined;
  if (own) return formatDocNumberWith(own, period, seq);
  switch (docType) {
    case "bundle": {
      const [y, m] = period.split("-").map(Number);
      return formatBundleNo(y!, m!, seq);
    }
    case "cast":
      return formatCastCode(Number(period.slice(5)), seq);
    case "pl":
      return `${settings.plPrefix}${period}/${seq}`;
    case "cert":
      return `TC/${period}/${seq}`;
    case "invoice":
    case "credit_note":
      return `${BILLING_NUMBER_PREFIX[docType]}${shortFinancialYear(period)}/${seq}`;
    case "party_bundle":
      throw new Error("party_bundle numbers come from allocatePartyBundleNumbers");
    default:
      return `${TYPE_PREFIX[docType]}-${seq}`;
  }
}

/**
 * Reserve `count` consecutive numbers of one series with a single atomic
 * `INSERT … ON CONFLICT DO UPDATE … RETURNING`, so concurrent callers can never see the same
 * value. Numbers are never reused; a caller whose write later fails leaves a gap (as with
 * `nextCompanySeq`). Run it outside the document's `atomicBatch`.
 */
export async function allocateDocNumbers(
  db: OrrnDb,
  companyId: string,
  docType: DocType,
  at: Date,
  count: number,
  createdBy: string | null = null,
): Promise<DocNumberBlock> {
  if (!Number.isInteger(count) || count < 0) throw new RangeError(`Invalid count ${count}`);

  const [co] = await db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1);
  if (!co) throw new Error("Unable to allocate document number: unknown company");
  const settings = readSettings(co.settings);

  const period = docPeriod(docType, at, settings.timezone);
  if (count === 0) return { period, seqs: [], numbers: [] };

  if (docType === "party_bundle") throw new Error("party_bundle numbers come from allocatePartyBundleNumbers");

  // The cast book continues from paper in its go-live month (castSeriesStart, FP-FD-02); the
  // start only matters for the series' first allocation in that period.
  const start =
    docType === "pl" ? settings.plStart : docType === "cast" ? castSeriesFirstSeq(settings.castSeriesStart, period) : 1;
  const seqs = await bumpSeries(db, { companyId, docType, period, scope: "", start, count, createdBy });
  return { period, seqs, numbers: seqs.map((seq) => formatNumber(docType, period, seq, settings)) };
}

/** One atomic upsert on (company, doc_type, period, scope); returns the reserved sequence numbers. */
async function bumpSeries(
  db: OrrnDb,
  input: { companyId: string; docType: DocType; period: string; scope: string; start: number; count: number; createdBy: string | null },
): Promise<number[]> {
  const { companyId, docType, period, scope, start, count, createdBy } = input;
  const [row] = await db
    .insert(docSeries)
    .values({ id: crypto.randomUUID(), companyId, docType, period, scope, value: start - 1 + count, createdBy })
    .onConflictDoUpdate({
      target: [docSeries.companyId, docSeries.docType, docSeries.period, docSeries.scope],
      set: { value: sql`${docSeries.value} + ${count}`, updatedAt: new Date() },
    })
    .returning({ value: docSeries.value });
  if (!row) throw new Error("Unable to allocate document number");
  return Array.from({ length: count }, (_, i) => row.value - count + 1 + i);
}

/**
 * Reserve `count` of a customer's own bundle numbers (FP-PK-07, C25): doc_series type
 * `party_bundle`, scope = customer id, period from the policy on the tenant's wall clock
 * (monthly `2026-10` resets on the 1st, fy `2026-27` resets 1 April, lifelong `life`).
 * Numbers: monthly `26J12`, fy `2026-27/12`, lifelong `4086`. A customer without a policy uses
 * the company serial as its party number, so callers do not call this for it.
 */
export async function allocatePartyBundleNumbers(
  db: OrrnDb,
  companyId: string,
  customerId: string,
  policy: BundleNumberPolicy,
  at: Date,
  count: number,
  createdBy: string | null = null,
): Promise<DocNumberBlock> {
  if (!Number.isInteger(count) || count < 0) throw new RangeError(`Invalid count ${count}`);
  const [co] = await db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1);
  if (!co) throw new Error("Unable to allocate document number: unknown company");
  const settings = readSettings(co.settings);
  const period = partyBundlePeriod(policy, zonedYmd(settings.timezone, at.getTime()));
  if (count === 0) return { period, seqs: [], numbers: [] };
  const seqs = await bumpSeries(db, { companyId, docType: "party_bundle", period, scope: customerId, start: 1, count, createdBy });
  return { period, seqs, numbers: seqs.map((seq) => formatPartyBundleNo(policy, period, seq)) };
}

/** The next number of a series. All plant documents get their number here, never client-side. */
export async function nextDocNumber(
  db: OrrnDb,
  companyId: string,
  docType: DocType,
  at: Date,
  createdBy: string | null = null,
): Promise<DocNumber> {
  const block = await allocateDocNumbers(db, companyId, docType, at, 1, createdBy);
  return { seq: block.seqs[0]!, number: block.numbers[0]!, period: block.period };
}

/** Series whose numbers can be reserved inside the document's own batch (`docNumberInBatch`). */
export type InBatchDocType = "maint_wo";

/**
 * The next `{TYPE}-{seq}` number reserved INSIDE the caller's batch, so a batch that fails (a lost race
 * on a unique index) takes no number and leaves no gap. It reads the series, predicts the next number,
 * and returns two statements to put first in the batch: the bump, then a guard that fails the whole
 * batch unless the bump landed on the predicted value. When another writer took that number in
 * between, the batch fails (`isDocNumberStale(e)`) and nothing lands; read again and retry.
 */
export async function docNumberInBatch(
  db: OrrnDb,
  companyId: string,
  docType: InBatchDocType,
  at: Date,
  createdBy: string | null = null,
): Promise<DocNumber & { statements: SqliteBatchItem[] }> {
  const [co] = await db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1);
  if (!co) throw new Error("Unable to allocate document number: unknown company");
  const settings = readSettings(co.settings);
  const period = docPeriod(docType, at, settings.timezone);
  const key = and(eq(docSeries.companyId, companyId), eq(docSeries.docType, docType), eq(docSeries.period, period), eq(docSeries.scope, ""));
  const [cur] = await db.select({ value: docSeries.value }).from(docSeries).where(key).limit(1);
  const seq = (cur?.value ?? 0) + 1;
  const statements: SqliteBatchItem[] = [
    db
      .insert(docSeries)
      .values({ id: crypto.randomUUID(), companyId, docType, period, scope: "", value: 1, createdBy })
      .onConflictDoUpdate({
        target: [docSeries.companyId, docSeries.docType, docSeries.period, docSeries.scope],
        set: { value: sql`${docSeries.value} + 1`, updatedAt: new Date() },
      }),
    seriesAbortUnless(db, sql`(select ${docSeries.value} from ${docSeries} where ${key}) = ${seq}`),
  ];
  return { seq, period, number: formatNumber(docType, period, seq, settings), statements };
}

/** Fails the whole batch unless `landed` holds: inserts a `doc_series` row of NULLs (NOT NULL on its id). */
function seriesAbortUnless(db: OrrnDb, landed: SQL): SqliteBatchItem {
  const nulls = Object.fromEntries(Object.entries(getTableColumns(docSeries)).map(([key, column]) => [key, sql`null`.as(column.name)]));
  const from = db.select({ one: sql`1` }).from(company).limit(1).as("series_abort_src");
  return db.insert(docSeries).select(db.select(nulls).from(from).where(sql`not (${landed})`) as never);
}

/** True when a batch failed because the number `docNumberInBatch` predicted was taken first. */
export function isDocNumberStale(e: unknown): boolean {
  for (let cur: unknown = e, depth = 0; cur && depth < 6; depth += 1) {
    if ((cur instanceof Error ? cur.message : String(cur)).includes("NOT NULL constraint failed: doc_series.")) return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}
