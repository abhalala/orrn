import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { user } from "./auth";
import { die } from "./catalog";
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

/** in_use = on the press or in the oven queue; available = in the rack; at_nitriding = out for treatment. */
export const dieInstanceStatuses = ["in_use", "available", "at_nitriding", "retired"] as const;
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
