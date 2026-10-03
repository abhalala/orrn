import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { user } from "./auth";
import { company } from "./tenant";

const nowMs = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

/**
 * Where stock physically sits (spec P6, digest Stage 13): yard 1-6, billet store, scrap store,
 * central store and the plant-scrap bin (wip, for returns). There is no default location and no
 * "location 0"; legacy stock whose place is unknown has `location_id` NULL until it is moved.
 */
export const locationKinds = ["yard", "billet_store", "scrap_store", "store", "wip"] as const;
export type LocationKind = (typeof locationKinds)[number];

export const location = sqliteTable(
  "location",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    /** Short code printed on boards and typed on the floor: Y1..Y6, BILLET, SCRAP, STORE. */
    code: text("code").notNull(),
    name: text("name").notNull(),
    kind: text("kind", { enum: locationKinds }).notNull(),
    /** Retired locations stay for history (ledger rows reference them) but take no new stock. */
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
    uniqueIndex("location_company_code_unique").on(table.companyId, table.code),
    index("location_company_kind_idx").on(table.companyId, table.kind),
    index("location_company_server_seq_idx").on(table.companyId, table.serverSeq),
  ],
);

/**
 * What a ledger row counts. `item_ref` is the id of the bundle, scrap grade, return stream,
 * cast (billets) or store item; it is deliberately not a foreign key so one table can carry
 * every stock kind.
 */
export const ledgerItemKinds = ["bundle", "scrap_grade", "return_stream", "billet", "store_item"] as const;
export type LedgerItemKind = (typeof ledgerItemKinds)[number];

/**
 * Source document of a ledger row (spec §5). Later stages extend this list (purchase lot, melt,
 * press run, QC, store GRN/MRS, …); the column has no CHECK constraint so that is additive.
 * - opening: stock taken on without a pack row (legacy bundles, bulk import)
 * - pack: bundle created (voucher = bundle group / receipt)
 * - move: − at from, + at to (voucher = one move submit)
 * - void: reversal of the bundle's pack row (voucher = the status event)
 * - restore: void undone, the bundle is packed again (voucher = the status event)
 * - dispatch: − bundle kg at its location when the DN completes (voucher = dispatch)
 * - purchase_lot: + scrap (item+grade) at the scrap store when a lot reaches OK (voucher = lot)
 * - dc_note: − bori deduction of a D/C note approved after its lot was OK (voucher = note)
 * - purchase_lot_cancel: reversal of a lot's postings when an OK lot is cancelled (voucher = lot)
 * - store_grn: + store item at the STORE location (voucher = the GRN; qty in milli-units)
 * - store_mrs: − store item at the STORE location (voucher = the MRS; qty in milli-units)
 * - store_grn_cancel / store_mrs_cancel: reversal of a cancelled GRN / MRS (voucher = the same txn id)
 */
export const ledgerVoucherTypes = [
  "opening",
  "pack",
  "move",
  "void",
  "restore",
  "dispatch",
  "purchase_lot",
  "dc_note",
  "purchase_lot_cancel",
  "store_grn",
  "store_mrs",
  "store_grn_cancel",
  "store_mrs_cancel",
] as const;
export type LedgerVoucherType = (typeof ledgerVoucherTypes)[number];

/**
 * Append-only kg stock ledger (spec P5, ADR-003/ADR-004). Rows are only ever INSERTed: no code
 * path updates or deletes them (pinned by a grep test). A correction is a new row with the
 * opposite sign whose `reversal_of` names the row it cancels; a row is "cancelled" exactly when
 * some row reverses it. Stock at any instant = SUM(qty_g) of rows with posted_at <= that instant,
 * ordered by (posted_at, server_seq, line).
 */
export const stockLedger = sqliteTable(
  "stock_ledger",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    /** The posting request's company sequence: sync cursor and creation tiebreak. */
    serverSeq: integer("server_seq").notNull().default(0),
    voucherType: text("voucher_type", { enum: ledgerVoucherTypes }).notNull(),
    voucherId: text("voucher_id").notNull(),
    line: integer("line").notNull(),
    itemKind: text("item_kind", { enum: ledgerItemKinds }).notNull(),
    itemRef: text("item_ref").notNull(),
    /** NULL = place unknown (legacy stock taken on before locations existed). */
    locationId: text("location_id").references(() => location.id, { onDelete: "restrict" }),
    /**
     * Signed grams: + into the location, − out of it. For `item_kind = 'store_item'` the unit is
     * milli-units of the item's own unit (kg, litre, piece, …), not grams.
     */
    qtyG: integer("qty_g").notNull(),
    postedAt: integer("posted_at", { mode: "timestamp_ms" }).notNull(),
    /** The row this one cancels (void reverses pack, restore reverses void). */
    reversalOf: text("reversal_of"),
    reason: text("reason"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (table) => [
    // One posting per voucher line: a double-post of the same voucher fails the whole batch.
    uniqueIndex("stock_ledger_voucher_line_unique").on(
      table.companyId,
      table.voucherType,
      table.voucherId,
      table.line,
    ),
    index("stock_ledger_company_item_idx").on(table.companyId, table.itemKind, table.itemRef),
    index("stock_ledger_company_location_idx").on(table.companyId, table.locationId, table.itemKind),
    index("stock_ledger_company_posted_idx").on(table.companyId, table.postedAt, table.serverSeq),
    index("stock_ledger_company_server_seq_idx").on(table.companyId, table.serverSeq),
    index("stock_ledger_company_reversal_idx").on(table.companyId, table.reversalOf),
  ],
);

export type LocationRow = typeof location.$inferSelect;
export type StockLedgerRow = typeof stockLedger.$inferSelect;
