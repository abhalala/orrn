import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { user } from "./auth";
import { company } from "./tenant";

const nowMs = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

/**
 * orrn buddy (design 2026-11-18, §4 and §13). Hermes reaches orrn through `/mcp` with a grant token; the
 * browser chats through `/buddy/chat`. None of these tables holds chat text or a raw token.
 *
 * - `buddy_link`: which Hermes profile serves this person in this plant (null = the default profile).
 * - `buddy_grant`: the MCP bearer token, stored as its SHA-256 only, and how the minting session signed in.
 * - `buddy_call`: one row per MCP tool call and per chat turn (append-only, no bodies).
 * - `buddy_draft`: a change the buddy proposed; it runs only when the person confirms it in the browser.
 */

export const BUDDY_LINK_STATUSES = ["active", "revoked"] as const;
export type BuddyLinkStatus = (typeof BUDDY_LINK_STATUSES)[number];

export const buddyLink = sqliteTable(
  "buddy_link",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Null = Hermes's default profile (no `/p/<profile>` prefix). Never taken from the browser. */
    hermesProfile: text("hermes_profile"),
    status: text("status", { enum: BUDDY_LINK_STATUSES }).notNull().default("active"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    index("buddy_link_company_user_idx").on(table.companyId, table.userId, table.status),
  ],
);

export const buddyGrant = sqliteTable(
  "buddy_grant",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** SHA-256 (hex) of the token. The token itself is shown once and never stored. */
    tokenHash: text("token_hash").notNull(),
    scopes: text("scopes", { mode: "json" }).$type<string[]>().notNull().default([]),
    /**
     * How the browser session that made the grant signed in (`session.sign_in_method`). The MCP context
     * carries it, so a plant that requires secure sign-in judges the grant like the session that made it.
     */
    signInMethod: text("sign_in_method"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
    revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
    lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    uniqueIndex("buddy_grant_token_hash_unique").on(table.tokenHash),
    index("buddy_grant_company_user_idx").on(table.companyId, table.userId),
  ],
);

export const BUDDY_CALL_OUTCOMES = [
  "ok",
  "needs_confirm",
  "forbidden",
  "not_found",
  "invalid",
  "rate_limited",
  "error",
  "truncated",
] as const;
export type BuddyCallOutcome = (typeof BUDDY_CALL_OUTCOMES)[number];

export const buddyCall = sqliteTable(
  "buddy_call",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Null for a chat turn made before the person connected Hermes. */
    grantId: text("grant_id").references(() => buddyGrant.id, { onDelete: "set null" }),
    /** `orrn_search`, `orrn_describe`, `orrn_call`, `orrn_review_link`, or `chat` for a chat turn. */
    tool: text("tool").notNull(),
    path: text("path"),
    outcome: text("outcome", { enum: BUDDY_CALL_OUTCOMES }).notNull(),
    ms: integer("ms").notNull().default(0),
    resultBytes: integer("result_bytes").notNull().default(0),
    /** The Hermes platform that asked (api_server, telegram), when Hermes passes it. */
    platform: text("platform"),
    at: integer("at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
  },
  (table) => [
    index("buddy_call_company_at_idx").on(table.companyId, table.at),
    index("buddy_call_grant_at_idx").on(table.grantId, table.at),
    index("buddy_call_company_user_tool_at_idx").on(table.companyId, table.userId, table.tool, table.at),
  ],
);

export const BUDDY_DRAFT_STATUSES = ["pending", "confirmed", "rejected", "expired", "failed"] as const;
export type BuddyDraftStatus = (typeof BUDDY_DRAFT_STATUSES)[number];

export const buddyDraft = sqliteTable(
  "buddy_draft",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => company.id, { onDelete: "cascade" }),
    requestedByUserId: text("requested_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    grantId: text("grant_id").references(() => buddyGrant.id, { onDelete: "set null" }),
    path: text("path").notNull(),
    /** The input exactly as the model sent it (validated, not transformed), so confirm parses it again. */
    inputJson: text("input_json", { mode: "json" }).$type<unknown>(),
    summary: text("summary").notNull().default(""),
    status: text("status", { enum: BUDDY_DRAFT_STATUSES }).notNull().default("pending"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(nowMs).notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    /** Set by the confirm that runs the draft (a conditional UPDATE), so two confirms never both run it. */
    claimedAt: integer("claimed_at", { mode: "timestamp_ms" }),
    decidedBy: text("decided_by").references(() => user.id, { onDelete: "set null" }),
    decidedAt: integer("decided_at", { mode: "timestamp_ms" }),
    resultJson: text("result_json", { mode: "json" }).$type<unknown>(),
    failure: text("failure"),
  },
  (table) => [
    index("buddy_draft_company_user_status_idx").on(table.companyId, table.requestedByUserId, table.status),
    index("buddy_draft_grant_created_idx").on(table.grantId, table.createdAt),
  ],
);
