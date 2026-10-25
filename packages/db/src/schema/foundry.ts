import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { user } from "./auth";
import { purchaseLot } from "./purchase";
import { location } from "./stock";
import { storeItem, storeUnits, type StoreUnit } from "./store";
import { company } from "./tenant";

const nowMs = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

/**
 * Foundry (spec P3, P15; digest Stages 3-5). A cast is a campaign (ADR-013, Q-P2): it gets its
 * letter code from the doc series (`K31` = 31st cast of November; year stored, not shown) and runs
 * one or more melts. A melt charges scrap lots and return streams, uses chemicals and LDO, and
 * puts out logs (billets of the cast), dross and iron. Every melt posts its stock effect to the
 * ledger in the same batch as its rows: − scrap per lot, − return streams, + billets at the billet
 * store, + dross / Fe / returned metal at the plant-scrap location. Closing a cast explains its
 * tail; an unexplained tail above 1 % needs a reason and a second person (approval cast_close).
 */

/**
 * The plant's internal return streams (digest Stage 2, Data Forms.xlsx Foundry sheet).
 * - charge: metal the furnace takes back (Ingot, Plant scrap, Plant discard, Dross ingot, Bend log,
 *   Hill metal, Pit metal, Tendis metal, Dross metal): melt inputs and returned by-products.
 * - byproduct: what a melt throws off that is not charged back as is (Dross, Fe = iron picked out).
 */
export const returnStreamKinds = ["charge", "byproduct"] as const;
export type ReturnStreamKind = (typeof returnStreamKinds)[number];

export const returnStream = sqliteTable(
  "return_stream",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    /** Stable short code other modules post to: PLANT-SCRAP, DISCARD, DROSS, FE, … Upper case. */
    code: text("code").notNull(),
    name: text("name").notNull(),
    nameKey: text("name_key").notNull(),
    kind: text("kind", { enum: returnStreamKinds }).notNull().default("charge"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(nowMs)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("return_stream_company_code_unique").on(table.companyId, table.code),
    uniqueIndex("return_stream_company_name_key_unique").on(table.companyId, table.nameKey),
    index("return_stream_company_server_seq_idx").on(table.companyId, table.serverSeq),
  ],
);

// ---------------------------------------------------------------------------
// Wave 2 masters (FP-FD-01, FP-FD-09; migration 0028). Published with masters.publish (C40).
// ---------------------------------------------------------------------------

export const foundryMasterStatuses = ["active", "retired"] as const;

/** A furnace (FourCubes: one, F1, 6 t, 127 mm billets, Q-FD-8). A melt refuses metal_in > capacity. */
export const furnace = sqliteTable(
  "furnace",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    code: text("code").notNull(),
    name: text("name").notNull(),
    capacityG: integer("capacity_g").notNull(),
    /** Billet (log) diameter cast here, mm (127 = 5 inch). */
    billetDiaMm: integer("billet_dia_mm"),
    status: text("status", { enum: foundryMasterStatuses }).notNull().default("active"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(nowMs)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("furnace_company_code_unique").on(table.companyId, table.code),
    index("furnace_company_server_seq_idx").on(table.companyId, table.serverSeq),
  ],
);

/**
 * The chemistry master (C20: not the commercial `die.alloy` text). `code` = `6063`; casts and
 * melts point here; ageing recipes match on `alloy.code`.
 */
export const alloy = sqliteTable(
  "alloy",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    code: text("code").notNull(),
    name: text("name").notNull(),
    status: text("status", { enum: foundryMasterStatuses }).notNull().default("active"),
    note: text("note"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(nowMs)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("alloy_company_code_unique").on(table.companyId, table.code),
    index("alloy_company_server_seq_idx").on(table.companyId, table.serverSeq),
  ],
);

/** Spectro elements, ppm integers (0.45 % = 4500). `al` is optional (remainder). */
export const spectroElements = ["si", "fe", "cu", "mn", "mg", "zn", "ti", "cr", "al"] as const;
export type SpectroElement = (typeof spectroElements)[number];

/** One element's limits for an alloy (FP-FD-09). Null min / max = no bound on that side. */
export const alloyLimit = sqliteTable(
  "alloy_limit",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    alloyId: text("alloy_id")
      .notNull()
      .references(() => alloy.id, { onDelete: "cascade" }),
    element: text("element", { enum: spectroElements }).notNull(),
    minPpm: integer("min_ppm"),
    maxPpm: integer("max_ppm"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(nowMs)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("alloy_limit_alloy_element_unique").on(table.alloyId, table.element),
    index("alloy_limit_company_alloy_idx").on(table.companyId, table.alloyId),
  ],
);

/**
 * open    = melts can be added.
 * closing = close-out asked with an unexplained tail; waiting on the cast_close approval
 *           (no melts meanwhile). Approved → closed; rejected → open again.
 * closed  = sealed. Bundles and press runs may still reference it (billets on hand get pressed).
 * cancelled = opened by mistake; only while it has no locked melt (Wave 2, FP-FD-02).
 */
export const castStatuses = ["open", "closing", "closed", "cancelled"] as const;
export type CastStatus = (typeof castStatuses)[number];

/** Figures behind a close-out, frozen on the cast when it was asked (grams). */
export type CastCloseSummary = {
  /**
   * W2-FD-S tail (spec E4): billets produced (Σ locked log kg) − billets the press used (`creditedG`,
   * press_run postings net of reopens) − billets on hand (BILLET ledger). `shortG` = billets the press
   * logged beyond what the store held (D22). Bundles and metal in are shown beside it, never in it.
   */
  producedG: number;
  creditedG: number;
  billetsOnHandG: number;
  shortG: number;
  tailG: number;
  tailBp: number | null;
  inputG: number;
  logsG: number;
  bundlesG: number;
  /** The tail reason code's stable key (`billets_short`), when one was named. */
  reasonCode?: string | null;
  /**
   * Q59-A (W2-FD-S r1): the physical count at close (pieces and grams). With a count, `tailG` =
   * `billetsOnHandG` (the ledger then) − `countedG`, and `adjustG` = −tail is the `cast_tail` ledger
   * row (posted with the close, or by the `cast_close` approval at `adjustLocationId`). Absent on
   * casts closed before r1.
   */
  countedCount?: number;
  countedG?: number;
  adjustG?: number;
  adjustLocationId?: string | null;
};

export const cast = sqliteTable(
  "cast",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    /** Letter code as staff write it (`K31`); repeats every year, so never a key on its own. */
    number: text("number").notNull(),
    /** Doc series period `YYYY-MM` (company wall clock) the number came from. */
    period: text("period").notNull(),
    year: integer("year").notNull(),
    month: integer("month").notNull(),
    seq: integer("seq").notNull(),
    alloy: text("alloy").notNull(),
    /** Quality grade written on the foundry sheet (free text, short). */
    grade: text("grade"),
    status: text("status", { enum: castStatuses }).notNull().default("open"),
    /** Melts ever added (cancelled ones included): the next melt's number within the cast. */
    meltCount: integer("melt_count").notNull().default(0),
    notes: text("notes"),
    openedAt: integer("opened_at", { mode: "timestamp_ms" }).notNull(),
    /** Close-out: who asked and when; the tail figures at that moment. */
    closeRequestedAt: integer("close_requested_at", { mode: "timestamp_ms" }),
    closeRequestedBy: text("close_requested_by").references(() => user.id, { onDelete: "set null" }),
    tailG: integer("tail_g"),
    tailBp: integer("tail_bp"),
    tailReason: text("tail_reason"),
    closeSummary: text("close_summary", { mode: "json" }).$type<CastCloseSummary>(),
    closeApprovalId: text("close_approval_id"),
    closedAt: integer("closed_at", { mode: "timestamp_ms" }),
    /** The closer (tail within 1 %) or the approver (tail above 1 %). */
    closedBy: text("closed_by").references(() => user.id, { onDelete: "set null" }),
    /** Client idempotency key: a double tap on "Open cast" returns the first cast. */
    clientRequestId: text("client_request_id"),
    /** Wave 2: the chemistry master row (`alloy` text stays as the code snapshot). */
    alloyId: text("alloy_id").references(() => alloy.id),
    cancelledAt: integer("cancelled_at", { mode: "timestamp_ms" }),
    cancelledBy: text("cancelled_by").references(() => user.id, { onDelete: "set null" }),
    cancelReason: text("cancel_reason"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(nowMs)
      .$onUpdate(() => new Date())
      .notNull(),
    /** W2-FD-S (0036): the `reason_code` (kind `cast_tail`) the closer named for a tail or a shortfall. App-enforced id. */
    tailReasonCodeId: text("tail_reason_code_id"),
    /** FINAL-FIXES-4 (0042, FP-FD-02): the code an old cast carried on paper (upper case, free text), unique per plant. */
    legacyCode: text("legacy_code"),
  },
  (table) => [
    uniqueIndex("cast_company_period_seq_unique").on(table.companyId, table.period, table.seq),
    uniqueIndex("cast_company_request_unique")
      .on(table.companyId, table.clientRequestId)
      .where(sql`${table.clientRequestId} is not null`),
    uniqueIndex("cast_company_legacy_unique")
      .on(table.companyId, table.legacyCode)
      .where(sql`${table.legacyCode} is not null`),
    index("cast_company_number_idx").on(table.companyId, table.number),
    index("cast_company_status_idx").on(table.companyId, table.status, table.openedAt),
    index("cast_company_opened_idx").on(table.companyId, table.openedAt),
    index("cast_company_server_seq_idx").on(table.companyId, table.serverSeq),
  ],
);

/**
 * Wave 2 (C18, FP-FD-13): draft → locked (posts ledger + store draws in one batch) | cancelled.
 * A draft moves nothing; its times, LDO dips and figures may be empty until lock. Rows written by
 * the PL5 create path are `locked` (the SQL default), since that path posts on create.
 * r1 (m-2): a locked melt whose postings were reversed is `cancelled` (melts.cancel) or `corrected`
 * (melts.correct; its draft copy names it in `corrects_melt_id`), and carries `cancelled_at`. A
 * discarded draft is `cancelled` with `locked_at` null. Every sum counts `locked` and live only.
 */
export const meltStatuses = ["draft", "locked", "cancelled", "corrected"] as const;
export type MeltStatus = (typeof meltStatuses)[number];

/** What a melt's balance check said, stored with the melt (spec P15: warns, never silently passes). */
export type MeltWarning = { code: string; [key: string]: string | number | null };

export const melt = sqliteTable(
  "melt",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    castId: text("cast_id")
      .notNull()
      .references(() => cast.id, { onDelete: "restrict" }),
    /** 1, 2, 3 … within the cast (from `cast.melt_count`), never reused. */
    seq: integer("seq").notNull(),
    alloy: text("alloy").notNull(),
    status: text("status", { enum: meltStatuses }).notNull().default(sql`'locked'`),
    /** Wave 2: the furnace and the chemistry master (alloy ≠ cast alloy needs a reason at lock). */
    furnaceId: text("furnace_id").references(() => furnace.id),
    alloyId: text("alloy_id").references(() => alloy.id),
    /**
     * The five times on the foundry sheet (Q-P13). Nullable for drafts (Wave 2); lock needs
     * charging start and casting end >= charging start.
     */
    preheatStartAt: integer("preheat_start_at", { mode: "timestamp_ms" }),
    chargingStartAt: integer("charging_start_at", { mode: "timestamp_ms" }),
    chargingEndAt: integer("charging_end_at", { mode: "timestamp_ms" }),
    castingStartAt: integer("casting_start_at", { mode: "timestamp_ms" }),
    castingEndAt: integer("casting_end_at", { mode: "timestamp_ms" }),
    /** LDO tank dip, tenths of an inch, at the five checkpoints (start = preheat start, end = casting end). */
    ldoStartTenthIn: integer("ldo_start_tenth_in"),
    ldoChargingStartTenthIn: integer("ldo_charging_start_tenth_in"),
    ldoChargingEndTenthIn: integer("ldo_charging_end_tenth_in"),
    ldoCastingStartTenthIn: integer("ldo_casting_start_tenth_in"),
    ldoEndTenthIn: integer("ldo_end_tenth_in"),
    /**
     * Figures (grams), server-computed from the lines; 0 on a draft until lock. Spec names:
     * metal_in_g = `input_g`, burn_g = `loss_g`, balance_bp = `loss_bp` (`@orrn/domain` meltBalance).
     */
    /** Σ inputs (lots + return streams), grams. */
    inputG: integer("input_g").notNull().default(sql`0`),
    logsPcs: integer("logs_pcs").notNull().default(sql`0`),
    logsLengthMm: integer("logs_length_mm").notNull().default(sql`0`),
    logsG: integer("logs_g").notNull().default(sql`0`),
    drossG: integer("dross_g").notNull().default(0),
    feG: integer("fe_g").notNull().default(0),
    /** Σ other by-products put back into charge streams (reusable metal, dross ingot), grams. */
    returnsG: integer("returns_g").notNull().default(0),
    /** logs + dross + Fe + returns, grams. */
    outputG: integer("output_g").notNull().default(sql`0`),
    /** input − output; burn loss when positive. */
    lossG: integer("loss_g").notNull().default(sql`0`),
    lossBp: integer("loss_bp").notNull().default(sql`0`),
    /** Loss accepted as burn loss (0 … 3 % of input). The excess is part of the cast's tail. */
    allowedBurnG: integer("allowed_burn_g").notNull().default(sql`0`),
    /** Wave 2: logs ÷ metal in, basis points (null until lock). */
    yieldBp: integer("yield_bp"),
    warnings: text("warnings", { mode: "json" }).$type<MeltWarning[]>().notNull().default([]),
    /** Why the balance is off (spec `balance_reason`, 1–500): required at lock when |balance| > 3 %. */
    balanceNote: text("balance_note"),
    /** Why the melt locks without a passing spectro (fail / incomplete / none), 1–500 (Q-FD-4). */
    spectroReason: text("spectro_reason"),
    notes: text("notes"),
    clientRequestId: text("client_request_id"),
    /** W2-FD-S (0036): why the melt's alloy differs from the cast's (lock needs it then; the cast is never retargeted). */
    alloyReason: text("alloy_reason"),
    /**
     * W2-FD-S (0036): on a draft opened by `melts.correct`, the locked melt it replaces (that one is
     * reversed and cancelled in the same batch). App-enforced id, like `bundle.cast_id`.
     */
    correctsMeltId: text("corrects_melt_id"),
    lockedAt: integer("locked_at", { mode: "timestamp_ms" }),
    lockedBy: text("locked_by").references(() => user.id, { onDelete: "set null" }),
    /** A cancelled melt keeps its number; `melt_cancel` ledger rows reverse its postings. */
    cancelledAt: integer("cancelled_at", { mode: "timestamp_ms" }),
    cancelledBy: text("cancelled_by").references(() => user.id, { onDelete: "set null" }),
    cancelReason: text("cancel_reason"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    /** NULL until the melt is changed (cancelled). */
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    uniqueIndex("melt_company_cast_seq_unique").on(table.companyId, table.castId, table.seq),
    uniqueIndex("melt_company_request_unique")
      .on(table.companyId, table.clientRequestId)
      .where(sql`${table.clientRequestId} is not null`),
    index("melt_company_casting_end_idx").on(table.companyId, table.castingEndAt),
    index("melt_company_cast_status_idx").on(table.companyId, table.castId, table.status),
    index("melt_company_server_seq_idx").on(table.companyId, table.serverSeq),
  ],
);

export const meltInputKinds = ["lot", "return_stream"] as const;
export type MeltInputKind = (typeof meltInputKinds)[number];

/**
 * One charge line. A lot line draws from the lot's item+grade at the lot's scrap store; a lot's
 * remaining kg = its ledger postings (OK, D/C deductions, cancel) − Σ kg of live melt lines on it.
 * A return-stream line draws from the plant-scrap location. Ledger line = `line`.
 */
export const meltInput = sqliteTable(
  "melt_input",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    meltId: text("melt_id")
      .notNull()
      .references(() => melt.id, { onDelete: "cascade" }),
    line: integer("line").notNull(),
    kind: text("kind", { enum: meltInputKinds }).notNull(),
    lotId: text("lot_id").references(() => purchaseLot.id, { onDelete: "restrict" }),
    returnStreamId: text("return_stream_id").references(() => returnStream.id, { onDelete: "restrict" }),
    /** The ledger item_ref drawn (`{scrapItemId}:{scrapGradeId}` or the stream id). */
    itemRef: text("item_ref").notNull(),
    locationId: text("location_id")
      .notNull()
      .references(() => location.id, { onDelete: "restrict" }),
    kgG: integer("kg_g").notNull(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (table) => [
    uniqueIndex("melt_input_company_melt_line_unique").on(table.companyId, table.meltId, table.line),
    index("melt_input_company_lot_idx").on(table.companyId, table.lotId),
    index("melt_input_company_stream_idx").on(table.companyId, table.returnStreamId),
  ],
);

/** logs = billets of the cast (+ at the billet store); the rest go to return streams at plant scrap. */
export const meltOutputKinds = ["logs", "dross", "fe", "return_stream"] as const;
export type MeltOutputKind = (typeof meltOutputKinds)[number];

export const meltOutput = sqliteTable(
  "melt_output",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    meltId: text("melt_id")
      .notNull()
      .references(() => melt.id, { onDelete: "cascade" }),
    /** Continues after the input lines; the same number as the ledger line. */
    line: integer("line").notNull(),
    kind: text("kind", { enum: meltOutputKinds }).notNull(),
    /** The stream credited (dross → DROSS, fe → FE, return_stream → the chosen charge stream). */
    returnStreamId: text("return_stream_id").references(() => returnStream.id, { onDelete: "restrict" }),
    pcs: integer("pcs"),
    /** Log lines: the length as it left the caster (mm). */
    lengthMm: integer("length_mm"),
    kgG: integer("kg_g").notNull(),
    locationId: text("location_id")
      .notNull()
      .references(() => location.id, { onDelete: "restrict" }),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    /** W2-FD-S (0036, FP-FD-07): log lines, the length the press charges (defaults to the log length). */
    billetLengthMm: integer("billet_length_mm"),
    /** W2-FD-S (0036): log lines, the furnace's billet diameter at lock (a later furnace edit rewrites nothing). */
    diameterMm: integer("diameter_mm"),
  },
  (table) => [
    uniqueIndex("melt_output_company_melt_line_unique").on(table.companyId, table.meltId, table.line),
    index("melt_output_company_stream_idx").on(table.companyId, table.returnStreamId),
  ],
);

/**
 * Chemicals and fuel of a melt with the furnace-side open / used / close (milli-units of `unit`;
 * close = open − used). A line with a store item draws `used` from the central store (MRS, purpose
 * melt, ref = the cast) in the melt's own batch (ruling RP17); a free-text line is recorded only.
 */
export const meltChemical = sqliteTable(
  "melt_chemical",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    meltId: text("melt_id")
      .notNull()
      .references(() => melt.id, { onDelete: "cascade" }),
    line: integer("line").notNull(),
    storeItemId: text("store_item_id").references(() => storeItem.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    unit: text("unit", { enum: storeUnits }).$type<StoreUnit>().notNull(),
    openMilli: integer("open_milli").notNull(),
    usedMilli: integer("used_milli").notNull(),
    closeMilli: integer("close_milli").notNull(),
    /** The MRS that drew `used` from the store (opaque id, like nitriding_log.store_txn_id). */
    storeTxnId: text("store_txn_id"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (table) => [
    uniqueIndex("melt_chemical_company_melt_line_unique").on(table.companyId, table.meltId, table.line),
    index("melt_chemical_company_item_idx").on(table.companyId, table.storeItemId),
  ],
);

export const spectroVerdicts = ["pass", "fail", "incomplete"] as const;
/** Where a result came from: a file a person attached, numbers typed with no file, or the watcher inbox. */
export const spectroSources = ["file", "typed", "import"] as const;
export type SpectroSource = (typeof spectroSources)[number];
export type SpectroVerdictColumn = (typeof spectroVerdicts)[number];
export const spectroAlSources = ["measured", "balance"] as const;
/** The alloy's limits at attach time (limits may change later; the verdict never re-reads). */
export type SpectroLimitsSnapshot = {
  alloyId: string | null;
  alloyCode: string;
  limits: { element: SpectroElement; minPpm: number | null; maxPpm: number | null }[];
};

/**
 * Spectro (chemistry) result of a melt (digest Stage 4, Q-P7): the uploaded printout / photo /
 * results file as base64 text (≤ 1 MB decoded; moves to R2 later) plus the parsed values, stored as
 * integer parts per million (0.45 % Si = 4500). A melt may carry several (re-tests).
 */
export const spectroResult = sqliteTable(
  "spectro_result",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    meltId: text("melt_id")
      .notNull()
      .references(() => melt.id, { onDelete: "restrict" }),
    castId: text("cast_id")
      .notNull()
      .references(() => cast.id, { onDelete: "restrict" }),
    fileName: text("file_name").notNull(),
    mime: text("mime").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    dataBase64: text("data_base64").notNull(),
    valuesPpm: text("values_ppm", { mode: "json" }).$type<Record<string, number>>().notNull().default({}),
    /**
     * Wave 2 (FP-FD-10/11): typed ppm per element (integers; 0.45 % = 4500). Al is optional; when
     * not measured it is 1,000,000 − Σ eight (floor 0) with `al_source` = `balance`.
     */
    siPpm: integer("si_ppm"),
    fePpm: integer("fe_ppm"),
    cuPpm: integer("cu_ppm"),
    mnPpm: integer("mn_ppm"),
    mgPpm: integer("mg_ppm"),
    znPpm: integer("zn_ppm"),
    tiPpm: integer("ti_ppm"),
    crPpm: integer("cr_ppm"),
    alPpm: integer("al_ppm"),
    alSource: text("al_source", { enum: spectroAlSources }),
    /** `@orrn/domain` spectroVerdict against the limits snapshotted at attach. */
    verdict: text("verdict", { enum: spectroVerdicts }),
    limitsSnapshot: text("limits_snapshot", { mode: "json" }).$type<SpectroLimitsSnapshot>(),
    /** R2 object key once the file moves out of D1 (C45); null while the file is base64 here. */
    fileKey: text("file_key"),
    voidedAt: integer("voided_at", { mode: "timestamp_ms" }),
    voidedBy: text("voided_by").references(() => user.id, { onDelete: "set null" }),
    voidReason: text("void_reason"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    /** W2-FD-S (0036): file / typed / import (the watcher inbox). SQL default: rows before it were files. */
    source: text("source", { enum: spectroSources }).notNull().default(sql`'file'`),
    /** W2-FD-S (0036): numbers typed with no printout or file need a reason (1-500). */
    entryReason: text("entry_reason"),
    /** W2-FD-S (0036): a retried attach returns the first result. Unique per company when set. */
    clientRequestId: text("client_request_id"),
  },
  (table) => [
    uniqueIndex("spectro_result_company_request_unique")
      .on(table.companyId, table.clientRequestId)
      .where(sql`${table.clientRequestId} is not null`),
    index("spectro_result_company_melt_idx").on(table.companyId, table.meltId),
    index("spectro_result_company_cast_idx").on(table.companyId, table.castId),
    index("spectro_result_company_server_seq_idx").on(table.companyId, table.serverSeq),
  ],
);

/**
 * W2-FD-S (0036): furnace readings over a melt (temperature now; the PLC tag list is owner-only, Q46).
 * `source`: `typed` (a person read the pyrometer), `simulated` (the FOUNDRY_SIMULATOR seam), `device`
 * (a real collector, later). A simulated row is never shown as a device reading. Readings never move stock.
 */
export const meltReadingKinds = ["furnace_temp"] as const;
export const meltReadingSources = ["typed", "simulated", "device"] as const;
export type MeltReadingSource = (typeof meltReadingSources)[number];

export const meltReading = sqliteTable(
  "melt_reading",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    meltId: text("melt_id")
      .notNull()
      .references(() => melt.id, { onDelete: "cascade" }),
    furnaceId: text("furnace_id").references(() => furnace.id),
    kind: text("kind", { enum: meltReadingKinds }).notNull(),
    /** Degrees Celsius × 10 (735.5 °C = 7355). */
    valueX10: integer("value_x10").notNull(),
    readAt: integer("read_at", { mode: "timestamp_ms" }).notNull(),
    source: text("source", { enum: meltReadingSources }).notNull(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (table) => [
    // One reading per melt, kind, instant and source: a repeated simulate (or a device resend) is a no-op.
    uniqueIndex("melt_reading_company_melt_kind_at_unique").on(table.companyId, table.meltId, table.kind, table.readAt, table.source),
    index("melt_reading_company_server_seq_idx").on(table.companyId, table.serverSeq),
  ],
);

export type MeltReadingRow = typeof meltReading.$inferSelect;
export type ReturnStreamRow = typeof returnStream.$inferSelect;
export type FurnaceRow = typeof furnace.$inferSelect;
export type AlloyRow = typeof alloy.$inferSelect;
export type AlloyLimitRow = typeof alloyLimit.$inferSelect;
export type CastRow = typeof cast.$inferSelect;
export type MeltRow = typeof melt.$inferSelect;
export type MeltInputRow = typeof meltInput.$inferSelect;
export type MeltOutputRow = typeof meltOutput.$inferSelect;
export type MeltChemicalRow = typeof meltChemical.$inferSelect;
export type SpectroResultRow = typeof spectroResult.$inferSelect;
