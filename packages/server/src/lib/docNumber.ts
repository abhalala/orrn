import { formatBundleNo, formatCastCode, formatPartyBundleNo, partyBundlePeriod, type BundleNumberPolicy } from "@orrn/domain";
import { company, docSeries, type DocType } from "@orrn/db/schema";
import { eq, sql } from "drizzle-orm";

import type { OrrnDb } from "./atomic";
import { DEFAULT_TIMEZONE, isValidTimezone, zonedYmd } from "./dayWindow";

export type { DocType };

export type DocNumber = { seq: number; number: string; period: string };
export type DocNumberBlock = { period: string; seqs: number[]; numbers: string[] };

/** Prefix for the `{TYPE}-{seq}` families (spec P7). */
const TYPE_PREFIX: Record<Exclude<DocType, "bundle" | "cast" | "pl" | "cert" | "party_bundle">, string> = {
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
};

const DEFAULT_PL_PREFIX = "PL/";
const MAX_PL_PREFIX_LENGTH = 20;

type SeriesSettings = { timezone: string; plPrefix: string; plStart: number };

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
  return { timezone, plPrefix, plStart };
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

  const start = docType === "pl" ? settings.plStart : 1;
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
