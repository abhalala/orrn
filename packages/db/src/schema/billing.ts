/**
 * XE-BILL (migration 0059): tax invoice, credit note, GST settings, payments received, and the
 * e-invoice (IRN) / e-way bill state. Both modules (`billing`, `einvoice`) are opt-in.
 *
 * Single sources: the plant's GSTIN and legal name stay in `company.settings.letterhead`; a customer's
 * GSTIN stays in `customer.tax_id`. These tables hold only what billing adds (state, pincode, ship-to,
 * tax category, HSN).
 *
 * Money is integer paise; weights are integer grams. An invoice is built from frozen packing list
 * revisions (`invoice_source`), never from a live order. Numbers come from `doc_series` inside the
 * issuing batch (lib/billing/numbering.ts), so an issued number is never skipped or reused.
 */
import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { user } from "./auth";
import { die } from "./catalog";
import { customer } from "./customers";
import { dispatch } from "./dispatch";
import { packingList } from "./packing";
import { company } from "./tenant";

const nowMs = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

/** GST treatment of a party (india-compliance "gst_category", our words). */
export const gstTaxCategories = [
  "regular",
  "unregistered",
  "sez_with_payment",
  "sez_without_payment",
  "export_with_payment",
  "export_without_payment",
] as const;
export type GstTaxCategory = (typeof gstTaxCategories)[number];

/** Where the goods go: the bill-to address, another customer of the plant, or a typed address. */
export const shipToKinds = ["same", "party", "address"] as const;

export const invoiceKinds = ["invoice", "credit_note"] as const;
export type InvoiceKind = (typeof invoiceKinds)[number];

/**
 * draft: built, no number. irn_pending: numbered, waiting for its IRN (einvoice on and the party
 * needs one); prints "Draft, IRN pending" and is never final. issued: final. cancelled: the number
 * stays used.
 */
export const invoiceStatuses = ["draft", "irn_pending", "issued", "cancelled"] as const;
export type InvoiceStatus = (typeof invoiceStatuses)[number];

/** IRN status machine (india-compliance pattern): none -> pending -> auto_retry -> generated | failed. */
export const irnStatuses = ["none", "pending", "auto_retry", "generated", "failed", "cancelled"] as const;
export type IrnStatus = (typeof irnStatuses)[number];

export const ewbStatuses = ["none", "active", "cancelled"] as const;
export type EwbStatus = (typeof ewbStatuses)[number];

export const creditNoteReasons = ["return", "rate_difference", "other"] as const;

export const paymentModes = ["cash", "cheque", "neft", "rtgs", "upi", "card", "other"] as const;
export type PaymentMode = (typeof paymentModes)[number];

/** One row per plant: what the tax invoice needs beyond the letterhead. */
export const billingSettings = sqliteTable("billing_settings", {
  companyId: text("company_id")
    .primaryKey()
    .references(() => company.id, { onDelete: "cascade" }),
  serverSeq: integer("server_seq").notNull().default(0),
  /** Two-digit GST state code of the plant ("24" Gujarat). Must match the GSTIN's first two digits. */
  stateCode: text("state_code"),
  pincode: text("pincode"),
  /** City / place printed and sent as SellerDtls.Loc. */
  place: text("place"),
  tradeName: text("trade_name"),
  /** Who signs ("For <legal name>" prints above it). */
  signatory: text("signatory"),
  /** Terms printed under the totals. */
  terms: text("terms"),
  /** Day (YYYY-MM-DD) from which invoices to registered parties need an IRN (einvoice module). */
  einvoiceFrom: text("einvoice_from"),
  /** Tally ledger names for the XML export; null keys use the defaults (lib/billing/tally.ts). */
  tallyLedgers: text("tally_ledgers", { mode: "json" }).$type<Record<string, string>>(),
  updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
});

/** HSN codes the plant bills under, with the GST rate (basis points: 1800 = 18 %) and UQC. */
export const gstHsn = sqliteTable(
  "gst_hsn",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    code: text("code").notNull(),
    description: text("description").notNull(),
    rateBp: integer("rate_bp").notNull(),
    uqc: text("uqc").notNull().default("KGS"),
    /** The HSN a section without its own falls back to. At most one per plant (lib checks). */
    isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (table) => [uniqueIndex("gst_hsn_company_code_unique").on(table.companyId, table.code)],
);

/** A section's own HSN (product class), else the plant default. */
export const gstSectionHsn = sqliteTable(
  "gst_section_hsn",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    dieId: text("die_id")
      .notNull()
      .references(() => die.id, { onDelete: "cascade" }),
    hsnId: text("hsn_id")
      .notNull()
      .references(() => gstHsn.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (table) => [uniqueIndex("gst_section_hsn_company_die_unique").on(table.companyId, table.dieId)],
);

/** GST facts of one customer beyond `customer.tax_id`: state, pincode, category, ship-to party. */
export const customerGst = sqliteTable(
  "customer_gst",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    customerId: text("customer_id")
      .notNull()
      .references(() => customer.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    taxCategory: text("tax_category", { enum: gstTaxCategories }).notNull().default("regular"),
    /** Bill-to state code; for a registered party it must equal the GSTIN's first two digits. */
    stateCode: text("state_code"),
    pincode: text("pincode"),
    place: text("place"),
    /** Place of supply when it is not the bill-to state (explicit, never inferred). Null = bill-to state. */
    placeOfSupply: text("place_of_supply"),
    shipToKind: text("ship_to_kind", { enum: shipToKinds }).notNull().default("same"),
    shipToCustomerId: text("ship_to_customer_id").references(() => customer.id, { onDelete: "set null" }),
    shipToName: text("ship_to_name"),
    shipToGstin: text("ship_to_gstin"),
    shipToAddress: text("ship_to_address"),
    shipToPlace: text("ship_to_place"),
    shipToStateCode: text("ship_to_state_code"),
    shipToPincode: text("ship_to_pincode"),
    /** Road distance plant to ship-to, for the e-way bill (km). */
    distanceKm: integer("distance_km"),
    updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (table) => [uniqueIndex("customer_gst_company_customer_unique").on(table.companyId, table.customerId)],
);

/** A tax invoice or a credit note. Totals are stored; the frozen lines live in `snapshot`. */
export const invoice = sqliteTable(
  "invoice",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    kind: text("kind", { enum: invoiceKinds }).notNull().default("invoice"),
    status: text("status", { enum: invoiceStatuses }).notNull().default("draft"),
    /** Financial year of the number (`2026-27`); null while a draft. */
    period: text("period"),
    seq: integer("seq"),
    number: text("number"),
    /** Company calendar day of issue (YYYY-MM-DD); null while a draft. */
    invoiceDate: text("invoice_date"),
    customerId: text("customer_id")
      .notNull()
      .references(() => customer.id, { onDelete: "restrict" }),
    /** Credit note: the invoice it reduces. */
    againstInvoiceId: text("against_invoice_id"),
    noteReason: text("note_reason", { enum: creditNoteReasons }),
    reason: text("reason"),
    /** intra | inter | sez_wp | sez_wop | exp_wp | exp_wop (domain `SupplyType`). */
    supplyType: text("supply_type").notNull(),
    placeOfSupply: text("place_of_supply").notNull(),
    weightG: integer("weight_g").notNull().default(0),
    taxablePaise: integer("taxable_paise").notNull().default(0),
    cgstPaise: integer("cgst_paise").notNull().default(0),
    sgstPaise: integer("sgst_paise").notNull().default(0),
    igstPaise: integer("igst_paise").notNull().default(0),
    roundOffPaise: integer("round_off_paise").notNull().default(0),
    totalPaise: integer("total_paise").notNull().default(0),
    snapshot: text("snapshot", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    // ---- e-invoice (IRN) ----
    needsIrn: integer("needs_irn", { mode: "boolean" }).notNull().default(false),
    irnStatus: text("irn_status", { enum: irnStatuses }).notNull().default("none"),
    irn: text("irn"),
    ackNo: text("ack_no"),
    ackDt: text("ack_dt"),
    signedInvoice: text("signed_invoice"),
    signedQrCode: text("signed_qr_code"),
    irnAttempts: integer("irn_attempts").notNull().default(0),
    irnNextTryAt: integer("irn_next_try_at", { mode: "timestamp_ms" }),
    irnError: text("irn_error"),
    irnGeneratedAt: integer("irn_generated_at", { mode: "timestamp_ms" }),
    irnCancelledAt: integer("irn_cancelled_at", { mode: "timestamp_ms" }),
    // ---- e-way bill ----
    ewbStatus: text("ewb_status", { enum: ewbStatuses }).notNull().default("none"),
    ewbNo: text("ewb_no"),
    ewbDate: integer("ewb_date", { mode: "timestamp_ms" }),
    ewbValidUntil: integer("ewb_valid_until", { mode: "timestamp_ms" }),
    distanceKm: integer("distance_km"),
    vehicleNo: text("vehicle_no"),
    // ---- cancel ----
    cancelReason: text("cancel_reason"),
    cancelApprovalId: text("cancel_approval_id"),
    cancelledBy: text("cancelled_by").references(() => user.id, { onDelete: "set null" }),
    cancelledAt: integer("cancelled_at", { mode: "timestamp_ms" }),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    issuedBy: text("issued_by").references(() => user.id, { onDelete: "set null" }),
    issuedAt: integer("issued_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (table) => [
    uniqueIndex("invoice_company_kind_period_seq_unique").on(table.companyId, table.kind, table.period, table.seq),
    index("invoice_company_customer_idx").on(table.companyId, table.customerId),
    index("invoice_company_status_idx").on(table.companyId, table.status),
    index("invoice_company_against_idx").on(table.companyId, table.againstInvoiceId),
    index("invoice_irn_retry_idx").on(table.irnStatus, table.irnNextTryAt),
  ],
);

/**
 * The frozen packing list revision(s) an invoice bills, one row per dispatch they cover. `active`
 * goes to 0 when the invoice is cancelled or its draft discarded. A dispatch is in at most one live
 * invoice (partial unique index in the migration), so a combined list and its parts are never both billed.
 */
export const invoiceSource = sqliteTable(
  "invoice_source",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    invoiceId: text("invoice_id")
      .notNull()
      .references(() => invoice.id, { onDelete: "cascade" }),
    packingListId: text("packing_list_id")
      .notNull()
      .references(() => packingList.id, { onDelete: "restrict" }),
    plCode: text("pl_code").notNull(),
    plRevision: integer("pl_revision").notNull(),
    dispatchId: text("dispatch_id")
      .notNull()
      .references(() => dispatch.id, { onDelete: "restrict" }),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (table) => [
    index("invoice_source_company_invoice_idx").on(table.companyId, table.invoiceId),
    index("invoice_source_company_pl_idx").on(table.companyId, table.packingListId),
    // One live invoice per dispatch: a combined list and its parts share dispatches, so both can never be billed.
    uniqueIndex("invoice_source_live_dispatch_unique").on(table.companyId, table.dispatchId).where(sql`${table.active} = 1`),
  ],
);

/** Money received from a customer (full or part), against one or more invoices. */
export const payment = sqliteTable(
  "payment",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    period: text("period").notNull(),
    seq: integer("seq").notNull(),
    number: text("number").notNull(),
    customerId: text("customer_id")
      .notNull()
      .references(() => customer.id, { onDelete: "restrict" }),
    /** Company calendar day the money came in (YYYY-MM-DD). */
    receivedOn: text("received_on").notNull(),
    amountPaise: integer("amount_paise").notNull(),
    mode: text("mode", { enum: paymentModes }).notNull(),
    reference: text("reference"),
    note: text("note"),
    status: text("status", { enum: ["active", "void"] }).notNull().default("active"),
    voidReason: text("void_reason"),
    voidedBy: text("voided_by").references(() => user.id, { onDelete: "set null" }),
    voidedAt: integer("voided_at", { mode: "timestamp_ms" }),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (table) => [
    uniqueIndex("payment_company_period_seq_unique").on(table.companyId, table.period, table.seq),
    index("payment_company_customer_idx").on(table.companyId, table.customerId),
  ],
);

/** How much of a payment settles which invoice. Sum per payment never exceeds its amount. */
export const paymentAllocation = sqliteTable(
  "payment_allocation",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    paymentId: text("payment_id")
      .notNull()
      .references(() => payment.id, { onDelete: "cascade" }),
    invoiceId: text("invoice_id")
      .notNull()
      .references(() => invoice.id, { onDelete: "restrict" }),
    amountPaise: integer("amount_paise").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (table) => [
    index("payment_allocation_company_invoice_idx").on(table.companyId, table.invoiceId),
    index("payment_allocation_company_payment_idx").on(table.companyId, table.paymentId),
  ],
);

/**
 * Every IRN / e-way bill call and its outcome (india-compliance e_invoice_log pattern), plus the
 * batch-abort target of billing writes (an INSERT with a NULL id fails the batch on purpose).
 * Never holds credentials; `message` is the relay's error text, at most 500 characters.
 */
export const billingEvent = sqliteTable(
  "billing_event",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    invoiceId: text("invoice_id").references(() => invoice.id, { onDelete: "cascade" }),
    action: text("action").notNull(),
    outcome: text("outcome").notNull(),
    code: text("code"),
    message: text("message"),
    at: integer("at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (table) => [index("billing_event_company_invoice_idx").on(table.companyId, table.invoiceId, table.at)],
);
