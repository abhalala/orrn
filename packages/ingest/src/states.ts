/** Enums shared with the schema, the server and the web (plan B1, B5, B7). No imports, so every module may use them. */

export const INGEST_TARGETS = [
  "customers",
  "customer_aliases",
  "vendors",
  "vendor_aliases",
  "dies",
  "die_copies",
  "bundles",
  "orders",
] as const;
export type IngestTarget = (typeof INGEST_TARGETS)[number];

export const CANDIDATE_STATES = [
  "processing",
  "needs_shape",
  "needs_confirm",
  "ready",
  "held",
  "approved",
  "merging",
  "merged",
  "failed",
  "discarded",
] as const;
export type CandidateState = (typeof CANDIDATE_STATES)[number];

export const ROW_STATES = [
  "pending",
  "ready_create",
  "ready_update",
  "unchanged",
  "ambiguous",
  "conflict",
  "refused",
  "skipped",
] as const;
export type RowState = (typeof ROW_STATES)[number];

export const ROW_DECISIONS = ["skip", "keep_file", "keep_live", "create_new", "use_match"] as const;
export type RowDecision = (typeof ROW_DECISIONS)[number];

export const ROW_MERGE_STATES = ["open", "queued", "written"] as const;
export type RowMergeState = (typeof ROW_MERGE_STATES)[number];

export const QUESTION_CODES = [
  "unit_unknown",
  "date_format_ambiguous",
  "period_needed",
  "rates_hidden",
  "column_meaning_unclear",
  "create_legacy_die",
  "new_customers",
] as const;
export type QuestionCode = (typeof QUESTION_CODES)[number];

export const FIT_KINDS = ["exact", "near", "none", "manual", "bot"] as const;
export type FitKind = (typeof FIT_KINDS)[number];

export const ARTIFACT_KINDS = ["sheet", "csv", "sql", "pdf_text", "pdf_scan", "image"] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

export const VAULT_STATES = ["pending", "stored", "not_stored"] as const;
export type VaultState = (typeof VAULT_STATES)[number];

export const READ_STATES = ["reading", "read", "failed"] as const;
export type ReadState = (typeof READ_STATES)[number];

export const MERGE_RUN_STATES = ["planning", "running", "done", "done_with_holds", "stopped"] as const;
export type MergeRunState = (typeof MERGE_RUN_STATES)[number];

export const MERGE_CHUNK_STATES = ["planned", "sent", "written", "failed"] as const;
export type MergeChunkState = (typeof MERGE_CHUNK_STATES)[number];

export const BOT_OUTCOMES = ["recipe", "no_target", "invalid", "refused", "error", "capped", "sample_failed"] as const;
export type BotOutcome = (typeof BOT_OUTCOMES)[number];

export const HOLE_MADE_BY = ["person", "bot", "bot_edited"] as const;
export type HoleMadeBy = (typeof HOLE_MADE_BY)[number];

/** Reasons a candidate is held or failed (`reason_code`). */
export const CANDIDATE_REASON_CODES = [
  "merge_failed",
  "dependency_held",
  "module_off",
  "confirm_blocked",
  "read_failed",
  "limit_hit",
] as const;
export type CandidateReasonCode = (typeof CANDIDATE_REASON_CODES)[number];

/**
 * Why `applyRecipe` refuses a row, and why the dry run may refuse one later. A refusal names the field and one of
 * these codes; the screen renders the words from i18n.
 */
export const REFUSAL_CODES = [
  "total_row",
  "blank_required",
  "bad_number",
  "unit_mismatch",
  "out_of_range",
  "unit_unknown",
  "bad_date",
  "pick_refused",
  "not_in_enum",
  "too_long",
  "bad_email",
  "bad_gstin",
  "not_whole",
  "not_positive",
  "range_order",
  "length_range",
  "weight_range",
  "too_many_aliases",
  "module_off",
  "baki_mismatch",
  "in_file_duplicate",
  "over_dispatched",
  "no_quantity",
] as const;
export type RefusalCode = (typeof REFUSAL_CODES)[number];
