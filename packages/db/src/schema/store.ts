import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { user } from "./auth";
import { location } from "./stock";
import { company } from "./tenant";

const nowMs = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

/**
 * Central store (spec P17, digest Stage 18): consumables and spares the plant buys and draws
 * down: chemicals (cover flux, CR4, CR2, K2S, caustic soda), fuel (LDO), gas (nitriding), spares
 * (bearings, belts). Quantities are integer MILLI-UNITS of the item's unit (`qty_milli`; 1000 =
 * 1 kg / 1 litre / 1 piece), so 12.345 kg is stored as 12345. The ledger carries the same number
 * in its generic `qty_g` column for `item_kind = 'store_item'`.
 */
export const storeUnits = ["kg", "litre", "piece", "metre", "set", "box", "bag"] as const;
export type StoreUnit = (typeof storeUnits)[number];

/** Units that only come in whole numbers: a half piece is not a thing. */
export const COUNTABLE_STORE_UNITS: readonly StoreUnit[] = ["piece", "set", "box", "bag"];

export const storeCategories = ["chemical", "fuel", "gas", "spare", "other"] as const;
export type StoreCategory = (typeof storeCategories)[number];

export const storeItem = sqliteTable(
  "store_item",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    name: text("name").notNull(),
    /** Lower-case letters and digits of the name: one live item per key. */
    nameKey: text("name_key").notNull(),
    unit: text("unit", { enum: storeUnits }).notNull(),
    category: text("category", { enum: storeCategories }).notNull().default("other"),
    /**
     * Retired items take no new movements and can only be retired at a balance of 0. `retired_at`
     * is set exactly when `active` is false; the name is unique among items with no `retired_at`.
     */
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    retiredAt: integer("retired_at", { mode: "timestamp_ms" }),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(nowMs)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    // One ACTIVE item per normalised name: a retired "Cover flux" does not block a new one.
    uniqueIndex("store_item_company_name_key_unique")
      .on(table.companyId, table.nameKey)
      .where(sql`${table.retiredAt} is null`),
    index("store_item_company_server_seq_idx").on(table.companyId, table.serverSeq),
  ],
);

export const storeTxnKinds = ["grn", "mrs"] as const;
export type StoreTxnKind = (typeof storeTxnKinds)[number];

/** Why an MRS drew stock. `exchange` is only ever the outgoing leg of `store.exchange`. */
export const storeIssuePurposes = ["melt", "nitriding", "maintenance", "exchange", "other"] as const;
export type StoreIssuePurpose = (typeof storeIssuePurposes)[number];

/**
 * One store document: a GRN (goods received, + stock) or an MRS (material requisition, issue,
 * − stock). The row is the document; its single ledger row (voucher = this id, line 1) is the
 * stock effect, written in the same batch. An old-for-new exchange is two rows, an MRS for the old
 * and a GRN for the new, sharing `exchange_id`. Numbers `GRN-{n}` / `MRS-{n}` restart each
 * financial year (`period`), so the unique key includes the period.
 */
export const storeTxn = sqliteTable(
  "store_txn",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    kind: text("kind", { enum: storeTxnKinds }).notNull(),
    number: text("number").notNull(),
    period: text("period").notNull(),
    itemId: text("item_id")
      .notNull()
      .references(() => storeItem.id, { onDelete: "restrict" }),
    /** Always positive; the sign comes from `kind`. */
    qtyMilli: integer("qty_milli").notNull(),
    /** The store location the stock moved at (kind `store`). */
    locationId: text("location_id")
      .notNull()
      .references(() => location.id, { onDelete: "restrict" }),
    /** MRS only. */
    purpose: text("purpose", { enum: storeIssuePurposes }),
    /** MRS only: the melt, nitriding log or job the issue is for (opaque id, not a foreign key). */
    refId: text("ref_id"),
    /** GRN only: the vendor's challan or bill number. */
    grnRef: text("grn_ref"),
    /** Both legs of one exchange carry the same id. */
    exchangeId: text("exchange_id"),
    note: text("note"),
    /**
     * Client-generated idempotency key (the app's retry/offline queue): a second submit with the
     * same key returns the first entry. Exchanges carry it on the outgoing (MRS) leg.
     */
    clientRequestId: text("client_request_id"),
    /**
     * Cancelled entries keep their number; a `store_*_cancel` ledger row reverses the stock effect.
     * Both legs of an exchange are cancelled together.
     */
    cancelledAt: integer("cancelled_at", { mode: "timestamp_ms" }),
    cancelledBy: text("cancelled_by").references(() => user.id, { onDelete: "set null" }),
    cancelReason: text("cancel_reason"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    /** NULL until the entry is changed (cancelled). */
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    uniqueIndex("store_txn_company_request_unique")
      .on(table.companyId, table.clientRequestId)
      .where(sql`${table.clientRequestId} is not null`),
    uniqueIndex("store_txn_company_number_unique").on(table.companyId, table.kind, table.period, table.number),
    index("store_txn_company_item_idx").on(table.companyId, table.itemId, table.createdAt),
    index("store_txn_company_created_idx").on(table.companyId, table.createdAt),
    index("store_txn_company_exchange_idx").on(table.companyId, table.exchangeId),
    index("store_txn_company_server_seq_idx").on(table.companyId, table.serverSeq),
  ],
);

export type StoreItemRow = typeof storeItem.$inferSelect;
export type StoreTxnRow = typeof storeTxn.$inferSelect;
