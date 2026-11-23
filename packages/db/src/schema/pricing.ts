import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { approval } from "./approval";
import { user } from "./auth";
import { die } from "./catalog";
import { customer } from "./customers";
import { salesOrder } from "./sales";
import { company } from "./tenant";

const nowMs = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

/**
 * XE-PRICE (migration 0058): the price master. ONE effective-dated table for every rate kind
 * (`@orrn/domain` PRICE_RATE_KINDS): base metal (key = nalco | lme | manual), conversion (key =
 * default | series:<series> | die:<dieId>), alloy surcharge (key = alloy), finish (key = finish),
 * component add-on (key = slug; detail { label, basis: piece | order }), customer term (key =
 * <customerId>:<conversion | discount | fixed>) and line override (key = sales order line id).
 *
 * A row's figures are never edited. A new rate is a new row, `pending` until a second person
 * approves it (approval kind `price_change`, subject = this row), then `active`; a rejection makes
 * it `rejected`. Until then the previous active row applies (`resolveRate`). A line override at or
 * above the computed rate is `active` at once (no approval needed).
 */
export const priceRate = sqliteTable(
  "price_rate",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    kind: text("kind").notNull(),
    key: text("key").notNull(),
    /** Paise per kg (per piece / per order for a component). */
    paise: integer("paise").notNull(),
    /** Company calendar date `YYYY-MM-DD`. */
    effectiveFrom: text("effective_from").notNull(),
    status: text("status").notNull().default("pending"),
    /** LME inputs, component label and basis, the line's computed rate at the ask, … */
    detail: text("detail", { mode: "json" }).$type<Record<string, unknown>>(),
    reason: text("reason"),
    approvalId: text("approval_id").references(() => approval.id, { onDelete: "set null" }),
    decidedBy: text("decided_by").references(() => user.id, { onDelete: "set null" }),
    decidedAt: integer("decided_at", { mode: "timestamp_ms" }),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (table) => [
    index("price_rate_company_kind_key_idx").on(table.companyId, table.kind, table.key, table.effectiveFrom),
    index("price_rate_company_status_idx").on(table.companyId, table.status),
  ],
);

/**
 * A quotation (row 10): a customer, priced lines, a validity date and a `Q-{n}` number per FY
 * (`doc_series` type `quote`). draft → sent → converted (to a booking sales order); draft / sent →
 * cancelled. Expired is read from `valid_until`.
 */
export const quote = sqliteTable(
  "quote",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    period: text("period").notNull(),
    number: text("number").notNull(),
    customerId: text("customer_id")
      .notNull()
      .references(() => customer.id, { onDelete: "restrict" }),
    quoteDate: text("quote_date").notNull(),
    validUntil: text("valid_until").notNull(),
    status: text("status").notNull().default("draft"),
    note: text("note"),
    /** Whole-order add-ons (per order components) as priced: [{ key, label, paise, rateId }]. */
    charges: text("charges", { mode: "json" }).$type<Record<string, unknown>[]>(),
    salesOrderId: text("sales_order_id").references(() => salesOrder.id, { onDelete: "set null" }),
    enquiryId: text("enquiry_id"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(nowMs)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("quote_company_period_number_unique").on(table.companyId, table.period, table.number),
    index("quote_company_status_idx").on(table.companyId, table.status, table.quoteDate),
    index("quote_company_customer_idx").on(table.companyId, table.customerId),
  ],
);

export const quoteLine = sqliteTable(
  "quote_line",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    quoteId: text("quote_id")
      .notNull()
      .references(() => quote.id, { onDelete: "cascade" }),
    lineNo: integer("line_no").notNull(),
    dieId: text("die_id")
      .notNull()
      .references(() => die.id, { onDelete: "restrict" }),
    cutLengthMm: integer("cut_length_mm").notNull(),
    pcs: integer("pcs"),
    kgG: integer("kg_g").notNull(),
    finish: text("finish"),
    alloy: text("alloy"),
    temper: text("temper"),
    /** Final rate per kg in paise, from the master when the quote was priced. */
    ratePaise: integer("rate_paise").notNull(),
    priceBreakup: text("price_breakup", { mode: "json" }).$type<Record<string, unknown>>(),
    note: text("note"),
  },
  (table) => [
    uniqueIndex("quote_line_quote_no_unique").on(table.quoteId, table.lineNo),
    index("quote_line_company_quote_idx").on(table.companyId, table.quoteId),
  ],
);

/**
 * A proforma invoice (row 11) as printed: a `PI-{n}` number per FY (`doc_series` type `proforma`)
 * and the frozen snapshot the print reads (lines, rates, estimated GST, bank line). Not a tax
 * invoice and not a ledger document: nothing posts from it.
 */
export const proforma = sqliteTable(
  "proforma",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    period: text("period").notNull(),
    number: text("number").notNull(),
    /** `order` or `quote`. */
    sourceKind: text("source_kind").notNull(),
    sourceId: text("source_id").notNull(),
    customerId: text("customer_id")
      .notNull()
      .references(() => customer.id, { onDelete: "restrict" }),
    snapshot: text("snapshot", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (table) => [
    uniqueIndex("proforma_company_period_number_unique").on(table.companyId, table.period, table.number),
    index("proforma_company_source_idx").on(table.companyId, table.sourceKind, table.sourceId),
  ],
);

/**
 * The works order number of a sales order (row 12): one `WO-{n}` per order, per FY (`doc_series`
 * type `works_order`), taken the first time it is printed. The print itself reads the live order.
 */
export const worksOrder = sqliteTable(
  "works_order",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    salesOrderId: text("sales_order_id")
      .notNull()
      .references(() => salesOrder.id, { onDelete: "cascade" }),
    period: text("period").notNull(),
    number: text("number").notNull(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (table) => [
    uniqueIndex("works_order_company_order_unique").on(table.companyId, table.salesOrderId),
    uniqueIndex("works_order_company_period_number_unique").on(table.companyId, table.period, table.number),
  ],
);

/**
 * An enquiry (row 19): a customer or a prospect by name, the section asked for, kg, a follow-up
 * date and a status (`@orrn/domain` ENQUIRY_STATUSES), optionally linked to a quote.
 */
export const enquiry = sqliteTable(
  "enquiry",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    customerId: text("customer_id").references(() => customer.id, { onDelete: "set null" }),
    prospectName: text("prospect_name"),
    contact: text("contact"),
    dieId: text("die_id").references(() => die.id, { onDelete: "set null" }),
    /** The section as the buyer named it, when it is not in the catalogue. */
    sectionText: text("section_text"),
    kgG: integer("kg_g"),
    followUpDate: text("follow_up_date"),
    status: text("status").notNull().default("open"),
    quoteId: text("quote_id").references(() => quote.id, { onDelete: "set null" }),
    note: text("note"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(nowMs)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("enquiry_company_status_follow_idx").on(table.companyId, table.status, table.followUpDate),
  ],
);
