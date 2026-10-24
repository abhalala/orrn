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

/**
 * open    = melts can be added.
 * closing = close-out asked with an unexplained tail; waiting on the cast_close approval
 *           (no melts meanwhile). Approved → closed; rejected → open again.
 * closed  = sealed. Bundles and press runs may still reference it (billets on hand get pressed).
 */
export const castStatuses = ["open", "closing", "closed"] as const;
export type CastStatus = (typeof castStatuses)[number];

/** Figures behind a close-out, frozen on the cast when it was asked (grams). */
export type CastCloseSummary = {
  inputG: number;
  logsG: number;
  byproductG: number;
  allowedBurnG: number;
  bundlesG: number;
  pressReturnsG: number;
  billetsOnHandG: number;
  explainedG: number;
  tailG: number;
  tailBp: number | null;
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
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(nowMs)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("cast_company_period_seq_unique").on(table.companyId, table.period, table.seq),
    uniqueIndex("cast_company_request_unique")
      .on(table.companyId, table.clientRequestId)
      .where(sql`${table.clientRequestId} is not null`),
    index("cast_company_number_idx").on(table.companyId, table.number),
    index("cast_company_status_idx").on(table.companyId, table.status, table.openedAt),
    index("cast_company_opened_idx").on(table.companyId, table.openedAt),
    index("cast_company_server_seq_idx").on(table.companyId, table.serverSeq),
  ],
);

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
    /** The five times on the foundry sheet (Q-P13). */
    preheatStartAt: integer("preheat_start_at", { mode: "timestamp_ms" }).notNull(),
    chargingStartAt: integer("charging_start_at", { mode: "timestamp_ms" }).notNull(),
    chargingEndAt: integer("charging_end_at", { mode: "timestamp_ms" }).notNull(),
    castingStartAt: integer("casting_start_at", { mode: "timestamp_ms" }).notNull(),
    castingEndAt: integer("casting_end_at", { mode: "timestamp_ms" }).notNull(),
    /** LDO tank dip, tenths of an inch, at the five checkpoints (start = preheat start, end = casting end). */
    ldoStartTenthIn: integer("ldo_start_tenth_in").notNull(),
    ldoChargingStartTenthIn: integer("ldo_charging_start_tenth_in"),
    ldoChargingEndTenthIn: integer("ldo_charging_end_tenth_in"),
    ldoCastingStartTenthIn: integer("ldo_casting_start_tenth_in"),
    ldoEndTenthIn: integer("ldo_end_tenth_in").notNull(),
    /** Σ inputs (lots + return streams), grams. */
    inputG: integer("input_g").notNull(),
    logsPcs: integer("logs_pcs").notNull(),
    logsLengthMm: integer("logs_length_mm").notNull(),
    logsG: integer("logs_g").notNull(),
    drossG: integer("dross_g").notNull().default(0),
    feG: integer("fe_g").notNull().default(0),
    /** Σ other by-products put back into charge streams (reusable metal, dross ingot), grams. */
    returnsG: integer("returns_g").notNull().default(0),
    /** logs + dross + Fe + returns, grams. */
    outputG: integer("output_g").notNull(),
    /** input − output; burn loss when positive. */
    lossG: integer("loss_g").notNull(),
    lossBp: integer("loss_bp").notNull(),
    /** Loss accepted as burn loss (0 … 3 % of input). The excess is part of the cast's tail. */
    allowedBurnG: integer("allowed_burn_g").notNull(),
    warnings: text("warnings", { mode: "json" }).$type<MeltWarning[]>().notNull().default([]),
    /** Why the balance is off, when the foundry knows (optional). */
    balanceNote: text("balance_note"),
    notes: text("notes"),
    clientRequestId: text("client_request_id"),
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
    lengthMm: integer("length_mm"),
    kgG: integer("kg_g").notNull(),
    locationId: text("location_id")
      .notNull()
      .references(() => location.id, { onDelete: "restrict" }),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
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
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (table) => [
    index("spectro_result_company_melt_idx").on(table.companyId, table.meltId),
    index("spectro_result_company_cast_idx").on(table.companyId, table.castId),
    index("spectro_result_company_server_seq_idx").on(table.companyId, table.serverSeq),
  ],
);

export type ReturnStreamRow = typeof returnStream.$inferSelect;
export type CastRow = typeof cast.$inferSelect;
export type MeltRow = typeof melt.$inferSelect;
export type MeltInputRow = typeof meltInput.$inferSelect;
export type MeltOutputRow = typeof meltOutput.$inferSelect;
export type MeltChemicalRow = typeof meltChemical.$inferSelect;
export type SpectroResultRow = typeof spectroResult.$inferSelect;
