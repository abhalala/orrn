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
import { and, asc, eq, gte, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";

import { customer, customerAlias, die, dieInstance, salesOrder, salesOrderLine, vendor, vendorAlias } from "@orrn/db/schema";
import {
  ingestAnswer,
  ingestCandidate,
  ingestStagedRow,
  type IngestTarget,
  type RowDecision,
  type RowState,
} from "@orrn/db/schema/ingest";

import { mapInChunks, pushChunkedInserts, type SqliteBatchItem } from "../atomic";
import { now } from "../clock";
import { createId } from "../id";
import { companyModules } from "../moduleGate";
import { can } from "../permissions";
import { nameKey } from "../purchase";
import { fyOfDate, stagedRowIdOf } from "./artifacts";
import {
  aliasNameCheck,
  aliasNameOwners,
  checkReason,
  handStatusCheck,
  loadOrderLineSchema,
  newCopyCheck,
  ORDER_GROUP_CODES,
  ORDER_GROUP_SQL,
  orderGroupCheck,
  orderLineCheck,
  type NameOwner,
} from "./merge/rowchecks";
import { companyFloor } from "../orderLines";
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
    const byCode = (cx.live.pendingSections ?? []).filter((x) => x.code === code.toUpperCase());
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
    const r = pick(resolveName(index, str(values[field])), cx);
    if (r.kind === "ambiguous") return amb(values, field, r.options, reasons, "ambiguous");
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
  const add = (code: IngestQuestion["code"], subject: string, params: IngestQuestion["params"]) => {
    const k = answerKey(code, subject);
    out.push({ code, subject, params, answer: byKey.has(k) ? byKey.get(k) : null, open: !byKey.has(k) });
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
    // rates out first, or turns rates on (X-new-3). Asked of everyone, and it blocks approve.
    if ((await companyFloor(ctx.db, ctx.companyId)).floor.priceOnSalesOrder !== true) add("rates_hidden", "", { reason: "pricing_off" });
    else if (!can(me, "order.price")) add("rates_hidden", "", {});
  }

  const waiting = await ctx.db
    .select({ reasons: ingestStagedRow.reasons, magnitude: sql<string | null>`json_extract(${ingestStagedRow.values}, '$._magnitude')` })
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
  for (const w of waiting) {
    for (const reason of w.reasons ?? []) {
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
): { applied: ApplyRow; waiting: MagnitudeFlag[]; notes: string[] } {
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
    cur = applyRow(compileWith(units), raw, a.rowIndex);
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
    const applyOne = (r: Staged) => {
      const a = applyRow(compiled, r.raw, r.rowIndex);
      return dropRateFlags ? { ...a, flags: a.flags.filter((f) => !RATE_FIELDS.includes(f.field)) } : a;
    };
    const applied = editable.map((r) => ({ r, ...settleMagnitude(applyOne(r), r.raw, answers, compileWith) }));
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
      await matchLiveOrders(ctx, recipe, editable, outcomes);
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
    const questions = await candidateQuestions(ctx, fresh, artifact);
    const open = openQuestionCount(questions) + (await undecidedRows(ctx, c.id));
    // Whole orders, checked as the merge planner checks them (X-new-3).
    const groups = c.target === "orders" ? await orderGroupStatements(ctx, c.id, at) : [];
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
        ...groups,
        ...(groups.length ? [recountStatement(ctx, c.id)] : []),
      ]);
    } catch (e) {
      const now2 = await loadCandidate(ctx, c.id);
      if (now2.serverSeq !== c.serverSeq && now2.state === "processing") return stepOut(now2, false);
      throw e;
    }
    // The sheet's values are parsed now: guess the period again with them (A24).
    if (c.target === "orders" || c.target === "bundles") await refreshArtifactPeriod(ctx, artifact);
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

const OLD_ORDER_NOTE = /^Old order no\. (.+)$/;

/**
 * Orders already in orrn (A5): an order line whose party has a live, not cancelled order with the same
 * PO (any date), or with no PO the same old order number, matches that order. With a date column the
 * old order number must also have the same date. With no date column the order date is the file's
 * as-of date, which moves with every file, so it is left out; then only a live order that is not
 * closed and whose order date is in the as-of date's financial year matches, because old order
 * numbers repeat from year to year. Anything else is a new order. The old order number is the one
 * the merge writes into the order's note ("Old order no. X"). A PO matches at any date and status,
 * as the merge planner's PO check does.
 *
 * A matched line is unchanged only when the live order has a line for the same section and cut
 * length (any cut length when the file has none). Any other line of a matched order is a conflict
 * with `order_line_new`, so a person decides; it is never dropped silently (A-new-1).
 */
async function matchLiveOrders(ctx: IngestCtx, recipe: Recipe, rows: readonly Staged[], outcomes: Map<string, RowOutcome>): Promise<void> {
  const byDate = !periodRequired(recipe);
  const open = rows
    .map((r) => ({ r, out: outcomes.get(r.id)! }))
    .filter(({ out }) => out.state === "ready_create" && out.values);
  const customerOf = (o: RowOutcome) => ((o.values!._ids ?? {}) as Record<string, string>).customer ?? "";
  const customerIds = [...new Set(open.map(({ out }) => customerOf(out)).filter((id) => id && !id.startsWith("pending:")))];
  if (customerIds.length === 0) return;
  const live = await mapInChunks(customerIds, (part) =>
    ctx.db
      .select({
        id: salesOrder.id,
        customerId: salesOrder.customerId,
        poNumber: salesOrder.poNumber,
        orderDate: salesOrder.orderDate,
        note: salesOrder.note,
        status: salesOrder.status,
      })
      .from(salesOrder)
      .where(and(eq(salesOrder.companyId, ctx.companyId), inArray(salesOrder.customerId, part), ne(salesOrder.status, "cancelled"))),
  );
  const byPo = new Map<string, string>();
  const byOldNo = new Map<string, string>();
  const oldKey = (customerId: string, orderDate: string, old: string) =>
    byDate ? `${customerId}|${orderDate}|${old}` : `${customerId}|fy:${orderDate ? fyOfDate(orderDate) : ""}|${old}`;
  for (const o of live) {
    const po = (o.poNumber ?? "").trim().toLowerCase();
    if (po) byPo.set(`${o.customerId}|${po}`, o.id);
    const old = OLD_ORDER_NOTE.exec((o.note ?? "").trim())?.[1]?.trim().toLowerCase();
    // With no date column a closed order never matches: the same old number is a new order.
    if (old && (byDate || o.status !== "closed")) byOldNo.set(oldKey(o.customerId, o.orderDate, old), o.id);
  }
  const hits: { r: Staged; out: RowOutcome; orderId: string }[] = [];
  for (const { r, out } of open) {
    const v = out.values!;
    const cust = customerOf(out);
    const po = str(v.poNumber).trim().toLowerCase();
    const old = str(v.oldOrderNo).trim().toLowerCase();
    const orderId = po ? byPo.get(`${cust}|${po}`) : old ? byOldNo.get(oldKey(cust, str(v.orderDate), old)) : undefined;
    if (orderId) hits.push({ r, out, orderId });
  }
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
  for (const { r, out, orderId } of hits) {
    out.matchId = orderId;
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

/**
 * The order groups the merge planner would hold (B1, B5), refused here first with the same check
 * (`orderGroupCheck`): every line of an order above 100 lines, or of a PO with two order dates. It
 * runs once the whole candidate is checked, because one order may span pages. A line it refused
 * before goes back to ready when its order passes now (a person skipped some lines).
 */
async function orderGroupStatements(ctx: IngestCtx, candidateId: string, at: Date): Promise<SqliteBatchItem[]> {
  const V = ingestStagedRow.values;
  const groupLike = or(...ORDER_GROUP_CODES.map((code) => sql`${ingestStagedRow.reasons} like ${`%"${code}:%`}`));
  const rows = await ctx.db
    .select({
      id: ingestStagedRow.id,
      rowIndex: ingestStagedRow.rowIndex,
      state: ingestStagedRow.state,
      reasons: ingestStagedRow.reasons,
      group: ORDER_GROUP_SQL,
      po: sql<string | null>`nullif(lower(trim(coalesce(json_extract(${V}, '$.poNumber'), ''))), '')`,
      poText: sql<string | null>`nullif(trim(coalesce(json_extract(${V}, '$.poNumber'), '')), '')`,
      orderDate: sql<string | null>`json_extract(${V}, '$.orderDate')`,
      oldNo: sql<string | null>`nullif(trim(coalesce(json_extract(${V}, '$.oldOrderNo'), '')), '')`,
    })
    .from(ingestStagedRow)
    .where(
      and(
        eq(ingestStagedRow.candidateId, candidateId),
        eq(ingestStagedRow.mergeState, "open"),
        or(eq(ingestStagedRow.state, "ready_create"), and(eq(ingestStagedRow.state, "refused"), groupLike)),
      ),
    )
    .orderBy(asc(ingestStagedRow.rowIndex));
  const isGroupReason = (r: string) => ORDER_GROUP_CODES.some((code) => r.startsWith(`${code}:`));
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const list = groups.get(r.group);
    if (list) list.push(r);
    else groups.set(r.group, [r]);
  }
  const out: SqliteBatchItem[] = [];
  for (const list of groups.values()) {
    const problem = orderGroupCheck(list);
    const reason = problem ? checkReason(problem) : null;
    for (const r of list) {
      const base = (r.reasons ?? []).filter((x) => !isGroupReason(x));
      const want = reason ? { state: "refused" as const, reasons: [...base, reason] } : { state: "ready_create" as const, reasons: base };
      if (want.state === r.state && JSON.stringify(want.reasons) === JSON.stringify(r.reasons ?? [])) continue;
      out.push(
        ctx.db
          .update(ingestStagedRow)
          .set({ state: want.state, reasons: want.reasons.length ? want.reasons : null, updatedAt: at })
          .where(and(eq(ingestStagedRow.id, r.id), eq(ingestStagedRow.candidateId, candidateId), eq(ingestStagedRow.mergeState, "open"))),
      );
    }
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
