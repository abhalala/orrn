/**
 * Dry run (plan B4, B7): run a candidate's recipe over its staged rows, resolve names and codes
 * against live data, and stage each row as ready_create, ready_update, unchanged, ambiguous,
 * conflict, refused or skipped. Nothing touches live tables.
 *
 * One call handles at most 200 rows from the stored cursor. The browser pumps it with `expectCursor`;
 * the cursor moves with a compare-and-set in the statement's own WHERE, so a second tab gets CONFLICT.
 *
 * Staged `values` hold the recipe's canonical values plus server keys: `_ids` (resolved live ids by
 * field, or `pending:<rowKey>` for a record the same merge creates), `_options` (what an ambiguous row
 * could mean) and `_dupKey` (in-file duplicate key). The merge reads field values and `_ids`; keys
 * starting with `_` are never live fields. The text and unit the file gave for each number go in the
 * `entered` column, for audit (owner rule).
 */
import {
  applyRow,
  compileRecipe,
  orderLineGrams,
  periodRequired,
  recipeSchema,
  type ApplyOptions,
  type ApplyRow,
  type CompiledRecipe,
  type DateFormat,
  type MagnitudeFlag,
  magnitudeReason,
  type Recipe,
  type UnitId,
} from "@orrn/ingest";
import { isModuleOn, type CompanyModule } from "@orrn/domain";
import { TRPCError } from "@trpc/server";
import { and, asc, eq, gte, inArray, isNull, lt, notInArray, or, sql, type SQL } from "drizzle-orm";

import { customer, customerAlias, die, dieInstance, salesOrderLine, vendor, vendorAlias } from "@orrn/db/schema";
import {
  ingestAnswer,
  ingestCandidate,
  ingestStagedRow,
  type IngestTarget,
  type RowDecision,
  type RowState,
} from "@orrn/db/schema/ingest";

import { chunk, mapInChunks, pushChunkedInserts, type SqliteBatchItem } from "../atomic";
import { now } from "../clock";
import { createId } from "../id";
import { companyModules } from "../moduleGate";
import { can } from "../permissions";
import { nameKey } from "../purchase";
import { stagedRowIdOf } from "./artifacts";
import {
  aliasNameCheck,
  aliasNameOwners,
  checkReason,
  handStatusCheck,
  liveCustomersByKey,
  loadOrderLineSchema,
  newCopyCheck,
  orderLineCheck,
  type NameOwner,
} from "./merge/rowchecks";
import { companyFloor } from "../orderLines";
import {
  groupFyOf,
  liveOrderKey,
  liveOrdersOf,
  ORDER_GROUP_CODES,
  orderGroupCheck,
  orderIdentityOf,
  orderPoOf,
  otherFileHolders,
  parseOrderKey,
  poKeyOf,
  poTwiceCheck,
  sheetOrderKeys,
  ORDER_NO_UNCLEAR,
  type OrderIdentity,
} from "./orderid";
import { refreshArtifactPeriod } from "./period";
import {
  guardedBatch,
  ingestAbortUnlessChanged,
  loadArtifact,
  loadBlock,
  loadCandidate,
  RATE_FIELDS,
  seesRates,
  type AnswerRow,
  type ArtifactRow,
  type CandidateRow,
} from "./core";
import {
  loadCopies,
  loadCustomerIndex,
  loadLegacyBundles,
  loadSections,
  loadVendorIndex,
  resolveCopy,
  resolveName,
  resolveSection,
  sectionCodeIn,
  sectionKeys,
  type NameIndex,
  type Resolution,
} from "./resolvers";
import { INGEST_LIMITS, type DryRunStepOut, type IngestCtx, type IngestQuestion } from "./types";

export const TARGET_MODULE: Record<IngestTarget, CompanyModule> = {
  customers: "customers",
  customer_aliases: "customers",
  vendors: "purchase",
  vendor_aliases: "purchase",
  dies: "dies",
  die_copies: "dies",
  bundles: "bundles",
  orders: "orders",
};

/** Row reasons a candidate-level question covers. Such rows wait for the answer, not a row decision. */
export const Q_CUSTOMER_NEW = "q:customer_new";
export const Q_SECTION_UNKNOWN = "q:section_unknown";
/** A row with a number outside its plausible range waits on `magnitude_check` for this subject (C19). */
export const Q_MAGNITUDE = "q:magnitude_check";
/** The rows of one old order with two different POs wait on `order_po` for the order's key (rules 3, 1). */
export const Q_ORDER_PO = "q:order_po";

type Values = Record<string, unknown>;
type Staged = typeof ingestStagedRow.$inferSelect;

export type Entered = Record<string, { text: string; unit: string | null }>;

export type RowOutcome = {
  state: RowState;
  values: Values | null;
  entered?: Entered | null;
  reasons: string[];
  matchId: string | null;
  diff: Record<string, { live: unknown; file: unknown }> | null;
  /** Orders: the old order the row belongs to (orderid.ts), stored in `order_key`. */
  orderKey?: string | null;
};

// ---------------------------------------------------------------------------
// Answers
// ---------------------------------------------------------------------------

export type AnswerSet = {
  units: Record<string, UnitId>;
  dateFormats: Record<string, DateFormat>;
  periodAsOf: string | null;
  ratesLeftOut: boolean | null;
  legacyDie: Map<string, boolean>;
  newCustomers: boolean | null;
  /** `magnitude_check` answers by field: "as_is", or the unit the column's flagged numbers are in. */
  magnitude: Map<string, string>;
  /** `order_po` answers by order key: the PO picked (`{ po }`), or "skip". */
  orderPo: Map<string, { po: string } | "skip">;
  answered: Set<string>;
};

export const answerKey = (code: string, subject: string) => `${code}\u001f${subject}`;

/** Answer codes that belong to one layout. A new layout drops them (A2). */
export const LAYOUT_ANSWER_CODES = ["unit_unknown", "date_format_ambiguous", "column_meaning_unclear", "magnitude_check"] as const;

/** Fields whose unit the recipe leaves open: a number step with unit null, or listed as unit_unknown. */
export function openUnitFields(recipe: Recipe): Set<string> {
  const out = new Set<string>();
  for (const f of recipe.fields) if (f.steps.some((s) => s.op === "number" && s.unit === null)) out.add(f.field);
  for (const u of recipe.unclear) if (u.code === "unit_unknown") out.add(u.field);
  return out;
}

/**
 * The stored answers as dry run options. With `recipe`, a unit or date answer counts only while the
 * recipe still asks that question, so an answer to an older layout never overrides a unit the new
 * layout states (A2).
 */
export function readAnswers(rows: readonly AnswerRow[], artifact: Pick<ArtifactRow, "periodConfirmed">, recipe?: Recipe): AnswerSet {
  const unitOpen = recipe ? openUnitFields(recipe) : null;
  const dateOpen = recipe ? new Set(recipe.unclear.filter((u) => u.code === "date_format_ambiguous").map((u) => u.field)) : null;
  const set: AnswerSet = {
    units: {},
    dateFormats: {},
    periodAsOf: artifact.periodConfirmed?.asOf ?? null,
    ratesLeftOut: null,
    legacyDie: new Map(),
    newCustomers: null,
    magnitude: new Map(),
    orderPo: new Map(),
    answered: new Set(),
  };
  for (const a of rows) {
    set.answered.add(answerKey(a.questionCode, a.subject));
    const v = a.answer as unknown;
    switch (a.questionCode) {
      case "unit_unknown":
        if (typeof v === "string" && (!unitOpen || unitOpen.has(a.subject))) set.units[a.subject] = v as UnitId;
        break;
      case "date_format_ambiguous":
        if (typeof v === "string" && (!dateOpen || dateOpen.has(a.subject))) set.dateFormats[a.subject] = v as DateFormat;
        break;
      case "period_needed":
        if (v && typeof v === "object" && typeof (v as { asOf?: unknown }).asOf === "string") set.periodAsOf = (v as { asOf: string }).asOf;
        break;
      case "rates_hidden":
        set.ratesLeftOut = v === "leave_out";
        break;
      case "create_legacy_die":
        set.legacyDie.set(a.subject, v === true);
        break;
      case "new_customers":
        set.newCustomers = v === true;
        break;
      case "magnitude_check":
        if (typeof v === "string") set.magnitude.set(a.subject, v);
        break;
      case "order_po":
        if (v === "skip") set.orderPo.set(a.subject, "skip");
        else if (v && typeof v === "object" && typeof (v as { po?: unknown }).po === "string") set.orderPo.set(a.subject, { po: (v as { po: string }).po });
        break;
      default:
        break;
    }
  }
  return set;
}

export function applyOptions(answers: AnswerSet): ApplyOptions {
  return { units: answers.units, dateFormats: answers.dateFormats, periodAsOf: answers.periodAsOf, currentYear: now().getUTCFullYear() };
}

export function parseRecipe(json: unknown): Recipe {
  const parsed = recipeSchema.safeParse(json);
  if (!parsed.success) throw new TRPCError({ code: "BAD_REQUEST", message: "The layout for this sheet is not valid" });
  return parsed.data;
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

const blank = (v: unknown) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");

function same(a: unknown, b: unknown): boolean {
  if (typeof a === "string" && typeof b === "string") return a.trim().toLowerCase() === b.trim().toLowerCase();
  return a === b;
}

/**
 * Compare file values with a live record (plan B7): every file field equal or blank in the file is
 * unchanged; only live-empty fields differ is ready_update (fills blanks); a live non-empty field
 * that differs is conflict, or skipped / fills-only by `onExisting`.
 */
export function compareLive(
  file: Values,
  live: Values,
  onExisting: Recipe["onExisting"],
): { state: RowState; diff: Record<string, { live: unknown; file: unknown }> | null } {
  const fills: Record<string, { live: unknown; file: unknown }> = {};
  const differs: Record<string, { live: unknown; file: unknown }> = {};
  for (const [field, value] of Object.entries(file)) {
    if (field.startsWith("_") || blank(value) || !(field in live)) continue;
    const l = live[field];
    if (blank(l)) fills[field] = { live: l ?? null, file: value };
    else if (!same(l, value)) differs[field] = { live: l, file: value };
  }
  const nFill = Object.keys(fills).length;
  const nDiff = Object.keys(differs).length;
  if (nDiff === 0) return nFill === 0 ? { state: "unchanged", diff: null } : { state: "ready_update", diff: fills };
  if (onExisting === "skip") return { state: "skipped", diff: { ...fills, ...differs } };
  if (onExisting === "fill_blanks") return nFill === 0 ? { state: "unchanged", diff: null } : { state: "ready_update", diff: fills };
  return { state: "conflict", diff: { ...fills, ...differs } };
}

/** Live data one page needs, loaded in a bounded number of reads. */
type PageLive = {
  customers?: NameIndex;
  vendors?: NameIndex;
  sections?: Awaited<ReturnType<typeof loadSections>>;
  copies?: Awaited<ReturnType<typeof loadCopies>>;
  legacy?: Map<string, string>;
  liveCustomers?: Map<string, Values>;
  liveVendors?: Map<string, Values>;
  liveDies?: Map<string, Values & { id: string }>;
  liveCopies?: Map<string, Values>;
  customerAliasKeys?: Map<string, string>;
  vendorAliasKeys?: Map<string, string>;
  /** Alias targets: the live customer or vendor each name key belongs to (B13). */
  nameOwners?: Map<string, NameOwner>;
  /** Sections a ready or approved die sheet of the plant will create, by staged row key (X-new-4). */
  pendingSections?: { rowKey: string; series: string; code: string }[];
  /** Customers a ready or approved customers sheet of the plant will add, by name key (rule 2, S3-7). */
  pendingCustomers?: Map<string, string>;
};

const str = (v: unknown) => (typeof v === "string" ? v : v === null || v === undefined ? "" : String(v));

async function loadPageLive(ctx: IngestCtx, target: IngestTarget, rows: readonly Values[]): Promise<PageLive> {
  const live: PageLive = {};
  const codes = rows.map((v) => str(v.sectionCode)).filter(Boolean);
  if (target === "customers" || target === "customer_aliases" || target === "orders") live.customers = await loadCustomerIndex(ctx);
  if (target === "vendors" || target === "vendor_aliases") live.vendors = await loadVendorIndex(ctx);
  if (target === "dies" || target === "die_copies" || target === "bundles" || target === "orders") live.sections = await loadSections(ctx, codes);
  if (target === "orders" || target === "die_copies") {
    const known = new Set((live.sections ?? []).map((x) => x.sectionCode.trim().toUpperCase()));
    live.pendingSections = await loadPendingSections(ctx, sectionKeys(codes).filter((k) => !known.has(k)));
  }
  if (target === "die_copies") live.copies = await loadCopies(ctx, rows.map((v) => str(v.makerDieNo)));
  if (target === "bundles") live.legacy = await loadLegacyBundles(ctx, rows.map((v) => str(v.legacyId)));
  if (target === "customers") {
    const recs = await ctx.db
      .select()
      .from(customer)
      .where(and(eq(customer.companyId, ctx.companyId), isNull(customer.deletedAt)));
    live.liveCustomers = new Map(
      recs.map((c) => [
        c.id,
        { name: c.name, taxId: c.taxId, phone: c.phone, email: c.email, city: (c.billingAddress as { city?: unknown } | null)?.city ?? null, notes: c.notes },
      ]),
    );
  }
  if (target === "vendors") {
    const recs = await ctx.db.select().from(vendor).where(eq(vendor.companyId, ctx.companyId));
    live.liveVendors = new Map(recs.map((v) => [v.id, { name: v.name, gstin: v.gstin, phone: v.phone, city: v.city, notes: v.notes }]));
  }
  if (target === "dies") {
    const recs = await mapInChunks(sectionKeys(codes), (part) =>
      ctx.db
        .select()
        .from(die)
        .where(and(eq(die.companyId, ctx.companyId), isNull(die.deletedAt), sectionCodeIn(part))),
    );
    live.liveDies = new Map(
      recs.map((d) => {
        const dims = (d.dimensions ?? {}) as Record<string, unknown>;
        return [
          `${d.series.trim().toUpperCase()}|${d.sectionCode.trim().toUpperCase()}`,
          {
            id: d.id,
            name: d.name,
            widthMm: dims.widthMm ?? d.widthMm,
            thicknessMm: dims.thicknessMm ?? d.thicknessMm,
            legMm: dims.legMm ?? d.legMm,
            weightMinG: d.weightMinG,
            weightMaxG: d.weightMaxG,
            status: d.status,
            notes: d.notes,
          },
        ];
      }),
    );
  }
  if (target === "die_copies" && live.copies?.length) {
    const recs = await mapInChunks(
      live.copies.map((c) => c.id),
      (part) => ctx.db.select().from(dieInstance).where(and(eq(dieInstance.companyId, ctx.companyId), inArray(dieInstance.id, part))),
    );
    live.liveCopies = new Map(
      recs.map((c) => [
        c.id,
        {
          supplier: c.supplier,
          makerProjectNo: c.makerProjectNo,
          trialKgPer12ft: c.trialKgPer12ftMilli,
          hardness: c.hardness,
          lifeKg: c.lifeG,
          tierRank: c.tierRank,
          status: c.status,
          notes: c.notes,
        },
      ]),
    );
  }
  if (target === "customer_aliases") {
    const keys = rows.map((v) => nameKey(str(v.alias))).filter(Boolean);
    const hits = await mapInChunks([...new Set(keys)], (part) =>
      ctx.db
        .select({ key: customerAlias.aliasKey, id: customerAlias.customerId })
        .from(customerAlias)
        .where(and(eq(customerAlias.companyId, ctx.companyId), inArray(customerAlias.aliasKey, part))),
    );
    live.customerAliasKeys = new Map(hits.map((h) => [h.key, h.id]));
  }
  if (target === "customer_aliases" || target === "vendor_aliases") live.nameOwners = await aliasNameOwners(ctx, target);
  if (target === "customer_aliases") live.pendingCustomers = await loadPendingCustomers(ctx, rows.map((v) => nameKey(str(v.customer))));
  if (target === "vendor_aliases") {
    const keys = rows.map((v) => nameKey(str(v.alias))).filter(Boolean);
    const hits = await mapInChunks([...new Set(keys)], (part) =>
      ctx.db
        .select({ key: vendorAlias.aliasKey, id: vendorAlias.vendorId })
        .from(vendorAlias)
        .where(and(eq(vendorAlias.companyId, ctx.companyId), inArray(vendorAlias.aliasKey, part))),
    );
    live.vendorAliasKeys = new Map(hits.map((h) => [h.key, h.id]));
  }
  return live;
}

/**
 * New sections a die sheet of the plant will add when it merges: `ready_create` rows of a dies
 * candidate that is ready or approved (X-new-4). Dies merge before die copies and orders, so a row
 * pointing at one of them (`pending:<rowKey>`) finds the new section at chunk time; if that die sheet
 * is not merged first, the merge holds the row's candidate (dependency_held) instead of writing it.
 */
async function loadPendingSections(ctx: IngestCtx, codes: readonly string[]): Promise<{ rowKey: string; series: string; code: string }[]> {
  if (codes.length === 0) return [];
  const V = ingestStagedRow.values;
  const code = sql<string>`upper(trim(coalesce(json_extract(${V}, '$.sectionCode'), '')))`;
  const rows = await mapInChunks([...codes], (part) =>
    ctx.db
      .select({ rowKey: ingestStagedRow.rowKey, series: sql<string>`upper(trim(coalesce(json_extract(${V}, '$.series'), '')))`, code })
      .from(ingestStagedRow)
      .innerJoin(ingestCandidate, eq(ingestCandidate.id, ingestStagedRow.candidateId))
      .where(
        and(
          eq(ingestCandidate.companyId, ctx.companyId),
          eq(ingestCandidate.target, "dies"),
          inArray(ingestCandidate.state, ["ready", "approved"]),
          eq(ingestStagedRow.state, "ready_create"),
          eq(ingestStagedRow.mergeState, "open"),
          inArray(code, part),
        ),
      ),
  );
  return rows;
}

/**
 * Customers a customers sheet of the plant will add when it merges, by name key: `ready_create` rows
 * of a customers candidate that is ready or approved (rule 2, S3-7). Customers merge before
 * customer aliases, so an alias row pointing at one (`pending:<rowKey>`) finds the new customer at
 * chunk time; if that sheet is not merged first, the merge holds the aliases candidate. Read on
 * `ingest_staged_row_company_name_key_idx`, 90 keys a statement. The first row by key wins.
 */
async function loadPendingCustomers(ctx: IngestCtx, keys: readonly string[]): Promise<Map<string, string>> {
  const wanted = [...new Set(keys)].filter(Boolean);
  const out = new Map<string, string>();
  if (wanted.length === 0) return out;
  const rows = await mapInChunks(wanted, (part) =>
    ctx.db
      .select({ rowKey: ingestStagedRow.rowKey, key: ingestStagedRow.nameKey })
      .from(ingestStagedRow)
      .innerJoin(ingestCandidate, eq(ingestCandidate.id, ingestStagedRow.candidateId))
      .where(
        and(
          eq(ingestStagedRow.companyId, ctx.companyId),
          inArray(ingestStagedRow.nameKey, part),
          eq(ingestCandidate.target, "customers"),
          inArray(ingestCandidate.state, ["ready", "approved"]),
          eq(ingestStagedRow.state, "ready_create"),
          eq(ingestStagedRow.mergeState, "open"),
        ),
      ),
  );
  for (const r of rows.sort((a, b) => (a.rowKey < b.rowKey ? -1 : a.rowKey > b.rowKey ? 1 : 0))) {
    if (r.key && !out.has(r.key)) out.set(r.key, r.rowKey);
  }
  return out;
}

/** A candidate's refused `not_found:customer` alias rows: each row's index and customer name key. */
async function customerNotFoundRows(ctx: IngestCtx, candidateIds: readonly string[]) {
  if (candidateIds.length === 0) return [];
  const rows = await mapInChunks([...candidateIds], (part) =>
    ctx.db
      .select({ candidateId: ingestStagedRow.candidateId, rowIndex: ingestStagedRow.rowIndex, name: sql<string | null>`json_extract(${ingestStagedRow.values}, '$.customer')` })
      .from(ingestStagedRow)
      .where(
        and(
          inArray(ingestStagedRow.candidateId, part),
          eq(ingestStagedRow.state, "refused"),
          eq(ingestStagedRow.mergeState, "open"),
          sql`${ingestStagedRow.reasons} like '%"not_found:customer"%'`,
        ),
      ),
  );
  return rows.map((r) => ({ ...r, key: nameKey(str(r.name)) }));
}

/** Section keys (upper case, trimmed) of a candidate's refused `section_unknown` rows, with each row's index. */
async function sectionUnknownRows(ctx: IngestCtx, candidateIds: readonly string[]) {
  if (candidateIds.length === 0) return [];
  const V = ingestStagedRow.values;
  return mapInChunks([...candidateIds], (part) =>
    ctx.db
      .select({
        candidateId: ingestStagedRow.candidateId,
        rowIndex: ingestStagedRow.rowIndex,
        code: sql<string>`upper(trim(coalesce(json_extract(${V}, '$.sectionCode'), '')))`,
      })
      .from(ingestStagedRow)
      .where(
        and(
          inArray(ingestStagedRow.candidateId, part),
          eq(ingestStagedRow.state, "refused"),
          eq(ingestStagedRow.mergeState, "open"),
          sql`${ingestStagedRow.reasons} like '%"section_unknown:sectionCode"%'`,
        ),
      ),
  );
}

/**
 * Rule 2: a die sheet finished its dry run with new sections, or a customers sheet with new
 * customers. Every candidate of the plant that is ready or still checking, and has rows refused for
 * one of them (orders and die copies for a section, customer aliases for a customer), goes back to
 * checking from its first such row. A held one is left as it is: approve refuses it until it is
 * checked again (`staleRefusal`).
 */
export async function dependentsAgain(ctx: IngestCtx, madeBy: Pick<CandidateRow, "id" | "target">, at: Date): Promise<SqliteBatchItem[]> {
  const V = ingestStagedRow.values;
  const isDies = madeBy.target === "dies";
  const made = await ctx.db
    .select({
      key: isDies ? sql<string>`upper(trim(coalesce(json_extract(${V}, '$.sectionCode'), '')))` : sql<string>`coalesce(${ingestStagedRow.nameKey}, '')`,
    })
    .from(ingestStagedRow)
    .where(and(eq(ingestStagedRow.candidateId, madeBy.id), eq(ingestStagedRow.state, "ready_create"), eq(ingestStagedRow.mergeState, "open")));
  const keys = new Set(made.map((m) => m.key).filter(Boolean));
  if (keys.size === 0) return [];
  const others = await ctx.db
    .select({ id: ingestCandidate.id, dryCursor: ingestCandidate.dryCursor, state: ingestCandidate.state })
    .from(ingestCandidate)
    .where(
      and(
        eq(ingestCandidate.companyId, ctx.companyId),
        inArray(ingestCandidate.target, isDies ? ["orders", "die_copies"] : ["customer_aliases"]),
        inArray(ingestCandidate.state, ["ready", "processing"]),
      ),
    );
  const refused = isDies
    ? (await sectionUnknownRows(ctx, others.map((o) => o.id))).map((r) => ({ candidateId: r.candidateId, rowIndex: r.rowIndex, key: r.code }))
    : await customerNotFoundRows(ctx, others.map((o) => o.id));
  const first = new Map<string, number>();
  for (const r of refused) {
    if (!keys.has(r.key)) continue;
    first.set(r.candidateId, Math.min(first.get(r.candidateId) ?? r.rowIndex, r.rowIndex));
  }
  return others
    .filter((o) => first.has(o.id))
    .map((o) =>
      ctx.db
        .update(ingestCandidate)
        .set({
          state: "processing",
          dryCursor: o.state === "processing" ? Math.min(o.dryCursor, first.get(o.id)!) : first.get(o.id)!,
          serverSeq: sql`${ingestCandidate.serverSeq} + 1`,
          updatedAt: at,
        })
        .where(and(eq(ingestCandidate.id, o.id), eq(ingestCandidate.companyId, ctx.companyId), eq(ingestCandidate.state, o.state))),
    );
}

/**
 * Rule 2, at approve: the words when a row was refused for a section that is now in orrn, or that a
 * ready or approved die sheet of the plant adds. Null when the refusals still stand.
 */
export async function staleRefusal(ctx: IngestCtx, candidateId: string, target: IngestTarget): Promise<string | null> {
  if (target === "customer_aliases") return staleCustomerRefusal(ctx, candidateId);
  const rows = await sectionUnknownRows(ctx, [candidateId]);
  const codes = [...new Set(rows.map((r) => r.code).filter(Boolean))];
  if (codes.length === 0) return null;
  const live = await loadSections(ctx, codes);
  const known = new Set(live.map((x) => x.sectionCode.trim().toUpperCase()));
  const pending = await loadPendingSections(ctx, codes.filter((k) => !known.has(k)));
  const hit = codes.find((k) => known.has(k) || pending.some((x) => x.code === k));
  if (hit) return `Check this sheet again: section ${hit} is now in orrn or in a die sheet of this plant, so rows refused for it may import now.`;
  // A die sheet that adds the section but is not done yet: a row waiting on an answer, a sheet still
  // being checked, or one held. Approving now would drop these rows for good (S3-4).
  const waiting = await unfinishedDieSections(ctx, codes.filter((k) => !known.has(k)));
  if (waiting) return `A die sheet of this plant that is still being checked adds section ${waiting}. Finish it first, then check this sheet again.`;
  return (await sheetStillReading(ctx, "dies")) ? "A die sheet of this plant is still being checked. Finish it first, then check this sheet again." : null;
}

/**
 * Whether a sheet of this target in the plant has not finished its dry run, so its rows cannot be
 * looked at by name or code yet. The derived new customers list of an order book is left out.
 */
async function sheetStillReading(ctx: IngestCtx, target: "dies" | "customers"): Promise<boolean> {
  const [hit] = await ctx.db
    .select({ id: ingestCandidate.id })
    .from(ingestCandidate)
    .where(
      and(
        eq(ingestCandidate.companyId, ctx.companyId),
        eq(ingestCandidate.target, target),
        inArray(ingestCandidate.state, ["processing", "needs_shape", "needs_confirm"]),
        isNull(ingestCandidate.parentId),
      ),
    )
    .limit(1);
  return !!hit;
}

/**
 * Rule 2 for customers, at approve (S3-7): an alias row refused because its customer was not found,
 * when that customer is now in orrn or in a ready or approved customers sheet ("Check this sheet
 * again"), or is on a row of a customers sheet that is not done yet, or such a sheet is still being
 * checked ("Finish it first").
 */
async function staleCustomerRefusal(ctx: IngestCtx, candidateId: string): Promise<string | null> {
  const rows = await customerNotFoundRows(ctx, [candidateId]);
  const keys = [...new Set(rows.map((r) => r.key).filter(Boolean))];
  if (keys.length === 0) return null;
  const nameOf = (k: string) => str(rows.find((r) => r.key === k)?.name).trim();
  const live = new Set((await liveCustomersByKey(ctx, keys)).map((c) => c.key));
  const pending = await loadPendingCustomers(ctx, keys.filter((k) => !live.has(k)));
  const hit = keys.find((k) => live.has(k) || pending.has(k));
  if (hit) return `Check this sheet again: ${nameOf(hit)} is now in orrn or in a customers sheet of this plant, so rows refused for it may import now.`;
  const open = keys.filter((k) => !live.has(k));
  const waiting = await mapInChunks(open, (part) =>
    ctx.db
      .select({ key: ingestStagedRow.nameKey })
      .from(ingestStagedRow)
      .innerJoin(ingestCandidate, eq(ingestCandidate.id, ingestStagedRow.candidateId))
      .where(
        and(
          eq(ingestStagedRow.companyId, ctx.companyId),
          inArray(ingestStagedRow.nameKey, part),
          eq(ingestCandidate.target, "customers"),
          notInArray(ingestCandidate.state, ["discarded", "merged"]),
          notInArray(ingestStagedRow.state, ["refused", "skipped"]),
          eq(ingestStagedRow.mergeState, "open"),
        ),
      )
      .limit(1),
  );
  if (waiting[0]?.key) return `A customers sheet of this plant that is still being checked adds ${nameOf(waiting[0].key)}. Finish it first, then check this sheet again.`;
  return (await sheetStillReading(ctx, "customers")) ? "A customers sheet of this plant is still being checked. Finish it first, then check this sheet again." : null;
}

/**
 * The first of these sections that a dies candidate of the plant, not discarded and not merged,
 * has on a row that is not refused or skipped and is not yet a ready row of a ready or approved
 * sheet (those are `loadPendingSections`). Read by section code, 90 a statement.
 */
async function unfinishedDieSections(ctx: IngestCtx, codes: readonly string[]): Promise<string | null> {
  if (codes.length === 0) return null;
  const V = ingestStagedRow.values;
  const code = sql<string>`upper(trim(coalesce(json_extract(${V}, '$.sectionCode'), '')))`;
  const rows = await mapInChunks([...codes], (part) =>
    ctx.db
      .select({ code })
      .from(ingestStagedRow)
      .innerJoin(ingestCandidate, eq(ingestCandidate.id, ingestStagedRow.candidateId))
      .where(
        and(
          eq(ingestCandidate.companyId, ctx.companyId),
          eq(ingestCandidate.target, "dies"),
          notInArray(ingestCandidate.state, ["discarded", "merged"]),
          notInArray(ingestStagedRow.state, ["refused", "skipped"]),
          eq(ingestStagedRow.mergeState, "open"),
          inArray(code, part),
        ),
      )
      .limit(1),
  );
  return rows[0]?.code ?? null;
}

type ClassifyCtx = {
  target: IngestTarget;
  recipe: Recipe;
  live: PageLive;
  answers: AnswerSet;
  /** The id a person picked for this row (`use_match`), used for its one ambiguous lookup. */
  forced: string | null;
  /** `pending:<rowKey>` for a new party name when new customers are answered yes. */
  newCustomerRef: (name: string) => string;
};

/** In-file duplicate key of a row, or null when the target allows repeats (orders). */
export function dupKeyOf(target: IngestTarget, v: Values): string | null {
  switch (target) {
    case "customers":
    case "vendors":
      return nameKey(str(v.name)) || null;
    case "customer_aliases":
    case "vendor_aliases":
      return nameKey(str(v.alias)) || null;
    case "dies":
      return `${str(v.series).trim().toUpperCase()}|${str(v.sectionCode).trim().toUpperCase()}`;
    case "die_copies":
      return str(v.makerDieNo).trim() || null;
    case "bundles":
      return str(v.legacyId).trim() || null;
    default:
      return null;
  }
}

function amb(values: Values, field: string, options: { id: string; label: string }[], reasons: string[], code: string): RowOutcome {
  values._options = [...((values._options as unknown[]) ?? []), { field, options }];
  return { state: "ambiguous", values, reasons: [...reasons, `${code}:${field}`], matchId: null, diff: null };
}

/** Resolve a name or code; a person's pick wins over an ambiguous result. */
function pick(res: Resolution, cx: ClassifyCtx): Resolution {
  if (res.kind === "ambiguous" && cx.forced && res.options.some((o) => o.id === cx.forced)) {
    const o = res.options.find((x) => x.id === cx.forced)!;
    return { kind: "match", id: o.id, label: o.label };
  }
  return res;
}

function sectionOf(values: Values, ids: Record<string, string>, reasons: string[], cx: ClassifyCtx): RowOutcome | null {
  const code = str(values.sectionCode).trim();
  const r = pick(resolveSection(cx.live.sections ?? [], str(values.series) || null, code), cx);
  if (r.kind === "match") {
    ids.sectionCode = r.id;
    return null;
  }
  if (r.kind === "ambiguous") return amb(values, "sectionCode", r.options, reasons, "ambiguous");
  // The merge adds an old section only for bundles. An order line or a die copy needs a section that
  // is in orrn when the merge writes it (B10), so the question is not asked for them. A section a die
  // sheet of this plant will add first is that section (X-new-4): the row points at its staged row.
  if (cx.target === "orders" || cx.target === "die_copies") {
    const series = str(values.series).trim().toUpperCase();
    // Two pending die rows for one series and section are one section (rule 2): the first by key.
    const byCode = [
      ...new Map(
        (cx.live.pendingSections ?? [])
          .filter((x) => x.code === code.toUpperCase())
          .sort((a, b) => (a.rowKey < b.rowKey ? -1 : a.rowKey > b.rowKey ? 1 : 0))
          .reverse()
          .map((x) => [`${x.series}|${x.code}`, x] as const),
      ).values(),
    ];
    const exact = series ? byCode.filter((x) => x.series === series) : [];
    const hit = exact.length === 1 ? exact[0] : byCode.length === 1 ? byCode[0] : undefined;
    if (hit) {
      ids.sectionCode = `pending:${hit.rowKey}`;
      reasons.push("section_pending:sectionCode");
      return null;
    }
    return { state: "refused", values, reasons: [...reasons, "section_unknown:sectionCode"], matchId: null, diff: null };
  }
  const legacy = cx.answers.legacyDie.get(code);
  if (legacy === true) {
    values.legacyDie = true;
    return null;
  }
  if (legacy === false) return { state: "refused", values, reasons: [...reasons, "section_unknown:sectionCode"], matchId: null, diff: null };
  return { state: "ambiguous", values, reasons: [...reasons, `${Q_SECTION_UNKNOWN}:${code}`], matchId: null, diff: null };
}

/** Classify one applied row against live data (plan B7). Pure given the loaded page data. */
export function classifyRow(values: Values, cx: ClassifyCtx): RowOutcome {
  const reasons: string[] = [];
  const ids: Record<string, string> = {};
  values._ids = ids;
  const t = cx.target;

  if (t === "customers" || t === "vendors") {
    const index = (t === "customers" ? cx.live.customers : cx.live.vendors)!;
    const r = pick(resolveName(index, str(values.name)), cx);
    if (r.kind === "ambiguous") return amb(values, "name", r.options, reasons, "ambiguous");
    if (r.kind === "none") return { state: "ready_create", values, reasons, matchId: null, diff: null };
    const liveRec = (t === "customers" ? cx.live.liveCustomers : cx.live.liveVendors)?.get(r.id) ?? {};
    // The name matched by key; a different spelling of it is not a conflict.
    const { state, diff } = compareLive({ ...values, name: undefined }, liveRec, cx.recipe.onExisting);
    return { state, values, reasons, matchId: r.id, diff };
  }

  if (t === "customer_aliases" || t === "vendor_aliases") {
    const field = t === "customer_aliases" ? "customer" : "vendor";
    const index = (t === "customer_aliases" ? cx.live.customers : cx.live.vendors)!;
    let r = pick(resolveName(index, str(values[field])), cx);
    if (r.kind === "ambiguous") return amb(values, field, r.options, reasons, "ambiguous");
    // A customer a customers sheet of the plant adds first is that customer (rule 2, S3-7).
    const pendingRow = r.kind === "none" && t === "customer_aliases" ? cx.live.pendingCustomers?.get(nameKey(str(values[field]))) : undefined;
    if (pendingRow) {
      r = { kind: "match", id: `pending:${pendingRow}`, label: str(values[field]) };
      reasons.push("customer_pending:customer");
    }
    if (r.kind === "none") return { state: "refused", values, reasons: [`not_found:${field}`], matchId: null, diff: null };
    ids[field] = r.id;
    const owner = (t === "customer_aliases" ? cx.live.customerAliasKeys : cx.live.vendorAliasKeys)?.get(nameKey(str(values.alias)));
    if (owner === r.id) return { state: "unchanged", values, reasons, matchId: r.id, diff: null };
    if (owner) return { state: "conflict", values, reasons: ["alias_taken:alias"], matchId: owner, diff: { [field]: { live: owner, file: r.id } } };
    // The same check the merge makes (B13): an alias that is another customer's or vendor's name.
    const named = aliasNameCheck(str(values.alias), r.id, cx.live.nameOwners ?? new Map());
    if (named) return { state: "refused", values, reasons: [checkReason(named)], matchId: null, diff: null };
    return { state: "ready_create", values, reasons, matchId: null, diff: null };
  }

  if (t === "dies") {
    const key = `${str(values.series).trim().toUpperCase()}|${str(values.sectionCode).trim().toUpperCase()}`;
    const liveRec = cx.live.liveDies?.get(key);
    if (!liveRec) return { state: "ready_create", values, reasons, matchId: null, diff: null };
    const { id, ...fields } = liveRec;
    const { state, diff } = compareLive(values, fields, cx.recipe.onExisting);
    return { state, values, reasons, matchId: id, diff };
  }

  if (t === "die_copies") {
    const sec = sectionOf(values, ids, reasons, cx);
    if (sec) return sec;
    const code = str(values.makerDieNo).trim();
    if (!code) return { state: "ready_create", values, reasons, matchId: null, diff: null };
    const r = pick(resolveCopy(cx.live.copies ?? [], code), cx);
    if (r.kind === "ambiguous") return amb(values, "makerDieNo", r.options, reasons, "ambiguous");
    if (r.kind === "none") return { state: "ready_create", values, reasons, matchId: null, diff: null };
    const { state, diff } = compareLive(values, cx.live.liveCopies?.get(r.id) ?? {}, cx.recipe.onExisting);
    return { state, values, reasons, matchId: r.id, diff };
  }

  if (t === "bundles") {
    const hit = cx.live.legacy?.get(str(values.legacyId).trim());
    if (hit) return { state: "unchanged", values, reasons: ["legacy_mapped"], matchId: hit, diff: null };
    const sec = sectionOf(values, ids, reasons, cx);
    if (sec) return sec;
    return { state: "ready_create", values, reasons, matchId: null, diff: null };
  }

  // orders
  if (cx.answers.ratesLeftOut === true) delete values.rate;
  const line = orderLineGrams(values);
  if (line.mismatch) return amb(values, "bakiKg", [], reasons, "baki_mismatch");
  const r = pick(resolveName(cx.live.customers!, str(values.customer)), cx);
  if (r.kind === "ambiguous") return amb(values, "customer", r.options, reasons, "ambiguous");
  if (r.kind === "match") ids.customer = r.id;
  else if (cx.answers.newCustomers === true) ids.customer = cx.newCustomerRef(str(values.customer));
  else if (cx.answers.newCustomers === false) return { state: "refused", values, reasons: ["not_found:customer"], matchId: null, diff: null };
  else return { state: "ambiguous", values, reasons: [Q_CUSTOMER_NEW], matchId: null, diff: null };
  const sec = sectionOf(values, ids, reasons, cx);
  if (sec) return sec;
  return { state: "ready_create", values, reasons, matchId: null, diff: null };
}

/** Whether every lookup a new record of this target needs came out resolved. */
export function lookupsResolved(target: IngestTarget, values: Values | null): boolean {
  const ids = (values?._ids ?? {}) as Record<string, string>;
  const section = !!ids.sectionCode || values?.legacyDie === true;
  switch (target) {
    case "orders":
      return !!ids.customer && section;
    case "bundles":
    case "die_copies":
      return section;
    case "customer_aliases":
      return !!ids.customer;
    case "vendor_aliases":
      return !!ids.vendor;
    default:
      return true;
  }
}

/**
 * Plan B7 decisions on ambiguous and conflict rows. A decision applies only when it still fits what
 * the re-run found (A11): a row that waits on a question stays waiting, `use_match` needs that record
 * among the row's options, `keep_file` needs a live record, `create_new` needs every lookup resolved.
 * A decision that does not fit leaves the row ambiguous or in conflict, so it still blocks approve.
 */
export function applyDecision(out: RowOutcome, row: Pick<Staged, "decision" | "matchId">, target: IngestTarget): RowOutcome {
  const d = row.decision;
  if (!d) return out;
  if (d === "skip") return { ...out, state: "skipped" };
  if (out.state !== "ambiguous" && out.state !== "conflict") return out;
  if (out.reasons.some((r) => r.startsWith("q:"))) return out;
  // An alias of another customer or vendor is never moved by the merge (the alias adapters refuse
  // any update): only skip or keep orrn's fit. Any other choice stages the row refused (X-new-3).
  if (out.reasons.includes("alias_taken:alias") && d !== "keep_live") return { ...out, state: "refused", matchId: null, diff: null };
  switch (d) {
    case "use_match": {
      const options = ((out.values?._options as { options: { id: string }[] }[] | undefined) ?? []).flatMap((o) => o.options.map((x) => x.id));
      const id = row.matchId ?? out.matchId;
      if (!id || (out.state === "ambiguous" && !options.includes(id)) || !lookupsResolved(target, out.values)) return out;
      return { ...out, state: "ready_update", matchId: id };
    }
    case "keep_file": {
      const id = row.matchId ?? out.matchId;
      if (!id) return out;
      return { ...out, state: "ready_update", matchId: id };
    }
    case "keep_live":
      return { ...out, state: "unchanged" };
    case "create_new":
      if (!lookupsResolved(target, out.values)) return out;
      return { ...out, state: "ready_create", matchId: null };
  }
}

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------

/**
 * The candidate's questions (plan B7): from the recipe, the period, rates and the rows that wait on
 * an answer. `rates_hidden` is asked only of a viewer who cannot see rates (A8, D8).
 */
export async function candidateQuestions(
  ctx: Pick<IngestCtx, "db" | "companyId" | "role">,
  c: CandidateRow,
  artifact: ArtifactRow,
  answerRows?: readonly AnswerRow[],
): Promise<IngestQuestion[]> {
  if (!c.recipe || !c.target) return [];
  const recipe = recipeSchema.safeParse(c.recipe);
  if (!recipe.success) return [];
  const answers =
    answerRows ?? (await ctx.db.select().from(ingestAnswer).where(and(eq(ingestAnswer.companyId, ctx.companyId), eq(ingestAnswer.candidateId, c.id))));
  const byKey = new Map(answers.map((a) => [answerKey(a.questionCode, a.subject), a.answer as unknown]));
  const out: IngestQuestion[] = [];
  // Questions rows still wait on. A row waits only while its question has no answer that settles
  // it, so such a question is open even with an answer stored: an answer naming a unit already
  // tried, a unit past the last re-read, or a PO that is not one of the order's (minor 3).
  const stillWaiting = new Set<string>();
  const add = (code: IngestQuestion["code"], subject: string, params: IngestQuestion["params"]) => {
    const k = answerKey(code, subject);
    out.push({ code, subject, params, answer: byKey.has(k) ? byKey.get(k) : null, open: !byKey.has(k) || stillWaiting.has(k) });
  };
  const r = recipe.data;
  for (const f of r.fields) {
    if (f.steps.some((s) => s.op === "number" && s.unit === null)) add("unit_unknown", f.field, { field: f.field });
  }
  for (const u of r.unclear) {
    if (u.code === "unit_unknown" && !out.some((q) => q.code === "unit_unknown" && q.subject === u.field)) add("unit_unknown", u.field, { field: u.field });
    if (u.code === "date_format_ambiguous") add("date_format_ambiguous", u.field, { field: u.field, sample: "" });
    if (u.code === "column_meaning_unclear") add("column_meaning_unclear", u.field, { name: u.field });
  }
  if (periodRequired(r) && !artifact.periodConfirmed?.asOf) add("period_needed", "", {});
  const me = { company: { role: ctx.role }, isPlatformAdmin: false, platformRole: null };
  if (r.target === "orders" && r.fields.some((f) => f.field === "rate")) {
    // With rates on sales orders off, the merge writes no rate for anyone (B3): the person leaves
    // rates out first, or turns rates on (X-new-3). Asked of everyone, and it blocks approve. A
    // stored "owner merges" from before pricing was turned off does not answer it (minor 2).
    if ((await companyFloor(ctx.db, ctx.companyId)).floor.priceOnSalesOrder !== true) {
      if (byKey.get(answerKey("rates_hidden", "")) === "owner_merges") stillWaiting.add(answerKey("rates_hidden", ""));
      add("rates_hidden", "", { reason: "pricing_off" });
    } else if (!can(me, "order.price")) add("rates_hidden", "", {});
  }

  const waiting = await ctx.db
    .select({
      reasons: ingestStagedRow.reasons,
      magnitude: sql<string | null>`json_extract(${ingestStagedRow.values}, '$._magnitude')`,
      poText: sql<string | null>`nullif(trim(coalesce(json_extract(${ingestStagedRow.values}, '$.poNumber'), '')), '')`,
      oldNo: sql<string | null>`nullif(trim(coalesce(json_extract(${ingestStagedRow.values}, '$.oldOrderNo'), '')), '')`,
      party: sql<string | null>`json_extract(${ingestStagedRow.values}, '$.customer')`,
    })
    .from(ingestStagedRow)
    .where(
      and(
        eq(ingestStagedRow.candidateId, c.id),
        eq(ingestStagedRow.state, "ambiguous"),
        sql`${ingestStagedRow.reasons} like '%"q:%'`,
      ),
    );
  const codes = new Set<string>();
  let newNames = 0;
  // Keyed by subject (field, unit read in, side).
  const flagged = new Map<string, { field: string; unit: string; likelyUnit: string; side: string; count: number }>();
  // Old orders with two POs, by order key: the POs in file order, the order's name, rows waiting.
  const twoPos = new Map<string, { order: string; customer: string; pos: string[]; count: number }>();
  for (const w of waiting) {
    for (const reason of w.reasons ?? []) {
      if (reason.startsWith(`${Q_ORDER_PO}:`)) {
        const subject = reason.slice(Q_ORDER_PO.length + 1);
        const seen = twoPos.get(subject) ?? { order: w.oldNo ?? w.poText ?? "", customer: w.party ?? "", pos: [], count: 0 };
        twoPos.set(subject, seen);
        seen.count += 1;
        if (w.poText && !seen.pos.some((p) => p.toLowerCase() === w.poText!.toLowerCase())) seen.pos.push(w.poText);
        stillWaiting.add(answerKey("order_po", subject));
        continue;
      }
      if (reason.startsWith(`${Q_MAGNITUDE}:`)) stillWaiting.add(answerKey("magnitude_check", reason.slice(Q_MAGNITUDE.length + 1)));
      if (reason.startsWith(`${Q_SECTION_UNKNOWN}:`)) stillWaiting.add(answerKey("create_legacy_die", reason.slice(Q_SECTION_UNKNOWN.length + 1)));
      if (reason === Q_CUSTOMER_NEW) stillWaiting.add(answerKey("new_customers", ""));
      if (reason === Q_CUSTOMER_NEW) newNames += 1;
      else if (reason.startsWith(`${Q_SECTION_UNKNOWN}:`)) codes.add(reason.slice(Q_SECTION_UNKNOWN.length + 1));
      else if (reason.startsWith(`${Q_MAGNITUDE}:`)) {
        const subject = reason.slice(Q_MAGNITUDE.length + 1);
        const { field, unit, side } = parseMagnitudeSubject(subject);
        let note: Partial<MagnitudeNote> | undefined;
        try {
          note = (JSON.parse(w.magnitude ?? "[]") as MagnitudeNote[]).find((n) => magnitudeSubject({ field: n.field, side: n.side }, n.unit) === subject);
        } catch {
          note = undefined;
        }
        const likely = note?.likelyUnit ?? "";
        const seen = flagged.get(subject);
        if (!seen) {
          flagged.set(subject, { field, unit, likelyUnit: likely, side, count: 1 });
          continue;
        }
        seen.count += 1;
        // A unit is offered only when every flagged row of the question points at the same one.
        if (seen.likelyUnit !== likely) seen.likelyUnit = "";
      }
    }
  }
  for (const code of [...codes].sort()) add("create_legacy_die", code, { code });
  // Magnitude checks (C19): one question per field, unit read in and side; still shown once answered.
  for (const a of answers) {
    if (a.questionCode !== "magnitude_check" || flagged.has(a.subject)) continue;
    const { field, unit, side } = parseMagnitudeSubject(a.subject);
    flagged.set(a.subject, { field, unit, likelyUnit: "", side, count: 0 });
  }
  const seesPrices = seesRates(ctx);
  for (const [subject, p] of [...flagged].sort(([x], [y]) => x.localeCompare(y))) {
    // A rate question still blocks approve for a person who may not see rates, but it offers no
    // unit, since that tells the size of the rate. Such a person may not answer it (A8, X-new-2).
    add("magnitude_check", subject, !seesPrices && RATE_FIELDS.includes(p.field) ? { ...p, likelyUnit: "" } : p);
  }
  if (newNames > 0 || byKey.has(answerKey("new_customers", ""))) add("new_customers", "", { count: newNames });
  // One question per old order whose rows carry two different POs (rule 1): pick one, or skip.
  for (const a of answers) {
    if (a.questionCode !== "order_po" || twoPos.has(a.subject)) continue;
    const k = parseOrderKey(a.subject);
    twoPos.set(a.subject, { order: k.no ?? k.po ?? "", customer: "", pos: [], count: 0 });
  }
  for (const [subject, p] of [...twoPos].sort(([x], [y]) => x.localeCompare(y))) {
    add("order_po", subject, { order: p.order, customer: p.customer, pos: p.pos.join(", "), count: p.count });
  }
  return out;
}

/** Drops a candidate's answers that belonged to its old layout (A2). Put it in the batch that changes the layout. */
export function clearLayoutAnswers(ctx: Pick<IngestCtx, "db" | "companyId">, candidateId: string): SqliteBatchItem {
  return ctx.db
    .delete(ingestAnswer)
    .where(
      and(
        eq(ingestAnswer.companyId, ctx.companyId),
        eq(ingestAnswer.candidateId, candidateId),
        inArray(ingestAnswer.questionCode, [...LAYOUT_ANSWER_CODES]),
      ),
    );
}

/**
 * Drops the `magnitude_check` answers of one field. Put it in the batch that changes how the field
 * is read (a unit_unknown answer): those answers were about values the person no longer sees.
 */
export function clearMagnitudeAnswers(ctx: Pick<IngestCtx, "db" | "companyId">, candidateId: string, field: string): SqliteBatchItem {
  return ctx.db
    .delete(ingestAnswer)
    .where(
      and(
        eq(ingestAnswer.companyId, ctx.companyId),
        eq(ingestAnswer.candidateId, candidateId),
        eq(ingestAnswer.questionCode, "magnitude_check"),
        sql`substr(${ingestAnswer.subject}, 1, ${field.length + 1}) = ${`${field}|`}`,
      ),
    );
}

/**
 * Questions that block approve for anyone. rates_hidden depends on who approves, so it is left out,
 * unless rates on sales orders are off for the plant: then nobody may merge the rates.
 */
export function openQuestionCount(questions: readonly IngestQuestion[]): number {
  return questions.filter((q) => q.open && (q.code !== "rates_hidden" || q.params.reason === "pricing_off")).length;
}

/** Ambiguous and conflict rows that wait on a person, not on a question. */
export async function undecidedRows(ctx: Pick<IngestCtx, "db">, candidateId: string): Promise<number> {
  const [row] = await ctx.db
    .select({ n: sql<number>`count(*)` })
    .from(ingestStagedRow)
    .where(
      and(
        eq(ingestStagedRow.candidateId, candidateId),
        inArray(ingestStagedRow.state, ["ambiguous", "conflict"]),
        // A decided row that is still ambiguous or in conflict: its decision did not fit (A11).
        sql`coalesce(${ingestStagedRow.reasons}, '[]') not like '%"q:%'`,
      ),
    );
  return Number(row?.n ?? 0);
}

/** The counts statement: every count from the rows themselves, in the batch that changed them. */
export function recountStatement(ctx: Pick<IngestCtx, "db" | "companyId">, candidateId: string): SqliteBatchItem {
  const n = (state: RowState) =>
    sql`(select count(*) from ingest_staged_row r where r.candidate_id = ${candidateId} and r.state = ${state})`;
  return ctx.db
    .update(ingestCandidate)
    .set({
      rowsTotal: sql`(select count(*) from ingest_staged_row r where r.candidate_id = ${candidateId})`,
      rowsCreate: n("ready_create"),
      rowsUpdate: n("ready_update"),
      rowsUnchanged: n("unchanged"),
      rowsAmbiguous: n("ambiguous"),
      rowsConflict: n("conflict"),
      rowsRefused: n("refused"),
      rowsSkipped: n("skipped"),
      rowsWritten: sql`(select count(*) from ingest_staged_row r where r.candidate_id = ${candidateId} and r.merge_state = 'written')`,
    })
    .where(and(eq(ingestCandidate.id, candidateId), eq(ingestCandidate.companyId, ctx.companyId)));
}

// ---------------------------------------------------------------------------
// Magnitude checks (C19) and the merge's row checks
// ---------------------------------------------------------------------------

/**
 * The subject of a `magnitude_check` question: `<field>|<unit>|<side>`, where unit is the unit the
 * column was read in and side is above or below. The answer is about exactly the rows the person
 * saw: a row read in another unit, or out of range on the other side, waits on its own question.
 */
export const magnitudeSubject = (f: Pick<MagnitudeFlag, "field" | "side">, unit: string | null) => `${f.field}|${unit ?? ""}|${f.side}`;

/** The field, unit and side of a `magnitude_check` subject. */
export function parseMagnitudeSubject(subject: string): { field: string; unit: string; side: string } {
  const [field = "", unit = "", side = ""] = subject.split("|");
  return { field, unit, side };
}

/** What a waiting flag keeps on the row (`values._magnitude`), for the question and the screen. */
export type MagnitudeNote = { field: string; side: MagnitudeFlag["side"]; unit: string | null; likelyUnit: UnitId | null; likelyValue: number | null };

/** Rounds of unit re-reads one row may take (t to kg, then kg to g) before it simply waits. */
const MAGNITUDE_ROUNDS = 3;

/**
 * Settle a row's magnitude flags with the answers (C19). An answer covers the flagged rows of that
 * field read in the same unit and out of range on the same side. "as_is" keeps the value and notes
 * it (`magnitude_confirmed`). A unit reads the cell again in that unit (`magnitude_unit`); the
 * entered text stays as the file had it, and rows of the column that were not flagged keep the unit
 * of the layout. The row read again is checked again: a value still out of range waits on the
 * question for its new unit. A flag with no answer is returned as waiting: the row cannot be ready.
 */
export function settleMagnitude(
  a: ApplyRow,
  raw: readonly string[],
  answers: AnswerSet,
  compileWith: (units: Record<string, UnitId>) => CompiledRecipe,
  keepFlag?: (f: MagnitudeFlag) => boolean,
): { applied: ApplyRow; waiting: MagnitudeFlag[]; notes: string[] } {
  // Flags of fields left out by choice (rates) are dropped on the first read and on every re-read.
  const kept = (x: ApplyRow): ApplyRow => (keepFlag && x.state === "ok" ? { ...x, flags: x.flags.filter(keepFlag) } : x);
  a = kept(a);
  if (a.state !== "ok" || a.flags.length === 0) return { applied: a, waiting: [], notes: [] };
  const units: Record<string, UnitId> = {};
  const notes = new Set<string>();
  const readIn = new Map<string, Set<string>>();
  let cur = a;
  for (let round = 0; ; round += 1) {
    const waiting: MagnitudeFlag[] = [];
    let reread = false;
    for (const f of cur.flags) {
      const seen = cur.entered[f.field]?.unit ?? null;
      const tried = readIn.get(f.field) ?? new Set<string>([seen ?? ""]);
      readIn.set(f.field, tried);
      const answer = answers.magnitude.get(magnitudeSubject(f, seen));
      if (answer === "as_is" || (answer && answer === seen)) notes.add(`magnitude_confirmed:${f.field}`);
      else if (answer && !tried.has(answer) && round < MAGNITUDE_ROUNDS) {
        tried.add(answer);
        units[f.field] = answer as UnitId;
        notes.add(`magnitude_unit:${f.field}`);
        reread = true;
      } else waiting.push(f);
    }
    if (!reread) return { applied: cur, waiting, notes: [...notes] };
    cur = kept(applyRow(compileWith(units), raw, a.rowIndex));
    if (cur.state !== "ok") return { applied: cur, waiting: [], notes: [...notes] };
  }
}

/** A row that waits on `magnitude_check` (C19): ambiguous, with the flag's reason and the question's. */
function holdForMagnitude(out: RowOutcome, waiting: readonly MagnitudeFlag[], entered: Entered): RowOutcome {
  if (waiting.length === 0) return out;
  if (out.state !== "ready_create" && out.state !== "ready_update" && out.state !== "conflict" && out.state !== "ambiguous") return out;
  const notes: MagnitudeNote[] = waiting.map((f) => ({
    field: f.field,
    side: f.side,
    unit: entered[f.field]?.unit ?? null,
    likelyUnit: f.likelyUnit,
    likelyValue: f.likelyValue,
  }));
  if (out.values) out.values._magnitude = notes;
  return {
    ...out,
    state: "ambiguous",
    reasons: [...out.reasons, ...waiting.flatMap((f) => [magnitudeReason(f), `${Q_MAGNITUDE}:${magnitudeSubject(f, entered[f.field]?.unit ?? null)}`])],
  };
}

/**
 * The die copy status the row would write, checked as the merge checks it (B12): a create's status,
 * or an update's new status.
 */
function copyStatusCheck(out: RowOutcome, sections: readonly { id: string; status?: string }[]): RowOutcome {
  const diffStatus = (out.diff as Record<string, { file: unknown }> | null)?.status;
  const status = out.state === "ready_create" ? out.values?.status : out.state === "ready_update" || out.state === "conflict" ? diffStatus?.file : undefined;
  const bad = handStatusCheck(status);
  if (bad) return { ...out, state: "refused", reasons: [...out.reasons, checkReason(bad)] };
  if (out.state !== "ready_create") return out;
  // What dieInstance.create refuses: an archived section, a new copy at nitriding (X-new-3).
  const sectionId = ((out.values?._ids ?? {}) as Record<string, string>).sectionCode;
  const fresh = newCopyCheck(sections.find((x) => x.id === sectionId)?.status, out.values?.status);
  return fresh ? { ...out, state: "refused", reasons: [...out.reasons, checkReason(fresh)] } : out;
}

// ---------------------------------------------------------------------------
// Step
// ---------------------------------------------------------------------------

function cleanValues(applied: Record<string, string | number | null>): Values {
  const out: Values = {};
  for (const [k, v] of Object.entries(applied)) out[k] = v;
  return out;
}

/** Run the recipe over staged rows in memory (no writes): the bot's sample check and tests use it. */
export async function classifyRows(
  ctx: IngestCtx,
  input: { target: IngestTarget; recipe: Recipe; answers: AnswerSet; rows: readonly { rowIndex: number; raw: string[] }[] },
): Promise<{ rowIndex: number; outcome: RowOutcome }[]> {
  const compiled = compileRecipe(input.recipe, applyOptions(input.answers));
  const applied = input.rows.map((r) => ({ r, a: applyRow(compiled, r.raw, r.rowIndex) }));
  const okValues = applied.filter((x) => x.a.state === "ok").map((x) => cleanValues(x.a.values));
  const live = await loadPageLive(ctx, input.target, okValues);
  return applied.map(({ r, a }) => {
    if (a.state === "blank") return { rowIndex: r.rowIndex, outcome: { state: "skipped" as const, values: null, reasons: ["blank_row"], matchId: null, diff: null } };
    if (a.state === "dropped") return { rowIndex: r.rowIndex, outcome: { state: "skipped" as const, values: null, reasons: ["filtered"], matchId: null, diff: null } };
    const values: Values = cleanValues(a.values);
    const entered = a.entered as Entered;
    if (a.state === "refused") {
      return {
        rowIndex: r.rowIndex,
        outcome: { state: "refused" as const, values, entered, reasons: a.refusals.map((f) => `${f.code}${f.field ? `:${f.field}` : ""}`), matchId: null, diff: null },
      };
    }
    const outcome = classifyRow(values, {
      target: input.target,
      recipe: input.recipe,
      live,
      answers: input.answers,
      forced: null,
      newCustomerRef: () => "pending:sample",
    });
    return { rowIndex: r.rowIndex, outcome: { ...outcome, entered } };
  });
}

export async function dryRunStep(ctx: IngestCtx, input: { candidateId: string; expectCursor: number }): Promise<DryRunStepOut> {
  const c = await loadCandidate(ctx, input.candidateId);
  if (c.state !== "processing") {
    throw new TRPCError({ code: "BAD_REQUEST", message: c.state === "ready" ? "This import is already checked" : "This import is not ready to check" });
  }
  if (c.dryCursor !== input.expectCursor) throw new TRPCError({ code: "CONFLICT", message: "Running in another tab" });
  if (!c.target || !c.recipe) throw new TRPCError({ code: "BAD_REQUEST", message: "Pick what this sheet holds first" });
  const recipe = parseRecipe(c.recipe);
  const artifact = await loadArtifact(ctx, c.artifactId);
  const block = await loadBlock(ctx, c.blockId);
  const answerRows = await ctx.db
    .select()
    .from(ingestAnswer)
    .where(and(eq(ingestAnswer.companyId, ctx.companyId), eq(ingestAnswer.candidateId, c.id)));
  const answers = readAnswers(answerRows, artifact, recipe);

  const page = await ctx.db
    .select()
    .from(ingestStagedRow)
    .where(and(eq(ingestStagedRow.candidateId, c.id), gte(ingestStagedRow.rowIndex, input.expectCursor)))
    .orderBy(asc(ingestStagedRow.rowIndex))
    .limit(INGEST_LIMITS.dryRunRowsPerStep);
  const modulesOn = isModuleOn(await companyModules(ctx.db, ctx.companyId), TARGET_MODULE[c.target]);
  const at = now();

  // Derived "new customers" candidate (plan B4): one row per new party name, referenced as pending.
  const derivedRows = new Map<string, { name: string; rowIndex: number }>();
  const pendingRefs = new Map<string, string>();
  const newCustomerRef = (rowIndex: number) => (name: string) => {
    const key = nameKey(name);
    const found = pendingRefs.get(key);
    if (found) return found;
    const ref = `pending:new-customer:${key}`;
    pendingRefs.set(key, ref);
    derivedRows.set(key, { name: name.trim(), rowIndex });
    return ref;
  };

  const editable = page.filter((r) => r.mergeState === "open");
  const outcomes = new Map<string, RowOutcome>();
  if (!modulesOn) {
    for (const r of editable) outcomes.set(r.id, { state: "refused", values: r.values, reasons: ["module_off"], matchId: null, diff: null });
  } else {
    const compiled = compileRecipe(recipe, applyOptions(answers));
    const byUnits = new Map<string, CompiledRecipe>();
    const compileWith = (units: Record<string, UnitId>) => {
      const key = JSON.stringify(Object.entries(units).sort());
      let hit = byUnits.get(key);
      if (!hit) {
        const base = applyOptions(answers);
        hit = compileRecipe(recipe, { ...base, units: { ...base.units, ...units } });
        byUnits.set(key, hit);
      }
      return hit;
    };
    // Rates left out by choice are deleted from the row (classifyRow), so their flags go too (X-new-2).
    const dropRateFlags = c.target === "orders" && answers.ratesLeftOut === true;
    // Every read of a row goes through it, the re-reads of settleMagnitude too (X-new-2).
    const keepFlag = dropRateFlags ? (f: MagnitudeFlag) => !RATE_FIELDS.includes(f.field) : undefined;
    const applied = editable.map((r) => ({ r, ...settleMagnitude(applyRow(compiled, r.raw, r.rowIndex), r.raw, answers, compileWith, keepFlag) }));
    const live = await loadPageLive(
      ctx,
      c.target,
      applied.filter((x) => x.applied.state === "ok").map((x) => cleanValues(x.applied.values)),
    );
    for (const { r, applied: a, waiting, notes } of applied) {
      const keep = (r.reasons ?? []).filter((x) => x === "cell_cut" || x === "row_cut");
      if (a.state === "blank") {
        outcomes.set(r.id, { state: "skipped", values: null, reasons: [...keep, "blank_row"], matchId: null, diff: null });
        continue;
      }
      if (a.state === "dropped") {
        outcomes.set(r.id, { state: "skipped", values: null, reasons: [...keep, "filtered"], matchId: null, diff: null });
        continue;
      }
      const values: Values = cleanValues(a.values);
      const entered = a.entered as Entered;
      if (a.state === "refused") {
        outcomes.set(r.id, {
          state: "refused",
          values,
          entered,
          reasons: [...keep, ...a.refusals.map((f) => `${f.code}${f.field ? `:${f.field}` : ""}`)],
          matchId: null,
          diff: null,
        });
        continue;
      }
      let out = classifyRow(values, {
        target: c.target,
        recipe,
        live,
        answers,
        forced: r.decision === "use_match" ? r.matchId : null,
        newCustomerRef: newCustomerRef(r.rowIndex),
      });
      out = applyDecision(out, r, c.target);
      out = holdForMagnitude(out, waiting, entered);
      if (c.target === "die_copies") out = copyStatusCheck(out, live.sections ?? []);
      out.reasons = [...keep, ...out.reasons, ...notes];
      out.entered = entered;
      const dup = dupKeyOf(c.target, values);
      if (dup) values._dupKey = dup;
      outcomes.set(r.id, out);
    }
    if (c.target === "orders") {
      await matchLiveOrders(ctx, editable, outcomes);
      await orderLineChecks(editable, outcomes);
    }
    await markDuplicates(ctx, c.id, input.expectCursor, editable, outcomes);
  }

  await dryRunHooks.beforeCommit?.();
  const statements: SqliteBatchItem[] = [];
  const last = page.at(-1);
  const nextCursor = last ? last.rowIndex + 1 : input.expectCursor;
  // The step's rows were classified with the answers, layout and decisions read above. A person who
  // changed any of them in between bumped server_seq, so the step must not land (A1).
  statements.push(
    ctx.db
      .update(ingestCandidate)
      .set({ dryCursor: nextCursor, updatedAt: at })
      .where(
        and(
          eq(ingestCandidate.id, c.id),
          eq(ingestCandidate.companyId, ctx.companyId),
          eq(ingestCandidate.dryCursor, input.expectCursor),
          eq(ingestCandidate.serverSeq, c.serverSeq),
          eq(ingestCandidate.state, "processing"),
        ),
      ),
    ingestAbortUnlessChanged(ctx.db),
  );
  // The derived "new customers" list (A12). It changes only while it is ready or held; once approved
  // or merging it is left alone. A run from row 0 rebuilds its open rows, keeping a person's skips.
  const child = c.target === "orders" ? await findNewCustomerChild(ctx, c) : null;
  const childOpen = !child || child.state === "ready" || child.state === "held";
  const keptDecisions = new Map<string, RowDecision>();
  if (child && childOpen && input.expectCursor === 0) {
    const decided = await ctx.db
      .select({ rowKey: ingestStagedRow.rowKey, decision: ingestStagedRow.decision })
      .from(ingestStagedRow)
      .where(and(eq(ingestStagedRow.candidateId, child.id), eq(ingestStagedRow.mergeState, "open"), sql`${ingestStagedRow.decision} is not null`));
    for (const d of decided) if (d.decision) keptDecisions.set(d.rowKey, d.decision);
    statements.push(ctx.db.delete(ingestStagedRow).where(and(eq(ingestStagedRow.candidateId, child.id), eq(ingestStagedRow.mergeState, "open"))));
  }
  if (derivedRows.size > 0) {
    const refMap = new Map<string, string>();
    const keyed = await Promise.all(
      [...derivedRows].map(async ([key, d]) => ({ key, d, rowKey: await sha(`${c.artifactId}|${block.ordinal}|new-customer|${key}`) })),
    );
    if (childOpen) {
      const childId = child?.id ?? (await ensureNewCustomerCandidate(ctx, c, statements));
      // Row indexes past every row the list ever had, so a new name never collides with an old index.
      const [top] = child
        ? await ctx.db.select({ n: sql<number>`coalesce(max(${ingestStagedRow.rowIndex}), -1)` }).from(ingestStagedRow).where(eq(ingestStagedRow.candidateId, child.id))
        : [{ n: -1 }];
      let next = Number(top?.n ?? -1) + 1;
      const inserts = [];
      for (const { key, d, rowKey } of keyed) {
        refMap.set(`pending:new-customer:${key}`, `pending:${rowKey}`);
        const decision = keptDecisions.get(rowKey) ?? null;
        inserts.push({
          id: await stagedRowIdOf(rowKey, "customers"),
          companyId: ctx.companyId,
          rowKey,
          candidateId: childId,
          rowIndex: next++,
          raw: [d.name],
          values: { name: d.name, _ids: {} },
          nameKey: key,
          entered: null,
          state: decision === "skip" ? ("skipped" as const) : ("ready_create" as const),
          reasons: null,
          matchId: null,
          diff: null,
          decision,
          mergeState: "open" as const,
          committedType: null,
          committedId: null,
          updatedAt: at,
        });
      }
      pushChunkedInserts(statements, (part) => ctx.db.insert(ingestStagedRow).values(part).onConflictDoNothing(), inserts);
      if (!child) statements.push(recountStatement(ctx, childId));
    } else {
      // The list is approved or merging: only names already on it can be referenced.
      const present = await mapInChunks(
        keyed.map((k) => k.rowKey),
        (part) =>
          ctx.db
            .select({ rowKey: ingestStagedRow.rowKey })
            .from(ingestStagedRow)
            .where(and(eq(ingestStagedRow.candidateId, child!.id), inArray(ingestStagedRow.rowKey, part), sql`${ingestStagedRow.state} <> 'skipped'`)),
      );
      const have = new Set(present.map((x) => x.rowKey));
      for (const { key, rowKey } of keyed) if (have.has(rowKey)) refMap.set(`pending:new-customer:${key}`, `pending:${rowKey}`);
    }
    for (const out of outcomes.values()) {
      const ids = (out.values?._ids ?? null) as Record<string, string> | null;
      if (!ids?.customer?.startsWith("pending:new-customer:")) continue;
      const ref = refMap.get(ids.customer);
      if (ref) ids.customer = ref;
      else {
        delete ids.customer;
        out.state = "refused";
        out.reasons = [...out.reasons, "not_found:customer"];
      }
    }
  }
  if (child && childOpen) statements.push(recountStatement(ctx, child.id));

  for (const r of editable) {
    const out = outcomes.get(r.id)!;
    const order = c.target === "orders" ? identityOf(r, out) : null;
    statements.push(
      ctx.db
        .update(ingestStagedRow)
        .set({
          state: out.state,
          values: out.values,
          entered: out.entered && Object.keys(out.entered).length ? out.entered : null,
          reasons: out.reasons.length ? out.reasons : null,
          matchId: r.decision === "use_match" ? r.matchId : out.matchId,
          diff: out.diff,
          orderKey: order?.key ?? null,
          poKey: order ? poKeyOf(order.customer, order.po) : null,
          nameKey: c.target === "customers" ? nameKey(str(out.values?.name)) || null : null,
          updatedAt: at,
        })
        .where(and(eq(ingestStagedRow.id, r.id), eq(ingestStagedRow.candidateId, c.id), eq(ingestStagedRow.mergeState, "open"))),
    );
  }
  statements.push(recountStatement(ctx, c.id));
  try {
    await guardedBatch(ctx.db, statements, { code: "CONFLICT", message: "Running in another tab" });
  } catch (e) {
    // A person changed the candidate during the step: nothing landed. When it is still being checked,
    // answer with its new cursor so the pump goes on from there with the new answers.
    const now2 = await loadCandidate(ctx, c.id);
    if (now2.serverSeq !== c.serverSeq && now2.state === "processing") return stepOut(now2, false);
    throw e;
  }

  // Done when the file is read, every row is put and the cursor passed the last row.
  const fresh = await loadCandidate(ctx, c.id);
  const allPut = artifact.readState === "read" && block.rowsPut === block.rowCount;
  const done = allPut && page.length < INGEST_LIMITS.dryRunRowsPerStep;
  if (done) {
    // Whole old orders (rule 1), checked as the merge planner checks them (X-new-3). They land
    // first, so the questions and choices counted below see them.
    const groups = c.target === "orders" ? await orderPassStatements(ctx, c, { fileName: artifact.fileName, sheetName: block.sheetName }, answers, at) : [];
    // At most ORDER_PASS_BATCH statements a batch (rule 4.4), each batch behind the same guard. A
    // person who changes the candidate in between stops the rest; the pass runs again from its rows.
    const parts = chunk(groups, ORDER_PASS_BATCH);
    for (const [i, part] of parts.entries()) {
      try {
        await guardedBatch(ctx.db, [
          ctx.db
            .update(ingestCandidate)
            .set({ updatedAt: now() })
            .where(and(eq(ingestCandidate.id, c.id), eq(ingestCandidate.serverSeq, c.serverSeq), eq(ingestCandidate.dryCursor, nextCursor), eq(ingestCandidate.state, "processing"))),
          ingestAbortUnlessChanged(ctx.db),
          ...part,
          ...(i === parts.length - 1 ? [recountStatement(ctx, c.id)] : []),
        ]);
      } catch (e) {
        const now2 = await loadCandidate(ctx, c.id);
        if (now2.serverSeq !== c.serverSeq && now2.state === "processing") return stepOut(now2, false);
        throw e;
      }
    }
    const questions = await candidateQuestions(ctx, fresh, artifact);
    const open = openQuestionCount(questions) + (await undecidedRows(ctx, c.id));
    try {
      await guardedBatch(ctx.db, [
        ctx.db
          .update(ingestCandidate)
          .set({ state: "ready", openQuestions: open, serverSeq: c.serverSeq + 1, updatedAt: now() })
          .where(
            and(
              eq(ingestCandidate.id, c.id),
              eq(ingestCandidate.companyId, ctx.companyId),
              eq(ingestCandidate.serverSeq, c.serverSeq),
              eq(ingestCandidate.dryCursor, nextCursor),
              eq(ingestCandidate.state, "processing"),
            ),
          ),
        ingestAbortUnlessChanged(ctx.db),
      ]);
    } catch (e) {
      const now2 = await loadCandidate(ctx, c.id);
      if (now2.serverSeq !== c.serverSeq && now2.state === "processing") return stepOut(now2, false);
      throw e;
    }
    // The sheet's values are parsed now: guess the period again with them (A24).
    if (c.target === "orders" || c.target === "bundles") await refreshArtifactPeriod(ctx, artifact);
    // New sections or customers other sheets were refused for: those sheets check again (rule 2).
    if (c.target === "dies" || c.target === "customers") {
      const again = await dependentsAgain(ctx, c, now());
      if (again.length) await ctx.db.batch(again as never);
    }
  }
  return stepOut(await loadCandidate(ctx, c.id), done);
}

/** Test seam: runs after the step read everything and before it writes (A1). */
export const dryRunHooks: { beforeCommit?: () => Promise<void> } = {};

function stepOut(final: CandidateRow, done: boolean): DryRunStepOut {
  return {
    cursor: final.dryCursor,
    done,
    state: final.state,
    counts: {
      total: final.rowsTotal,
      create: final.rowsCreate,
      update: final.rowsUpdate,
      unchanged: final.rowsUnchanged,
      ambiguous: final.rowsAmbiguous,
      conflict: final.rowsConflict,
      refused: final.rowsRefused,
      skipped: final.rowsSkipped,
      written: final.rowsWritten,
    },
  };
}

async function sha(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function findNewCustomerChild(ctx: IngestCtx, parent: CandidateRow): Promise<{ id: string; state: CandidateRow["state"] } | null> {
  const [existing] = await ctx.db
    .select({ id: ingestCandidate.id, state: ingestCandidate.state })
    .from(ingestCandidate)
    .where(and(eq(ingestCandidate.companyId, ctx.companyId), eq(ingestCandidate.parentId, parent.id), eq(ingestCandidate.target, "customers")))
    .limit(1);
  return existing ?? null;
}

/** The derived `customers` candidate of an orders candidate, made on first need (in `statements`). */
async function ensureNewCustomerCandidate(ctx: IngestCtx, parent: CandidateRow, statements: SqliteBatchItem[]): Promise<string> {
  const existing = await findNewCustomerChild(ctx, parent);
  if (existing) return existing.id;
  const id = createId();
  statements.push(
    ctx.db.insert(ingestCandidate).values({
      id,
      companyId: ctx.companyId,
      artifactId: parent.artifactId,
      blockId: parent.blockId,
      parentId: parent.id,
      target: "customers",
      holeRef: "derived:new_customers",
      recipe: null,
      fit: "manual",
      state: "ready",
    }),
  );
  return id;
}

/** The old order of a classified order row (orderid.ts), or null while its customer is open. */
function identityOf(r: Pick<Staged, "rowKey">, out: RowOutcome): OrderIdentity | null {
  if (!out.values) return null;
  const ids = (out.values._ids ?? {}) as Record<string, string>;
  return ids.customer ? orderIdentityOf(out.values, r.rowKey) : null;
}

/**
 * Orders already in orrn (rule 1, against live data): a ready order line whose old order
 * (orderid.ts) is a live order is that order. By number: the same customer and financial year, a
 * note that names the number, not closed or cancelled. Else by the row's PO: the same customer and
 * PO, not cancelled, as the order screens refuse a PO twice. With no date column the order date is
 * the file's as-of date, so the year is the period's. Anything else is a new order.
 *
 * A matched line is unchanged only when the live order has a line for the same section and cut
 * length (any cut length when the file has none). Any other line of a matched order is a conflict
 * with `order_line_new`, so a person decides; it is never dropped silently (A-new-1).
 */
async function matchLiveOrders(ctx: IngestCtx, rows: readonly Staged[], outcomes: Map<string, RowOutcome>): Promise<void> {
  const open = rows
    .map((r) => ({ r, out: outcomes.get(r.id)! }))
    .filter(({ out }) => out.state === "ready_create" && out.values)
    .map((x) => ({ ...x, id: identityOf(x.r, x.out) }))
    .filter((x): x is typeof x & { id: OrderIdentity } => !!x.id && x.id.kind !== "row");
  const live = await liveOrdersOf(
    ctx,
    open.map(({ id }) => ({ key: id.key, customerId: id.customer, fy: id.fy, no: id.no, po: id.po })),
  );
  const hits = open.filter(({ id }) => live.has(id.key)).map((x) => ({ ...x, orderId: live.get(x.id.key)!.id }));
  if (hits.length === 0) return;
  const lines = await mapInChunks([...new Set(hits.map((h) => h.orderId))], (part) =>
    ctx.db
      .select({ orderId: salesOrderLine.salesOrderId, dieId: salesOrderLine.dieId, cutLengthMm: salesOrderLine.cutLengthMm })
      .from(salesOrderLine)
      .where(and(eq(salesOrderLine.companyId, ctx.companyId), inArray(salesOrderLine.salesOrderId, part))),
  );
  const onOrder = (orderId: string, v: Values) => {
    const dieId = ((v._ids ?? {}) as Record<string, string>).sectionCode ?? "";
    if (!dieId || dieId.startsWith("pending:")) return false;
    const cut = v.cutLength === null || v.cutLength === undefined || v.cutLength === "" ? null : Number(v.cutLength);
    return lines.some((l) => l.orderId === orderId && l.dieId === dieId && (cut === null || l.cutLengthMm === cut));
  };
  for (const { r, out, orderId, id } of hits) {
    out.matchId = orderId;
    // A numbered old order whose PO is on a live order an import made for another old order: one
    // PO on two orders (rule 4.2). It is not a line of that order. The person skips the rows.
    const hit = live.get(id.key)!;
    if (id.kind === "no" && hit.by === "po" && hit.oldKey && hit.oldKey !== liveOrderKey(id.customer, id.fy, id.no ?? "")) {
      out.state = r.decision === "keep_live" ? "unchanged" : "conflict";
      out.reasons = [...out.reasons, PO_ON_LIVE_ORDER];
      continue;
    }
    if (onOrder(orderId, out.values!)) {
      out.state = "unchanged";
      out.reasons = [...out.reasons, "order_exists"];
      continue;
    }
    out.state = "conflict";
    out.reasons = [...out.reasons, "order_line_new"];
    // The person's choice for this line: leave it out (keep_live). Skip is applied before this.
    if (r.decision === "keep_live") out.state = "unchanged";
  }
}

/**
 * The order lines the merge would refuse (B11), refused here first with the same check: no weight,
 * nothing left to dispatch, no cut length, or anything the order screen refuses. Only lines the merge
 * would write are checked; a line already on a live order writes nothing.
 */
async function orderLineChecks(rows: readonly Staged[], outcomes: Map<string, RowOutcome>): Promise<void> {
  const schema = await loadOrderLineSchema();
  for (const r of rows) {
    const out = outcomes.get(r.id)!;
    if (out.state !== "ready_create" && out.state !== "ready_update") continue;
    // A rate is checked as if it will be written; any id passes the section here, as in the planner.
    const check = orderLineCheck(schema, out.values ?? {}, "section", true);
    if (check.problem) outcomes.set(r.id, { ...out, state: "refused", reasons: [...out.reasons, checkReason(check.problem)], diff: null });
  }
}

/** Statements of the whole-order pass sent in one batch, with its guard: under the 400 of rule 4.4. */
export const ORDER_PASS_BATCH = 396;

/** A numbered old order whose PO is on a live order of another old order (rule 4.2). */
const PO_ON_LIVE_ORDER = "po_on_live_order:poNumber";

/** Row reasons the whole-order pass sets; a row with one of them was ready before that pass. */
const ORDER_PASS_REASONS = [...ORDER_GROUP_CODES.map((c) => `${c}:`), "order_in_other_file:", `${Q_ORDER_PO}:`, "order_po_skipped", "order_live:"];
const isOrderPassReason = (r: string) => ORDER_PASS_REASONS.some((p) => r === p || r.startsWith(p));

type OrderPassRow = {
  id: string;
  rowIndex: number;
  state: RowState;
  reasons: string[] | null;
  decision: RowDecision | null;
  matchId: string | null;
  orderKey: string | null;
  po: string | null;
  poText: string | null;
  orderDate: string | null;
  oldNo: string | null;
  other: string | null;
};

/**
 * What the pass wants for one row. Nothing in it is per order, so rows of many orders share one
 * statement (S3-2): the `order_po` reason is built from the row's own `order_key`, a live order's id
 * is read from the order's matched row, and a PO picked for an order is read from its answer.
 * `matchId`: "keep" leaves it, null clears it, "live" takes the order's live match.
 */
type OrderWant = {
  state: RowState;
  reasons: string[];
  /** Add `q:order_po:<order_key>` to the reasons. */
  askPo?: boolean;
  matchId?: "keep" | "live" | null;
  /** The live order id `matchId: "live"` means, known here for the "nothing changes" test only. */
  liveId?: string | null;
  /** Every row of the order takes the PO picked in the `order_po` answer. */
  fillPicked?: boolean;
  other?: Record<string, unknown> | null;
};

/**
 * Whole old orders (rule 1), once every row of the candidate is checked, because one order may span
 * pages. First the sheet decides which order a row with no number belongs to (`sheetOrderKeys`).
 * Then for each order key (orderid.ts), over rows that were ready before this pass:
 * - two different POs wait on the `order_po` question (`q:order_po:<key>`); its answer picks the PO
 *   for every row, or skips the order (`order_po_skipped`). With one PO, nothing is written: the
 *   planner and the merge take the order's PO over its rows (`orderPoOf`);
 * - an order the merge planner would hold (above 100 lines, one PO on two dates with no number) is
 *   refused, as the planner holds it (`orderGroupCheck`);
 * - when another row of the order is on a live order, the row is a line that order does not have:
 *   `order_line_new` with that order (`order_live:order`);
 * - when another file or sheet of the plant holds rows of the same order, the rows of both are a
 *   conflict naming the other one (`order_in_other_file:order`, `values._otherFile`). A row the person
 *   kept (keep_file) stays ready; the planner holds the later candidate if both are kept.
 * A row this pass changed before goes back to ready when its order passes now. The statements are
 * bounded by the rows, never by the orders: at most one per 30 keys moved and one per 90 rows that
 * end the same way (S3-2).
 */
async function orderPassStatements(
  ctx: IngestCtx,
  c: CandidateRow,
  names: { fileName: string; sheetName: string | null },
  answers: AnswerSet,
  at: Date,
): Promise<SqliteBatchItem[]> {
  const V = ingestStagedRow.values;
  const passLike = or(...ORDER_PASS_REASONS.map((p) => sql`${ingestStagedRow.reasons} like ${`%"${p}%`}`));
  const rows: OrderPassRow[] = await ctx.db
    .select({
      id: ingestStagedRow.id,
      rowIndex: ingestStagedRow.rowIndex,
      state: ingestStagedRow.state,
      reasons: ingestStagedRow.reasons,
      decision: ingestStagedRow.decision,
      matchId: ingestStagedRow.matchId,
      orderKey: ingestStagedRow.orderKey,
      po: sql<string | null>`nullif(lower(trim(coalesce(json_extract(${V}, '$.poNumber'), ''))), '')`,
      poText: sql<string | null>`nullif(trim(coalesce(json_extract(${V}, '$.poNumber'), '')), '')`,
      orderDate: sql<string | null>`json_extract(${V}, '$.orderDate')`,
      oldNo: sql<string | null>`nullif(trim(coalesce(json_extract(${V}, '$.oldOrderNo'), '')), '')`,
      other: sql<string | null>`json_extract(${V}, '$._otherFile')`,
    })
    .from(ingestStagedRow)
    .where(
      and(
        eq(ingestStagedRow.candidateId, c.id),
        eq(ingestStagedRow.mergeState, "open"),
        sql`${ingestStagedRow.orderKey} is not null`,
        or(inArray(ingestStagedRow.state, ["ready_create", "unchanged", "conflict", "ambiguous"]), passLike),
      ),
    )
    .orderBy(asc(ingestStagedRow.rowIndex));
  // Each row as the page pass left it, before this pass.
  const base = rows.map((r) => {
    const reasons = r.reasons ?? [];
    const had = reasons.some(isOrderPassReason);
    const wasLive = reasons.some((x) => x.startsWith("order_live:"));
    return {
      r,
      key: r.orderKey!,
      had,
      state: had ? ("ready_create" as RowState) : r.state,
      reasons: had ? reasons.filter((x) => !isOrderPassReason(x) && !(wasLive && (x === "order_line_new" || x === PO_ON_LIVE_ORDER))) : reasons,
      matchId: wasLive ? null : r.matchId,
    };
  });
  type Base = (typeof base)[number];
  const counted = base.filter((b) => b.state !== "refused" && b.state !== "skipped");
  // The sheet decides which order a row with no order number belongs to (S3-1), in its year (4.2).
  const posByKey = new Map<string, { pos: (string | null)[]; dates: (string | null)[] }>();
  for (const b of counted) {
    const g = posByKey.get(b.key) ?? { pos: [], dates: [] };
    g.pos.push(b.r.po);
    g.dates.push(b.r.orderDate);
    posByKey.set(b.key, g);
  }
  const sheet = sheetOrderKeys([...posByKey].map(([key, g]) => ({ key, pos: g.pos, fy: groupFyOf(g.dates) })));
  // The rows whose stored key moves, by row id, so the statements find them by primary key (S4-2).
  const moved: { id: string; to: string }[] = [];
  for (const b of base) {
    b.key = sheet.remap.get(b.key) ?? b.key;
    if (b.key !== b.r.orderKey) moved.push({ id: b.r.id, to: b.key });
  }
  const byKey = new Map<string, Base[]>();
  for (const b of counted) {
    const list = byKey.get(b.key);
    if (list) list.push(b);
    else byKey.set(b.key, [b]);
  }
  const want = new Map<string, OrderWant>();
  const toOtherCheck: { key: string; ready: Base[]; poKey: string | null; fy: string }[] = [];
  // The PO an order has, or the PO picked for it, before PO checks.
  const pickedPo = (key: string, list: readonly Base[]): string | null => {
    const po = orderPoOf(list.map((b) => b.r));
    const answer = answers.orderPo.get(key);
    if (po.all.length <= 1) return po.poText;
    return answer && answer !== "skip" ? (po.all.find((p) => p.toLowerCase() === answer.po.trim().toLowerCase()) ?? null) : null;
  };
  const twice = poTwiceCheck(
    [...byKey].map(([key, list]) => {
      const p = pickedPo(key, list);
      return { key, list: list.map((b) => ({ rowIndex: b.r.rowIndex, po: p?.toLowerCase() ?? null, poText: p, orderDate: b.r.orderDate, oldNo: b.r.oldNo })) };
    }),
  );
  for (const [key, list] of byKey) {
    const ready = list.filter((b) => b.state === "ready_create");
    if (sheet.unclear.has(key)) {
      for (const b of ready) want.set(b.r.id, { state: "refused", reasons: [...b.reasons, checkReason(ORDER_NO_UNCLEAR)] });
      continue;
    }
    const po = orderPoOf(list.map((b) => b.r));
    const answer = answers.orderPo.get(key);
    let picked = po.poText;
    let skip = false;
    let waits = false;
    if (po.all.length > 1) {
      const fits = answer && answer !== "skip" ? po.all.find((p) => p.toLowerCase() === answer.po.trim().toLowerCase()) : undefined;
      if (answer === "skip") skip = true;
      else if (fits) picked = fits;
      else waits = true;
    }
    // An order of two POs takes the PO picked for it on every row; with one PO nothing is written.
    const fill = po.all.length > 1 && !waits && !skip ? { fillPicked: true } : {};
    if (waits || skip) {
      for (const b of ready) {
        want.set(b.r.id, waits ? { state: "ambiguous", reasons: b.reasons, askPo: true } : { state: "skipped", reasons: [...b.reasons, "order_po_skipped"] });
      }
      continue;
    }
    const lowPicked = picked?.toLowerCase() ?? null;
    const kind = parseOrderKey(key).kind;
    const problem = orderGroupCheck(list.map((b) => ({ rowIndex: b.r.rowIndex, po: lowPicked, poText: picked, orderDate: b.r.orderDate, oldNo: b.r.oldNo })), kind);
    if (problem) {
      for (const b of ready) want.set(b.r.id, { state: "refused", reasons: [...b.reasons, checkReason(problem)], ...fill });
      for (const b of list) if (b.state !== "ready_create") want.set(b.r.id, { state: b.state, reasons: b.reasons, ...fill });
      continue;
    }
    for (const b of list) if (b.state !== "ready_create") want.set(b.r.id, { state: b.state, reasons: b.reasons, ...fill });
    // One PO on two old orders of this sheet: a conflict on every one of them, so nothing of either
    // is written until a person skips the rows of one (rule 4.2). Keeping both cannot work.
    const clash = twice.get(key);
    if (clash) {
      for (const b of ready) want.set(b.r.id, { state: b.r.decision === "skip" ? "skipped" : "conflict", reasons: [...b.reasons, checkReason(clash)], ...fill });
      continue;
    }
    // A row of the order whose PO is on a live order of another old order: every line of the order.
    if (list.some((b) => b.reasons.includes(PO_ON_LIVE_ORDER))) {
      for (const b of ready) {
        want.set(b.r.id, { state: b.r.decision === "keep_live" ? "unchanged" : "conflict", reasons: [...b.reasons, PO_ON_LIVE_ORDER, "order_live:po"], ...fill });
      }
      continue;
    }
    // One old order is one sales order: a live order any row of it is on is the order of every row.
    const liveId = list.find((b) => b.matchId && (b.reasons.includes("order_exists") || b.reasons.includes("order_line_new")))?.matchId ?? null;
    if (liveId) {
      for (const b of ready) {
        want.set(b.r.id, {
          state: b.r.decision === "keep_live" ? "unchanged" : "conflict",
          reasons: [...b.reasons, "order_line_new", "order_live:order"],
          matchId: "live",
          liveId,
          ...fill,
        });
      }
      continue;
    }
    for (const b of ready) want.set(b.r.id, { state: "ready_create", reasons: b.reasons, ...fill });
    if (ready.length) {
      const k = parseOrderKey(key);
      toOtherCheck.push({ key, ready, poKey: poKeyOf(k.customer, picked), fy: k.kind === "no" ? k.fy : groupFyOf(list.map((b) => b.r.orderDate)) });
    }
  }
  // The same old order, or another old order with the same PO, in another file or sheet of the
  // plant: both keys are compared (rule 4.2).
  const holders = await otherFileHolders(ctx, c.id, toOtherCheck);
  const out: SqliteBatchItem[] = [];
  const otherRows = new Map<string, { candidateId: string; reason: string; rowIds: string[] }>();
  const reasonOf = (why: "order" | "po") => (why === "order" ? "order_in_other_file:order" : "po_on_two_orders:poNumber");
  for (const { key, ready } of toOtherCheck) {
    const hs = holders.get(key);
    if (!hs?.length) continue;
    const h = hs[0]!;
    for (const b of ready) {
      if (b.r.decision === "keep_file") continue;
      const w = want.get(b.r.id)!;
      want.set(b.r.id, { ...w, state: "conflict", reasons: [...w.reasons, reasonOf(h.why)], other: { candidateId: h.candidateId, fileName: h.fileName, sheetName: h.sheetName } });
    }
    // The other candidate's rows of that order, while a person may still change them.
    for (const o of hs) {
      if (o.candidateState !== "ready" && o.candidateState !== "held") continue;
      const ids = o.rows.filter((x) => !x.written && x.state === "ready_create" && x.decision !== "keep_file").map((x) => x.id);
      if (!ids.length) continue;
      const at2 = `${o.candidateId}|${o.why}`;
      const e = otherRows.get(at2) ?? { candidateId: o.candidateId, reason: reasonOf(o.why), rowIds: [] };
      e.rowIds.push(...ids);
      otherRows.set(at2, e);
    }
  }
  const R = ingestStagedRow;
  // Rows with no order number that the sheet placed in a numbered order, by primary key: 30 rows a
  // statement. The unary plus keeps SQLite on the primary key, never on the candidate index (S4-2).
  for (const part of chunk(moved, 30)) {
    out.push(
      ctx.db
        .update(R)
        .set({
          orderKey: sql`case ${R.id} ${sql.join(
            part.map((m) => sql`when ${m.id} then ${m.to}`),
            sql` `,
          )} else ${R.orderKey} end`,
          updatedAt: at,
        })
        .where(and(inArray(R.id, part.map((m) => m.id)), sql`+${R.candidateId} = ${c.id}`, sql`+${R.mergeState} = 'open'`)),
    );
  }
  // This candidate's rows: one statement per 90 rows that end the same way. Nothing in the way a
  // row ends names its order, so the count follows the rows, not the orders (S3-2).
  const groups = new Map<string, { w: OrderWant; ids: string[] }>();
  for (const b of base) {
    const w: OrderWant | null = want.get(b.r.id) ?? (b.had ? { state: b.state, reasons: b.reasons, matchId: b.matchId === b.r.matchId ? "keep" : null } : null);
    if (!w) continue;
    const wasOther = b.r.other !== null;
    const other = w.other ?? null;
    const reasonsNow = w.askPo ? [...w.reasons, `${Q_ORDER_PO}:${b.key}`] : w.reasons;
    const sameReasons = JSON.stringify(reasonsNow) === JSON.stringify(b.r.reasons ?? []);
    const matchMode = w.matchId === undefined ? "keep" : w.matchId;
    const matchNow = matchMode === "keep" ? b.r.matchId : matchMode === "live" ? (w.liveId ?? null) : null;
    if (w.state === b.r.state && sameReasons && matchNow === b.r.matchId && !w.fillPicked && !wasOther && !other) continue;
    const sig = JSON.stringify([w.state, w.reasons, !!w.askPo, matchMode, !!w.fillPicked, other, wasOther]);
    const g = groups.get(sig) ?? { w: { ...w, matchId: matchMode, other }, ids: [] };
    g.ids.push(b.r.id);
    groups.set(sig, g);
  }
  for (const { w, ids } of groups.values()) {
    for (const part of chunk(ids, 90)) {
      let values: SQL = sql`${R.values}`;
      let poKey: SQL | null = null;
      if (w.fillPicked) {
        // The PO picked for the order, from its answer (the answer was checked against the order's POs).
        const picked = sql`(select trim(json_extract(a.answer, '$.po')) from ingest_answer a where a.candidate_id = ${c.id} and a.question_code = 'order_po' and a.subject = ${R.orderKey})`;
        values = sql`json_set(${values}, '$.poNumber', coalesce(${picked}, json_extract(${R.values}, '$.poNumber')))`;
        // A row that had a PO now has the picked one; its customer part stays.
        poKey = sql`case when ${R.poKey} is null or ${picked} is null then ${R.poKey} else substr(${R.poKey}, 1, instr(${R.poKey}, char(31))) || lower(${picked}) end`;
      }
      values = w.other ? sql`json_set(${values}, '$._otherFile', json(${JSON.stringify(w.other)}))` : sql`json_remove(${values}, '$._otherFile')`;
      const reasons = w.askPo
        ? sql`json_insert(${JSON.stringify(w.reasons)}, '$[#]', ${`${Q_ORDER_PO}:`} || ${R.orderKey})`
        : w.reasons.length
          ? sql`${JSON.stringify(w.reasons)}`
          : sql`null`;
      // The live order of the order: the id on its row the page pass matched to a live order. Read
      // on the order key index, never the candidate index (S4-2).
      const live = sql`(select s2.match_id from ingest_staged_row s2 where s2.company_id = ${ctx.companyId} and s2.order_key = ${R.orderKey} and +s2.candidate_id = ${c.id} and s2.merge_state = 'open' and s2.state not in ('refused', 'skipped') and s2.match_id is not null and (s2.reasons like '%"order_exists"%' or s2.reasons like '%"order_line_new"%') and s2.reasons not like '%"order_live:%' order by s2.row_index limit 1)`;
      out.push(
        ctx.db
          .update(R)
          .set({
            state: w.state,
            reasons: reasons as never,
            ...(w.matchId === "live" ? { matchId: live as never } : w.matchId === null ? { matchId: null } : {}),
            values: values as never,
            ...(poKey ? { poKey: poKey as never } : {}),
            updatedAt: at,
          })
          .where(and(inArray(R.id, part), sql`+${R.candidateId} = ${c.id}`, sql`+${R.mergeState} = 'open'`)),
      );
    }
  }
  // The other candidates: their rows of the order turn into the same conflict, naming this sheet.
  const mine = JSON.stringify({ candidateId: c.id, fileName: names.fileName, sheetName: names.sheetName });
  for (const { candidateId, reason, rowIds } of otherRows.values()) {
    for (const part of chunk(rowIds, 90)) {
      out.push(
        ctx.db
          .update(R)
          .set({
            state: "conflict",
            reasons: sql`json_insert(coalesce(${R.reasons}, '[]'), '$[#]', ${reason})` as never,
            values: sql`json_set(${R.values}, '$._otherFile', json(${mine}))` as never,
            updatedAt: at,
          })
          // By primary key: the unary plus keeps SQLite off the candidate and state index (S4-2).
          .where(and(inArray(R.id, part), sql`+${R.candidateId} = ${candidateId}`, sql`+${R.mergeState} = 'open'`, sql`+${R.state} = 'ready_create'`)),
      );
    }
    // Its counts and its open choices change with its rows; a screen open on it must read again.
    out.push(
      ctx.db
        .update(ingestCandidate)
        .set({ openQuestions: sql`${ingestCandidate.openQuestions} + ${rowIds.length}`, serverSeq: sql`${ingestCandidate.serverSeq} + 1`, updatedAt: at })
        .where(and(eq(ingestCandidate.id, candidateId), eq(ingestCandidate.companyId, ctx.companyId), inArray(ingestCandidate.state, ["ready", "held"]))),
      recountStatement(ctx, candidateId),
    );
  }
  return out;
}

/**
 * In-file duplicates (plan B7): a second row with the same key and the same values is skipped; with
 * different values it is refused. Earlier pages are read by key, chunked.
 */
async function markDuplicates(
  ctx: IngestCtx,
  candidateId: string,
  cursor: number,
  rows: readonly Staged[],
  outcomes: Map<string, RowOutcome>,
): Promise<void> {
  const keyed = rows
    .map((r) => ({ r, out: outcomes.get(r.id)! }))
    .filter((x) => typeof x.out.values?._dupKey === "string" && x.out.state !== "refused" && x.out.state !== "skipped");
  if (keyed.length === 0) return;
  const keys = [...new Set(keyed.map((x) => x.out.values!._dupKey as string))];
  const earlier = await mapInChunks(keys, (part) =>
    ctx.db
      .select({ values: ingestStagedRow.values, rowIndex: ingestStagedRow.rowIndex })
      .from(ingestStagedRow)
      .where(
        and(
          eq(ingestStagedRow.candidateId, candidateId),
          lt(ingestStagedRow.rowIndex, cursor),
          inArray(ingestStagedRow.state, ["ready_create", "ready_update", "unchanged", "ambiguous", "conflict"]),
          inArray(sql<string>`json_extract(${ingestStagedRow.values}, '$._dupKey')`, part),
        ),
      ),
  );
  const firstByKey = new Map<string, Values>();
  for (const e of earlier.sort((a, b) => a.rowIndex - b.rowIndex)) {
    const k = (e.values as Values | null)?._dupKey as string;
    if (k && !firstByKey.has(k)) firstByKey.set(k, e.values as Values);
  }
  const fields = (v: Values) => JSON.stringify(Object.entries(v).filter(([k]) => !k.startsWith("_")).sort(([a], [b]) => a.localeCompare(b)));
  for (const { r, out } of keyed) {
    const k = out.values!._dupKey as string;
    const first = firstByKey.get(k);
    if (!first) {
      firstByKey.set(k, out.values!);
      continue;
    }
    const identical = fields(first) === fields(out.values!);
    outcomes.set(r.id, {
      ...out,
      state: identical ? "skipped" : "refused",
      reasons: [...out.reasons, identical ? "in_file_duplicate_same" : "in_file_duplicate"],
      diff: null,
    });
  }
}
