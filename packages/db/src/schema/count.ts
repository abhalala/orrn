import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { user } from "./auth";
import { die } from "./catalog";
import { bundle } from "./inventory";
import { location } from "./stock";
import { company } from "./tenant";

const nowMs = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

/**
 * Stock count (spec P6, §5 "Count close"; digest Stage 14). A count covers one or more yard
 * locations: everything there is scanned, the missing list is shown before close, and close
 * freezes the phantom / found / moved report. Close writes no kg rows: the closed session is the
 * checkpoint ("balance restarts here"). Phantoms are voided only through a `phantom_void`
 * approval (manager); found bundles are moved to where they were seen with ordinary move rows.
 *
 * - open: scanning; each location is in at most one open count (count_location partial unique).
 * - closed: report frozen in count_line; resolutions still apply.
 * - cancelled: abandoned (reason kept); nothing is reported.
 */
export const countStatuses = ["open", "closed", "cancelled"] as const;
export type CountStatus = (typeof countStatuses)[number];

export const countSession = sqliteTable(
  "count_session",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    /** `CNT-{n}` from nextDocNumber("count"), restarting each financial year (`period`). */
    number: text("number").notNull(),
    period: text("period").notNull(),
    status: text("status", { enum: countStatuses }).notNull().default("open"),
    /**
     * The start request's company sequence. Ledger rows with a higher `server_seq` were written
     * after the count began: a bundle that arrived (or changed) at a counted location during the
     * count and was not scanned is not called a phantom.
     */
    startSeq: integer("start_seq").notNull(),
    /**
     * In-stock bundles with no location (legacy stock taken on "where it is, place unknown") are
     * expected by this count: unseen ones become phantoms. Only a count over every active yard may
     * set it (on by default there): a bundle with no place that no yard holds is missing.
     */
    includeUnplaced: integer("include_unplaced", { mode: "boolean" }).notNull().default(false),
    note: text("note"),
    closedAt: integer("closed_at", { mode: "timestamp_ms" }),
    closedBy: text("closed_by").references(() => user.id, { onDelete: "set null" }),
    /** The close request's company sequence (resolutions after close compare against it). */
    closeSeq: integer("close_seq"),
    // Report totals, written by close in the same batch as the count_line rows.
    /** In stock at the counted locations at close, excluding bundles that changed during the count. */
    expectedCount: integer("expected_count"),
    /** Distinct scans recorded (bundles plus unknown codes). */
    seenCount: integer("seen_count"),
    phantomCount: integer("phantom_count"),
    phantomG: integer("phantom_g"),
    foundCount: integer("found_count"),
    movedCount: integer("moved_count"),
    /** In stock at the counted locations, changed after the count began and not scanned. */
    changedCount: integer("changed_count"),
    /**
     * In stock at the counted locations, unchanged and not scanned here, but scanned in ANOTHER
     * count after this one began (misplaced into another yard, not missing): never a phantom.
     */
    seenElsewhereCount: integer("seen_elsewhere_count"),
    cancelledAt: integer("cancelled_at", { mode: "timestamp_ms" }),
    cancelledBy: text("cancelled_by").references(() => user.id, { onDelete: "set null" }),
    cancelReason: text("cancel_reason"),
    /**
     * Replay key of the start request (RP18): a retry with the same key returns this count instead
     * of answering "already being counted" for the caller's own count.
     */
    clientRequestId: text("client_request_id"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(nowMs)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("count_session_company_number_unique").on(table.companyId, table.period, table.number),
    uniqueIndex("count_session_company_request_unique")
      .on(table.companyId, table.clientRequestId)
      .where(sql`${table.clientRequestId} is not null`),
    index("count_session_company_status_idx").on(table.companyId, table.status, table.createdAt),
    index("count_session_company_server_seq_idx").on(table.companyId, table.serverSeq),
  ],
);

/**
 * The locations a count covers (the per-location checkpoint: date, location). `status` mirrors
 * the session so the partial unique index can hold "one open count per location" at write time.
 */
export const countLocation = sqliteTable(
  "count_location",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    sessionId: text("session_id")
      .notNull()
      .references(() => countSession.id, { onDelete: "cascade" }),
    locationId: text("location_id")
      .notNull()
      .references(() => location.id, { onDelete: "restrict" }),
    status: text("status", { enum: countStatuses }).notNull().default("open"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(nowMs)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("count_location_session_location_unique").on(table.companyId, table.sessionId, table.locationId),
    // A location is in at most one open count; a second start fails the whole batch.
    uniqueIndex("count_location_company_open_unique")
      .on(table.companyId, table.locationId)
      .where(sql`${table.status} = 'open'`),
    index("count_location_company_location_idx").on(table.companyId, table.locationId, table.status),
    index("count_location_company_server_seq_idx").on(table.companyId, table.serverSeq),
  ],
);

/** What the resolver made of a scanned code at scan time. */
export const countSeenKinds = ["bundle", "not_found", "ambiguous"] as const;
export type CountSeenKind = (typeof countSeenKinds)[number];

/**
 * One scan in an open count: the code as resolved (plant number, old number, legacy cuid, QR
 * text), the bundle it resolved to (NULL when unknown or ambiguous) and the location it was seen
 * at. A repeat of the same code or the same bundle in a session is ignored (first scan wins).
 * Scans can be removed while the count is open (wrong location picked); never after close.
 */
export const countSeen = sqliteTable(
  "count_seen",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    /** The scan request's company sequence: ledger rows after it are newer than the scan. */
    serverSeq: integer("server_seq").notNull().default(0),
    sessionId: text("session_id")
      .notNull()
      .references(() => countSession.id, { onDelete: "cascade" }),
    locationId: text("location_id")
      .notNull()
      .references(() => location.id, { onDelete: "restrict" }),
    /** Normalised code (serial, cuid or the trimmed raw text when unrecognised). */
    code: text("code").notNull(),
    resolveKind: text("resolve_kind", { enum: countSeenKinds }).notNull(),
    bundleId: text("bundle_id").references(() => bundle.id, { onDelete: "set null" }),
    scannedAt: integer("scanned_at", { mode: "timestamp_ms" }).notNull(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (table) => [
    uniqueIndex("count_seen_session_code_unique").on(table.companyId, table.sessionId, table.code),
    uniqueIndex("count_seen_session_bundle_unique")
      .on(table.companyId, table.sessionId, table.bundleId)
      .where(sql`${table.bundleId} is not null`),
    index("count_seen_company_bundle_idx").on(table.companyId, table.bundleId),
    index("count_seen_company_server_seq_idx").on(table.companyId, table.serverSeq),
  ],
);

/**
 * Report line kinds, frozen at close:
 * - phantom: in stock at a counted location, not seen anywhere in the count.
 * - moved: seen at a counted location; the system had it at another counted location.
 * - found: seen, but the system does not have it there: unknown or ambiguous code, bundle not in
 *   stock (void / dispatched), or in stock at a location outside the count (or unknown).
 */
export const countLineKinds = ["phantom", "found", "moved"] as const;
export type CountLineKind = (typeof countLineKinds)[number];

/**
 * - open: nothing done yet.
 * - void_requested: in a pending phantom_void approval (`approval_id`).
 * - voided: the approval voided the bundle (reversal ledger rows, voucher = this line).
 * - moved: moved to where it was seen (`resolution_voucher_id` = the move voucher).
 * - cleared: the bundle changed after close (moved, dispatched, seen again), so it was not voided.
 */
export const countLineResolutions = ["open", "void_requested", "voided", "moved", "cleared"] as const;
export type CountLineResolution = (typeof countLineResolutions)[number];

export const countLine = sqliteTable(
  "count_line",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    sessionId: text("session_id")
      .notNull()
      .references(() => countSession.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: countLineKinds }).notNull(),
    /** NULL for a found code that resolved to no bundle. */
    bundleId: text("bundle_id").references(() => bundle.id, { onDelete: "set null" }),
    /** The scan behind a found / moved line (NULL for phantoms). */
    seenId: text("seen_id").references(() => countSeen.id, { onDelete: "set null" }),
    code: text("code"),
    /** Where the system had the bundle at close (NULL = unknown or no bundle). */
    systemLocationId: text("system_location_id").references(() => location.id, { onDelete: "restrict" }),
    /** Where it was seen (NULL for phantoms). */
    seenLocationId: text("seen_location_id").references(() => location.id, { onDelete: "restrict" }),
    /** Bundle status and weight at close, frozen for the report. */
    bundleStatus: text("bundle_status"),
    weightG: integer("weight_g"),
    resolution: text("resolution", { enum: countLineResolutions }).notNull().default("open"),
    /**
     * The phantom_void approval the line is (or was last) in. Not a foreign key: the request
     * stamps the lines and then inserts the approval guarded on them, in one batch.
     */
    approvalId: text("approval_id"),
    resolvedAt: integer("resolved_at", { mode: "timestamp_ms" }),
    resolvedBy: text("resolved_by").references(() => user.id, { onDelete: "set null" }),
    /** The move voucher that resolved a found / moved line. */
    resolutionVoucherId: text("resolution_voucher_id"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(nowMs)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    // A bundle is on at most one line per count: a double close cannot report it twice.
    uniqueIndex("count_line_session_bundle_unique")
      .on(table.companyId, table.sessionId, table.bundleId)
      .where(sql`${table.bundleId} is not null`),
    uniqueIndex("count_line_session_seen_unique")
      .on(table.companyId, table.sessionId, table.seenId)
      .where(sql`${table.seenId} is not null`),
    index("count_line_company_session_kind_idx").on(table.companyId, table.sessionId, table.kind),
    index("count_line_company_approval_idx").on(table.companyId, table.approvalId),
    index("count_line_company_bundle_idx").on(table.companyId, table.bundleId),
    index("count_line_company_server_seq_idx").on(table.companyId, table.serverSeq),
  ],
);

/**
 * Variance tally frozen at close: one row per (counted yard, section: `die_id`, the catalogue row) with what the count expected
 * there and what it counted there; variance = expected − counted (positive: short, negative:
 * extra). Expected = the summary's `expected` set (in stock at the yard, unscanned bundles that
 * changed during the count left out). Counted = this count's scans at the yard: a scan of an
 * expected bundle that the system moved after the scan counts where the system now has it; a
 * scan superseded by a move out of the count or a dispatch counts nowhere; unknown codes count
 * with no die and 0 kg. `location_id` NULL = bundles with no place (a count with
 * `include_unplaced`). Written once by the close batch; never updated.
 */
export const countTally = sqliteTable(
  "count_tally",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    serverSeq: integer("server_seq").notNull().default(0),
    sessionId: text("session_id")
      .notNull()
      .references(() => countSession.id, { onDelete: "cascade" }),
    locationId: text("location_id").references(() => location.id, { onDelete: "restrict" }),
    /** NULL for codes that resolved to no bundle. */
    dieId: text("die_id").references(() => die.id, { onDelete: "set null" }),
    expectedCount: integer("expected_count").notNull(),
    expectedG: integer("expected_g").notNull(),
    countedCount: integer("counted_count").notNull(),
    countedG: integer("counted_g").notNull(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (table) => [
    index("count_tally_company_session_idx").on(table.companyId, table.sessionId),
    // One row per (count, yard, section): a backstop for the close batch's `close_seq` guard. NULL
    // yard (unplaced) and NULL section (unknown codes) are keys too, hence the NULL → '' expressions
    // (written without commas: drizzle-kit splits an index expression on commas).
    uniqueIndex("count_tally_session_location_die_unique").on(
      table.companyId,
      table.sessionId,
      sql`(case when "location_id" is null then '' else "location_id" end)`,
      sql`(case when "die_id" is null then '' else "die_id" end)`,
    ),
    index("count_tally_company_server_seq_idx").on(table.companyId, table.serverSeq),
  ],
);

export type CountSessionRow = typeof countSession.$inferSelect;
export type CountLocationRow = typeof countLocation.$inferSelect;
export type CountSeenRow = typeof countSeen.$inferSelect;
export type CountLineRow = typeof countLine.$inferSelect;
export type CountTallyRow = typeof countTally.$inferSelect;
