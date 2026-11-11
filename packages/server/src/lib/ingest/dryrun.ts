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
  type DateFormat,
  type Recipe,
  type UnitId,
} from "@orrn/ingest";
import { isModuleOn, type CompanyModule } from "@orrn/domain";
import { TRPCError } from "@trpc/server";
import { and, asc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";

import { customer, customerAlias, die, dieInstance, vendor, vendorAlias } from "@orrn/db/schema";
import {
  ingestAnswer,
  ingestCandidate,
  ingestStagedRow,
  type IngestTarget,
  type RowState,
} from "@orrn/db/schema/ingest";

import { mapInChunks, pushChunkedInserts, type SqliteBatchItem } from "../atomic";
import { now } from "../clock";
import { createId } from "../id";
import { companyModules } from "../moduleGate";
import { can } from "../permissions";
import { nameKey } from "../purchase";
import { stagedRowIdOf } from "./artifacts";
import {
  guardedBatch,
  ingestAbortUnlessChanged,
  loadArtifact,
  loadBlock,
  loadCandidate,
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
  answered: Set<string>;
};

export const answerKey = (code: string, subject: string) => `${code}\u001f${subject}`;

export function readAnswers(rows: readonly AnswerRow[], artifact: Pick<ArtifactRow, "periodConfirmed">): AnswerSet {
  const set: AnswerSet = {
    units: {},
    dateFormats: {},
    periodAsOf: artifact.periodConfirmed?.asOf ?? null,
    ratesLeftOut: null,
    legacyDie: new Map(),
    newCustomers: null,
    answered: new Set(),
  };
  for (const a of rows) {
    set.answered.add(answerKey(a.questionCode, a.subject));
    const v = a.answer as unknown;
    switch (a.questionCode) {
      case "unit_unknown":
        if (typeof v === "string") set.units[a.subject] = v as UnitId;
        break;
      case "date_format_ambiguous":
        if (typeof v === "string") set.dateFormats[a.subject] = v as DateFormat;
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
};

const str = (v: unknown) => (typeof v === "string" ? v : v === null || v === undefined ? "" : String(v));

async function loadPageLive(ctx: IngestCtx, target: IngestTarget, rows: readonly Values[]): Promise<PageLive> {
  const live: PageLive = {};
  const codes = rows.map((v) => str(v.sectionCode)).filter(Boolean);
  if (target === "customers" || target === "customer_aliases" || target === "orders") live.customers = await loadCustomerIndex(ctx);
  if (target === "vendors" || target === "vendor_aliases") live.vendors = await loadVendorIndex(ctx);
  if (target === "dies" || target === "die_copies" || target === "bundles" || target === "orders") live.sections = await loadSections(ctx, codes);
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
    const recs = await mapInChunks([...new Set(codes)], (part) =>
      ctx.db
        .select()
        .from(die)
        .where(and(eq(die.companyId, ctx.companyId), isNull(die.deletedAt), inArray(die.sectionCode, part))),
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

/** Plan B7 decisions on ambiguous and conflict rows. */
export function applyDecision(out: RowOutcome, row: Pick<Staged, "decision" | "matchId">): RowOutcome {
  const d = row.decision;
  if (!d) return out;
  if (d === "skip") return { ...out, state: "skipped" };
  if (out.state !== "ambiguous" && out.state !== "conflict") return out;
  switch (d) {
    case "use_match":
      return { ...out, state: "ready_update", matchId: row.matchId ?? out.matchId };
    case "keep_file":
      return { ...out, state: "ready_update" };
    case "keep_live":
      return { ...out, state: "unchanged" };
    case "create_new":
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
  if (r.target === "orders" && r.fields.some((f) => f.field === "rate") && !can(me, "order.price")) add("rates_hidden", "", {});

  const waiting = await ctx.db
    .select({ reasons: ingestStagedRow.reasons })
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
  for (const w of waiting) {
    for (const reason of w.reasons ?? []) {
      if (reason === Q_CUSTOMER_NEW) newNames += 1;
      else if (reason.startsWith(`${Q_SECTION_UNKNOWN}:`)) codes.add(reason.slice(Q_SECTION_UNKNOWN.length + 1));
    }
  }
  for (const code of [...codes].sort()) add("create_legacy_die", code, { code });
  if (newNames > 0 || byKey.has(answerKey("new_customers", ""))) add("new_customers", "", { count: newNames });
  return out;
}

/** Questions that block approve for anyone (rates_hidden depends on who approves, so it is left out). */
export function openQuestionCount(questions: readonly IngestQuestion[]): number {
  return questions.filter((q) => q.open && q.code !== "rates_hidden").length;
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
        isNull(ingestStagedRow.decision),
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
  const answers = readAnswers(answerRows, artifact);

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
    const applied = editable.map((r) => ({ r, a: applyRow(compiled, r.raw, r.rowIndex) }));
    const live = await loadPageLive(
      ctx,
      c.target,
      applied.filter((x) => x.a.state === "ok").map((x) => cleanValues(x.a.values)),
    );
    for (const { r, a } of applied) {
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
      out = applyDecision(out, r);
      out.reasons = [...keep, ...out.reasons];
      out.entered = entered;
      const dup = dupKeyOf(c.target, values);
      if (dup) values._dupKey = dup;
      outcomes.set(r.id, out);
    }
    await markDuplicates(ctx, c.id, input.expectCursor, editable, outcomes);
  }

  const statements: SqliteBatchItem[] = [];
  const last = page.at(-1);
  const nextCursor = last ? last.rowIndex + 1 : input.expectCursor;
  statements.push(
    ctx.db
      .update(ingestCandidate)
      .set({ dryCursor: nextCursor, updatedAt: at })
      .where(and(eq(ingestCandidate.id, c.id), eq(ingestCandidate.companyId, ctx.companyId), eq(ingestCandidate.dryCursor, input.expectCursor), eq(ingestCandidate.state, "processing"))),
    ingestAbortUnlessChanged(ctx.db),
  );
  if (derivedRows.size > 0) {
    const childId = await ensureNewCustomerCandidate(ctx, c, statements);
    const refMap = new Map<string, string>();
    const inserts = [];
    for (const [key, d] of derivedRows) {
      const childRowKey = await sha(`${c.artifactId}|${block.ordinal}|new-customer|${key}`);
      refMap.set(`pending:new-customer:${key}`, `pending:${childRowKey}`);
      inserts.push({
        id: await stagedRowIdOf(childRowKey, "customers"),
        companyId: ctx.companyId,
        rowKey: childRowKey,
        candidateId: childId,
        rowIndex: d.rowIndex,
        raw: [d.name],
        values: { name: d.name, _ids: {} },
        entered: null,
        state: "ready_create" as const,
        reasons: null,
        matchId: null,
        diff: null,
        decision: null,
        mergeState: "open" as const,
        committedType: null,
        committedId: null,
        updatedAt: at,
      });
    }
    pushChunkedInserts(statements, (part) => ctx.db.insert(ingestStagedRow).values(part).onConflictDoNothing(), inserts);
    for (const out of outcomes.values()) {
      const ids = (out.values?._ids ?? null) as Record<string, string> | null;
      if (ids?.customer && refMap.has(ids.customer)) ids.customer = refMap.get(ids.customer)!;
    }
    statements.push(recountStatement(ctx, childId));
  }

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
  await guardedBatch(ctx.db, statements, { code: "CONFLICT", message: "Running in another tab" });

  // Done when the file is read, every row is put and the cursor passed the last row.
  const fresh = await loadCandidate(ctx, c.id);
  const allPut = artifact.readState === "read" && block.rowsPut === block.rowCount;
  const done = allPut && page.length < INGEST_LIMITS.dryRunRowsPerStep;
  if (done) {
    const questions = await candidateQuestions(ctx, fresh, artifact);
    const open = openQuestionCount(questions) + (await undecidedRows(ctx, c.id));
    await guardedBatch(ctx.db, [
      ctx.db
        .update(ingestCandidate)
        .set({ state: "ready", openQuestions: open, serverSeq: fresh.serverSeq + 1, updatedAt: now() })
        .where(and(eq(ingestCandidate.id, c.id), eq(ingestCandidate.companyId, ctx.companyId), eq(ingestCandidate.serverSeq, fresh.serverSeq), eq(ingestCandidate.state, "processing"))),
      ingestAbortUnlessChanged(ctx.db),
    ]);
  }
  const final = await loadCandidate(ctx, c.id);
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

/** The derived `customers` candidate of an orders candidate, made on first need (in `statements`). */
async function ensureNewCustomerCandidate(ctx: IngestCtx, parent: CandidateRow, statements: SqliteBatchItem[]): Promise<string> {
  const [existing] = await ctx.db
    .select({ id: ingestCandidate.id })
    .from(ingestCandidate)
    .where(and(eq(ingestCandidate.companyId, ctx.companyId), eq(ingestCandidate.parentId, parent.id), eq(ingestCandidate.target, "customers")))
    .limit(1);
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
