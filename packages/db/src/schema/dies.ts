import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { user } from "./auth";
import { die } from "./catalog";
import { customer } from "./customers";
import { company } from "./tenant";

const nowMs = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

/**
 * Die room (spec P4/P18, digest §3.3 and Stage 19).
 *
 * The existing `die` table is the SECTION catalogue (12170 Domal, with its weight band per
 * 12 ft). A section has several physical die copies, the "obliques" (12170-1, 12170-2, ...).
 * Each copy wears differently, so its kg/12ft drifts and the die room re-ranks the copies into
 * tiers. Bundles and press runs reference the copy (`bundle.die_instance_id`, nullable for
 * legacy stock).
 */

/**
 * in_use = issued to a press line (`die_issue`, die room only); available = in the rack;
 * at_nitriding = out for treatment; at_maker = with the die maker (`die_maker_job`); retired.
 * `in_use` and `at_maker` are written only by issue and maker jobs (rules in `@orrn/domain` dieRoom).
 */
export const dieInstanceStatuses = ["in_use", "available", "at_nitriding", "at_maker", "retired"] as const;
export type DieInstanceStatus = (typeof dieInstanceStatuses)[number];

export const dieInstance = sqliteTable(
  "die_instance",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    /** The section (die catalogue row). Same company is enforced in code, not by the FK. */
    sectionId: text("section_id")
      .notNull()
      .references(() => die.id),
    /** 1, 2, 3 ... per section, allocated at write time and never reused (retired copies keep theirs). */
    seqNo: integer("seq_no").notNull(),
    /** Oblique code `{sectionCode}-{seqNo}` (12170-1): permanent identity, what the floor says and scans. */
    code: text("code").notNull(),
    supplier: text("supplier"),
    /** Trial kg/12ft in thousandths of a kg (equal to grams per 12 ft, the unit of the section band). */
    trialKgPer12ftMilli: integer("trial_kg_per_12ft_milli"),
    /** Surface hardness after the last treatment (HV). */
    hardness: integer("hardness"),
    /** Planned life as total weight extruded, in grams. */
    lifeG: integer("life_g"),
    /** "FTR" from the paper die card; its meaning is not confirmed, so it is kept as written. */
    ftr: text("ftr"),
    status: text("status", { enum: dieInstanceStatuses }).notNull().default("available"),
    /**
     * Tier among the copies of this section: 1 = best (closest to the design weight). Mutable, but
     * only through `die_tier_change` (die room proposes, manager approves). NULL = not ranked yet.
     * Several copies may share a tier.
     */
    tierRank: integer("tier_rank"),
    tierSince: integer("tier_since", { mode: "timestamp_ms" }),
    notes: text("notes"),
    // Die card (FP-DR-07/12). `band_id` null = the section's primary band. `owner_customer_id` null
    // inherits the section owner; a copy cannot opt out to plant-owned while the section is owned (C2).
    // `cavity_count` null inherits the section. No corrector / extrusion ratio (ledger D6).
    bandId: text("band_id").references(() => dieBand.id),
    ownerCustomerId: text("owner_customer_id").references(() => customer.id),
    cavityCount: integer("cavity_count"),
    bolster: text("bolster"),
    backerNo: text("backer_no"),
    subBolster: text("sub_bolster"),
    /** Rack slot, not a stock location. */
    rackNo: text("rack_no"),
    receivedAt: integer("received_at", { mode: "timestamp_ms" }),
    /** The die maker (does not replace the free-text `supplier`). */
    dieMakerId: text("die_maker_id").references(() => dieMaker.id),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(nowMs)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("die_instance_section_seq_unique").on(table.companyId, table.sectionId, table.seqNo),
    index("die_instance_company_code_idx").on(table.companyId, table.code),
    index("die_instance_company_status_idx").on(table.companyId, table.status),
    index("die_instance_company_server_seq_idx").on(table.companyId, table.serverSeq),
    index("die_instance_company_section_idx").on(table.companyId, table.sectionId, table.status),
    index("die_instance_company_owner_idx").on(table.companyId, table.ownerCustomerId),
  ],
);

/**
 * Dated tier history. `initial` rows are written when a copy is created with a tier; every later
 * change starts `pending` with an approval (kind die_rerank, subject = this row's id) and becomes
 * `applied` (the instance's rank changes in the same batch as the approval) or `rejected`.
 */
export const dieTierChangeStatuses = ["pending", "applied", "rejected"] as const;
export type DieTierChangeStatus = (typeof dieTierChangeStatuses)[number];

export const dieTierChange = sqliteTable(
  "die_tier_change",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    dieInstanceId: text("die_instance_id")
      .notNull()
      .references(() => dieInstance.id),
    fromRank: integer("from_rank"),
    toRank: integer("to_rank").notNull(),
    /** Band lift (FP-DR-10): both null = rank only. `to_band_id` null on a lift = back to the primary band. */
    fromBandId: text("from_band_id").references(() => dieBand.id),
    toBandId: text("to_band_id").references(() => dieBand.id),
    /** True when this proposal moves the band (a lift back to primary has `to_band_id` null). */
    isLift: integer("is_lift", { mode: "boolean" }).notNull().default(false),
    reason: text("reason"),
    status: text("status", { enum: dieTierChangeStatuses }).notNull().default("pending"),
    /** The approval that decided it; NULL for `initial` rows. */
    approvalId: text("approval_id"),
    /** When the rank took effect (applied rows only). */
    effectiveAt: integer("effective_at", { mode: "timestamp_ms" }),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(nowMs)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("die_tier_change_instance_idx").on(table.companyId, table.dieInstanceId, table.createdAt),
    index("die_tier_change_company_server_seq_idx").on(table.companyId, table.serverSeq),
    // One open proposal per copy.
    uniqueIndex("die_tier_change_pending_unique")
      .on(table.dieInstanceId)
      .where(sql`${table.status} = 'pending'`),
  ],
);

/**
 * kg/12ft reading of a copy (press, supervisor or die room): the tier evidence. `last` is the
 * copy's previous reading, captured at write time.
 */
export const dieWeightReading = sqliteTable(
  "die_weight_reading",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    dieInstanceId: text("die_instance_id")
      .notNull()
      .references(() => dieInstance.id),
    /** The press run it was taken in. The press run table arrives later; checked in code then. */
    pressRunId: text("press_run_id"),
    /** Current kg/12ft in thousandths of a kg. */
    kgPer12ftMilli: integer("kg_per_12ft_milli").notNull(),
    /** The previous reading of this copy (NULL for the first). */
    lastKgPer12ftMilli: integer("last_kg_per_12ft_milli"),
    readAt: integer("read_at", { mode: "timestamp_ms" }).notNull(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (table) => [
    index("die_weight_reading_instance_idx").on(table.companyId, table.dieInstanceId, table.readAt),
    index("die_weight_reading_company_server_seq_idx").on(table.companyId, table.serverSeq),
  ],
);

/**
 * One nitriding treatment. Chemicals are recorded as open / used / close grams (close = open -
 * used); when the central store lands the same quantities become store issues and
 * `store_txn_id` links them.
 */
export const nitridingLog = sqliteTable(
  "nitriding_log",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    dieInstanceId: text("die_instance_id")
      .notNull()
      .references(() => dieInstance.id),
    nitridedAt: integer("nitrided_at", { mode: "timestamp_ms" }).notNull(),
    /** Hardness measured after the treatment (HV). */
    hardness: integer("hardness"),
    cr4OpenG: integer("cr4_open_g"),
    cr4UsedG: integer("cr4_used_g"),
    cr4CloseG: integer("cr4_close_g"),
    cr2OpenG: integer("cr2_open_g"),
    cr2UsedG: integer("cr2_used_g"),
    cr2CloseG: integer("cr2_close_g"),
    k2sOpenG: integer("k2s_open_g"),
    k2sUsedG: integer("k2s_used_g"),
    k2sCloseG: integer("k2s_close_g"),
    causticOpenG: integer("caustic_open_g"),
    causticUsedG: integer("caustic_used_g"),
    causticCloseG: integer("caustic_close_g"),
    /** Store issue that consumed these chemicals (PL-7); no table yet, so no foreign key. */
    storeTxnId: text("store_txn_id"),
    notes: text("notes"),
    signedBy: text("signed_by").references(() => user.id, { onDelete: "set null" }),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (table) => [
    index("nitriding_log_instance_idx").on(table.companyId, table.dieInstanceId, table.nitridedAt),
    index("nitriding_log_company_server_seq_idx").on(table.companyId, table.serverSeq),
  ],
);

/**
 * A commercial band under a section besides the primary band (`die.weight_min_g/max_g`, which is
 * never copied here). Grams per 12 ft. Retiring sets `active` false; rows are never deleted.
 * Duplicate guard (FP-DR-02): one active band per (section, wall, min, max); the primary band takes
 * part in that check in code.
 */
export const dieBand = sqliteTable(
  "die_band",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    sectionId: text("section_id")
      .notNull()
      .references(() => die.id),
    wallTenthMm: integer("wall_tenth_mm").notNull(),
    weightMinG: integer("weight_min_g").notNull(),
    weightMaxG: integer("weight_max_g").notNull(),
    /** Display only (`6.2-6.6`), max 40. Not identity. */
    label: text("label"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(nowMs)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("die_band_active_unique")
      .on(table.companyId, table.sectionId, table.wallTenthMm, table.weightMinG, table.weightMaxG)
      .where(sql`${table.active} = 1`),
    index("die_band_company_section_idx").on(table.companyId, table.sectionId),
    index("die_band_company_server_seq_idx").on(table.companyId, table.serverSeq),
  ],
);

export const dieFileKinds = ["image", "pdf", "cdr", "dwg"] as const;
export type DieFileKind = (typeof dieFileKinds)[number];

/**
 * A die file in R2 (`{companyId}/dies/{sectionId}/{fileId}`), never bytes in D1. At most one
 * `press_drawing` PDF per section; its key is copied to `die.drawing_key` in the same batch.
 */
export const dieFile = sqliteTable(
  "die_file",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    sectionId: text("section_id")
      .notNull()
      .references(() => die.id),
    /** Set for a photo or correction drawing of one copy. */
    dieInstanceId: text("die_instance_id").references(() => dieInstance.id),
    kind: text("kind", { enum: dieFileKinds }).notNull(),
    r2Key: text("r2_key").notNull(),
    filename: text("filename").notNull(),
    bytes: integer("bytes").notNull(),
    pressDrawing: integer("press_drawing", { mode: "boolean" }).notNull().default(false),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (table) => [
    index("die_file_company_section_idx").on(table.companyId, table.sectionId),
    index("die_file_company_instance_idx").on(table.companyId, table.dieInstanceId),
    uniqueIndex("die_file_press_drawing_unique")
      .on(table.companyId, table.sectionId)
      .where(sql`${table.pressDrawing} = 1`),
  ],
);

export const dieMakerStatuses = ["active", "archived"] as const;

/** Die maker master (not `vendor`). `name_key` = lower-case letters and digits, unique among live rows. */
export const dieMaker = sqliteTable(
  "die_maker",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    name: text("name").notNull(),
    nameKey: text("name_key").notNull(),
    phone: text("phone"),
    city: text("city"),
    notes: text("notes"),
    status: text("status", { enum: dieMakerStatuses }).notNull().default("active"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(nowMs)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("die_maker_company_name_key_unique")
      .on(table.companyId, table.nameKey)
      .where(sql`${table.status} = 'active'`),
    index("die_maker_company_server_seq_idx").on(table.companyId, table.serverSeq),
  ],
);

export const dieMakerJobPurposes = ["trial", "correction", "repair"] as const;
export const dieMakerJobStatuses = ["sent", "received", "cancelled"] as const;
export type DieMakerJobStatus = (typeof dieMakerJobStatuses)[number];

/** A copy sent to the maker: `DM-{seq}` per FY (`doc_series` type `die_maker_job`). One open job per copy. */
export const dieMakerJob = sqliteTable(
  "die_maker_job",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    number: text("number").notNull(),
    period: text("period").notNull(),
    dieInstanceId: text("die_instance_id")
      .notNull()
      .references(() => dieInstance.id),
    dieMakerId: text("die_maker_id")
      .notNull()
      .references(() => dieMaker.id),
    purpose: text("purpose", { enum: dieMakerJobPurposes }).notNull(),
    status: text("status", { enum: dieMakerJobStatuses }).notNull().default("sent"),
    sentAt: integer("sent_at", { mode: "timestamp_ms" }).notNull(),
    receivedAt: integer("received_at", { mode: "timestamp_ms" }),
    note: text("note"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    receivedBy: text("received_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(nowMs)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("die_maker_job_company_number_unique").on(table.companyId, table.period, table.number),
    uniqueIndex("die_maker_job_open_unique")
      .on(table.dieInstanceId)
      .where(sql`${table.status} = 'sent'`),
    index("die_maker_job_company_instance_idx").on(table.companyId, table.dieInstanceId),
    index("die_maker_job_company_server_seq_idx").on(table.companyId, table.serverSeq),
  ],
);

export type DieBandRow = typeof dieBand.$inferSelect;
export type DieFileRow = typeof dieFile.$inferSelect;
export type DieMakerRow = typeof dieMaker.$inferSelect;
export type DieMakerJobRow = typeof dieMakerJob.$inferSelect;
