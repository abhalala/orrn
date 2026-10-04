import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { user } from "./auth";
import { location } from "./stock";
import { company } from "./tenant";

const nowMs = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

/**
 * Scrap purchase (spec P14, digest Stages 1-2, §3.1).
 *
 * Scrap is the plant's raw material. A truck arrives with the vendor's weighbridge slip ("party
 * kanta"); the plant weighs it again on its own scale ("FC kanta"). When FC kg is short of party
 * kg beyond the tolerance (`company.settings.dcTolerancePct`, basis points, default 50 = 0.5 %),
 * the lot cannot be marked OK without a debit note on the weight (pending or approved). Brokers
 * ("K" in a party name, dalal) are not recorded: the vendor is the party that sold the scrap.
 */

/**
 * draft  = created inline at the kanta by yard staff; a masters.publish holder confirms it.
 * active = confirmed master.
 * merged = folded into another vendor (`merged_into_id`); its name lives on as an alias there.
 * archived = no new lots.
 */
export const vendorStatuses = ["draft", "active", "merged", "archived"] as const;
export type VendorStatus = (typeof vendorStatuses)[number];

export const vendor = sqliteTable(
  "vendor",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    name: text("name").notNull(),
    /** Lower-case letters and digits of the name ("K.D. METALS" → "kdmetals"): what lookups compare. */
    nameKey: text("name_key").notNull(),
    /** NULL = unregistered dealer (many scrap sellers are). */
    gstin: text("gstin"),
    phone: text("phone"),
    city: text("city"),
    status: text("status", { enum: vendorStatuses }).notNull().default("active"),
    /** Set when status = merged: the vendor that took over its lots and aliases. */
    mergedIntoId: text("merged_into_id"),
    notes: text("notes"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(nowMs)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    // One live vendor per normalised name; merged vendors keep their row for history.
    uniqueIndex("vendor_company_name_key_unique")
      .on(table.companyId, table.nameKey)
      .where(sql`${table.status} <> 'merged'`),
    index("vendor_company_status_idx").on(table.companyId, table.status),
    index("vendor_company_server_seq_idx").on(table.companyId, table.serverSeq),
  ],
);

/** Other spellings the floor and the book use for a vendor ("KD Metal", "K.D. METALS"). */
export const vendorAlias = sqliteTable(
  "vendor_alias",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    vendorId: text("vendor_id")
      .notNull()
      .references(() => vendor.id, { onDelete: "cascade" }),
    alias: text("alias").notNull(),
    aliasKey: text("alias_key").notNull(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (table) => [
    // A spelling resolves to exactly one vendor.
    uniqueIndex("vendor_alias_company_key_unique").on(table.companyId, table.aliasKey),
    index("vendor_alias_vendor_idx").on(table.companyId, table.vendorId),
    index("vendor_alias_company_server_seq_idx").on(table.companyId, table.serverSeq),
  ],
);

/** What the scrap is ("quality" in the book): imp belling, soft cable, kagal patti, centring, … */
export const scrapItem = sqliteTable(
  "scrap_item",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    name: text("name").notNull(),
    nameKey: text("name_key").notNull(),
    /** Expected metal recovery for this item, basis points (9200 = 92 %). */
    expectedRecoveryBp: integer("expected_recovery_bp"),
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
    uniqueIndex("scrap_item_company_name_key_unique").on(table.companyId, table.nameKey),
    index("scrap_item_company_server_seq_idx").on(table.companyId, table.serverSeq),
  ],
);

/** Scrap grade ladder: A+ / A / B / C. */
export const scrapGrade = sqliteTable(
  "scrap_grade",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    /** As written in the book: "A+", "A", "B", "C". Stored upper case. */
    code: text("code").notNull(),
    name: text("name"),
    /** Expected recovery for this grade, basis points; an item's own figure wins when set. */
    expectedRecoveryBp: integer("expected_recovery_bp"),
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
    uniqueIndex("scrap_grade_company_code_unique").on(table.companyId, table.code),
    index("scrap_grade_company_server_seq_idx").on(table.companyId, table.serverSeq),
  ],
);

/** main = the purchase book; wb = the shorter w-bill book; ub = part of the lot went to the w-bill. */
export const billBooks = ["main", "wb", "ub"] as const;
export type BillBook = (typeof billBooks)[number];

/**
 * booking = truck announced / booked; unload = at the kanta, being weighed and unloaded;
 * ok = weights and grade accepted, scrap is in stock (ledger posted); cancelled = never received,
 * or an OK lot reversed (ledger reversal rows).
 */
export const purchaseLotStatuses = ["booking", "unload", "ok", "cancelled"] as const;
export type PurchaseLotStatus = (typeof purchaseLotStatuses)[number];

export const purchaseLot = sqliteTable(
  "purchase_lot",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    /** LOT-{n} from the doc series; `n` restarts each financial year (`period`). */
    number: text("number").notNull(),
    period: text("period").notNull(),
    vendorId: text("vendor_id")
      .notNull()
      .references(() => vendor.id),
    /** Book date `YYYY-MM-DD` (plant wall clock). */
    lotDate: text("lot_date").notNull(),
    /** "type of material" in the book: LOCAL, EC GRADE, MALAYSIA 6063, DUBAI, … */
    origin: text("origin"),
    scrapItemId: text("scrap_item_id")
      .notNull()
      .references(() => scrapItem.id),
    scrapGradeId: text("scrap_grade_id")
      .notNull()
      .references(() => scrapGrade.id),
    /** Party kanta (vendor's weighbridge slip), grams. */
    partyKgG: integer("party_kg_g").notNull(),
    /** FC kanta (plant's own scale), grams; NULL until weighed. */
    fcKgG: integer("fc_kg_g"),
    /** Rate per kg, paise. */
    ratePaise: integer("rate_paise").notNull(),
    drossBp: integer("dross_bp"),
    billBook: text("bill_book", { enum: billBooks }).notNull().default("main"),
    /** The party's bill / invoice number. */
    partyBillNo: text("party_bill_no"),
    vehicleNo: text("vehicle_no"),
    /** Challan and kanta slip photos (URLs; upload arrives later). */
    photoUrls: text("photo_urls", { mode: "json" }).$type<string[]>().notNull().default([]),
    status: text("status", { enum: purchaseLotStatuses }).notNull().default("booking"),
    /** Scrap store the lot was put into at OK. */
    locationId: text("location_id").references(() => location.id, { onDelete: "restrict" }),
    okAt: integer("ok_at", { mode: "timestamp_ms" }),
    okBy: text("ok_by").references(() => user.id, { onDelete: "set null" }),
    cancelledAt: integer("cancelled_at", { mode: "timestamp_ms" }),
    cancelledBy: text("cancelled_by").references(() => user.id, { onDelete: "set null" }),
    cancelReason: text("cancel_reason"),
    notes: text("notes"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(nowMs)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("purchase_lot_company_number_unique").on(table.companyId, table.period, table.number),
    index("purchase_lot_company_date_idx").on(table.companyId, table.lotDate),
    index("purchase_lot_company_vendor_idx").on(table.companyId, table.vendorId, table.lotDate),
    index("purchase_lot_company_status_idx").on(table.companyId, table.status),
    index("purchase_lot_company_server_seq_idx").on(table.companyId, table.serverSeq),
  ],
);

export const dcNoteTypes = ["debit", "credit"] as const;
export type DcNoteType = (typeof dcNoteTypes)[number];
export const dcNoteReasons = ["weight", "grade"] as const;
export type DcNoteReason = (typeof dcNoteReasons)[number];
export const dcNoteStatuses = ["pending", "approved", "rejected"] as const;
export type DcNoteStatus = (typeof dcNoteStatuses)[number];

/**
 * Debit / credit note on a lot (digest Stage 2): office raises it, a manager approves it through
 * an `approval` of kind dc_note (subject = this row). `kg_diff_g` is the weight being billed back
 * (party − FC for a short lot) and `bori_deduction_g` the bag weight taken off. Once approved, the
 * bori deduction comes off the lot's stock (ledger) and both come off the payable weight.
 */
export const dcNote = sqliteTable(
  "dc_note",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    /** DCN-{n}, restarting each financial year (`period`). */
    number: text("number").notNull(),
    period: text("period").notNull(),
    lotId: text("lot_id")
      .notNull()
      .references(() => purchaseLot.id),
    type: text("type", { enum: dcNoteTypes }).notNull(),
    reason: text("reason", { enum: dcNoteReasons }).notNull(),
    kgDiffG: integer("kg_diff_g").notNull().default(0),
    boriDeductionG: integer("bori_deduction_g").notNull().default(0),
    /** Money value of the note, paise (default: (kg diff + bori) × lot rate). */
    amountPaise: integer("amount_paise").notNull().default(0),
    /** The company's tolerance when the note was raised, basis points. */
    toleranceBp: integer("tolerance_bp").notNull(),
    note: text("note"),
    status: text("status", { enum: dcNoteStatuses }).notNull().default("pending"),
    approvalId: text("approval_id"),
    decidedAt: integer("decided_at", { mode: "timestamp_ms" }),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(nowMs)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("dc_note_company_number_unique").on(table.companyId, table.period, table.number),
    index("dc_note_company_lot_idx").on(table.companyId, table.lotId),
    index("dc_note_company_status_idx").on(table.companyId, table.status),
    index("dc_note_company_server_seq_idx").on(table.companyId, table.serverSeq),
    // One note waiting for a decision per lot.
    uniqueIndex("dc_note_pending_lot_unique")
      .on(table.lotId)
      .where(sql`${table.status} = 'pending'`),
  ],
);

export type VendorRow = typeof vendor.$inferSelect;
export type PurchaseLotRow = typeof purchaseLot.$inferSelect;
export type DcNoteRow = typeof dcNote.$inferSelect;
