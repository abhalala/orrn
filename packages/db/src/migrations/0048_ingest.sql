-- Infinity Portal (plan 2026-11-10, B1). Additive: the ingest tables and customer_alias. Raw file bytes
-- live in R2, never here. ingest_staged_row and ingest_merge_chunk are left out of backups.

CREATE TABLE `customer_alias` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`alias` text NOT NULL,
	`alias_key` text NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`customer_id`) REFERENCES `customer`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `customer_alias_company_key_unique` ON `customer_alias` (`company_id`,`alias_key`);--> statement-breakpoint
CREATE INDEX `customer_alias_customer_idx` ON `customer_alias` (`customer_id`);--> statement-breakpoint
CREATE TABLE `ingest_answer` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`candidate_id` text NOT NULL,
	`question_code` text NOT NULL,
	`subject` text NOT NULL,
	`answer` text NOT NULL,
	`answered_by` text,
	`answered_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`candidate_id`) REFERENCES `ingest_candidate`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`answered_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ingest_answer_unique` ON `ingest_answer` (`candidate_id`,`question_code`,`subject`);--> statement-breakpoint
CREATE TABLE `ingest_artifact` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`sha256` text NOT NULL,
	`file_name` text NOT NULL,
	`content_type` text,
	`kind` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`vault_state` text NOT NULL,
	`read_state` text NOT NULL,
	`read_error` text,
	`block_count` integer DEFAULT 0 NOT NULL,
	`row_count` integer DEFAULT 0 NOT NULL,
	`period` text,
	`period_confirmed` text,
	`note` text,
	`uploaded_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`uploaded_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ingest_artifact_company_sha_unique` ON `ingest_artifact` (`company_id`,`sha256`);--> statement-breakpoint
CREATE INDEX `ingest_artifact_company_created_idx` ON `ingest_artifact` (`company_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `ingest_block` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`artifact_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`sheet_name` text,
	`title` text,
	`header_row` integer NOT NULL,
	`header_rows` integer DEFAULT 1 NOT NULL,
	`headers` text NOT NULL,
	`kinds` text NOT NULL,
	`header_key` text NOT NULL,
	`column_count` integer NOT NULL,
	`row_count` integer DEFAULT 0 NOT NULL,
	`rows_put` integer DEFAULT 0 NOT NULL,
	`sample` text NOT NULL,
	`read_by` text DEFAULT 'parser' NOT NULL,
	`model_checked` integer DEFAULT false NOT NULL,
	`canonical_stored` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`artifact_id`) REFERENCES `ingest_artifact`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ingest_block_artifact_ordinal_unique` ON `ingest_block` (`artifact_id`,`ordinal`);--> statement-breakpoint
CREATE INDEX `ingest_block_company_header_key_idx` ON `ingest_block` (`company_id`,`header_key`);--> statement-breakpoint
CREATE TABLE `ingest_bot_run` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`block_id` text NOT NULL,
	`candidate_id` text,
	`purpose` text NOT NULL,
	`model` text NOT NULL,
	`attempt` integer NOT NULL,
	`outcome` text NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`cache_read_tokens` integer DEFAULT 0 NOT NULL,
	`cache_write_tokens` integer DEFAULT 0 NOT NULL,
	`cost_micro_usd` integer DEFAULT 0 NOT NULL,
	`duration_ms` integer DEFAULT 0 NOT NULL,
	`error_codes` text,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `ingest_bot_run_company_created_idx` ON `ingest_bot_run` (`company_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ingest_bot_run_block_idx` ON `ingest_bot_run` (`block_id`);--> statement-breakpoint
CREATE TABLE `ingest_candidate` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`artifact_id` text NOT NULL,
	`block_id` text NOT NULL,
	`parent_id` text,
	`target` text,
	`hole_ref` text,
	`recipe` text,
	`fit` text NOT NULL,
	`fit_score` integer,
	`fit_diff` text,
	`state` text NOT NULL,
	`reason_code` text,
	`reason_detail` text,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`dry_cursor` integer DEFAULT 0 NOT NULL,
	`rows_total` integer DEFAULT 0 NOT NULL,
	`rows_create` integer DEFAULT 0 NOT NULL,
	`rows_update` integer DEFAULT 0 NOT NULL,
	`rows_unchanged` integer DEFAULT 0 NOT NULL,
	`rows_ambiguous` integer DEFAULT 0 NOT NULL,
	`rows_conflict` integer DEFAULT 0 NOT NULL,
	`rows_refused` integer DEFAULT 0 NOT NULL,
	`rows_skipped` integer DEFAULT 0 NOT NULL,
	`rows_written` integer DEFAULT 0 NOT NULL,
	`open_questions` integer DEFAULT 0 NOT NULL,
	`bot_attempts` integer DEFAULT 0 NOT NULL,
	`recipe_locked` integer DEFAULT false NOT NULL,
	`approved_by` text,
	`approved_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`artifact_id`) REFERENCES `ingest_artifact`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`block_id`) REFERENCES `ingest_block`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`approved_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ingest_candidate_block_target_unique` ON `ingest_candidate` (`block_id`,`target`);--> statement-breakpoint
CREATE INDEX `ingest_candidate_company_state_idx` ON `ingest_candidate` (`company_id`,`state`);--> statement-breakpoint
CREATE INDEX `ingest_candidate_artifact_idx` ON `ingest_candidate` (`artifact_id`);--> statement-breakpoint
CREATE TABLE `ingest_hole` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`target` text NOT NULL,
	`name` text NOT NULL,
	`current_version` integer NOT NULL,
	`state` text DEFAULT 'active' NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `ingest_hole_company_target_idx` ON `ingest_hole` (`company_id`,`target`);--> statement-breakpoint
CREATE TABLE `ingest_hole_version` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`hole_id` text NOT NULL,
	`version` integer NOT NULL,
	`header_key` text NOT NULL,
	`recipe` text NOT NULL,
	`made_by` text NOT NULL,
	`bot_run_id` text,
	`state` text NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`hole_id`) REFERENCES `ingest_hole`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ingest_hole_version_unique` ON `ingest_hole_version` (`hole_id`,`version`);--> statement-breakpoint
CREATE INDEX `ingest_hole_version_company_key_idx` ON `ingest_hole_version` (`company_id`,`header_key`,`state`);--> statement-breakpoint
CREATE TABLE `ingest_merge_chunk` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`run_id` text NOT NULL,
	`candidate_id` text NOT NULL,
	`target` text NOT NULL,
	`seq` integer NOT NULL,
	`row_from` integer NOT NULL,
	`row_to` integer NOT NULL,
	`row_count` integer NOT NULL,
	`state` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`error_code` text,
	`error_message` text,
	`sent_at` integer,
	`written_at` integer,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`run_id`) REFERENCES `ingest_merge_run`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`candidate_id`) REFERENCES `ingest_candidate`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ingest_merge_chunk_run_seq_unique` ON `ingest_merge_chunk` (`run_id`,`seq`);--> statement-breakpoint
CREATE INDEX `ingest_merge_chunk_candidate_idx` ON `ingest_merge_chunk` (`candidate_id`);--> statement-breakpoint
CREATE TABLE `ingest_merge_run` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`state` text NOT NULL,
	`cursor` integer DEFAULT 0 NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`chunks_total` integer DEFAULT 0 NOT NULL,
	`chunks_written` integer DEFAULT 0 NOT NULL,
	`chunks_failed` integer DEFAULT 0 NOT NULL,
	`started_by` text,
	`started_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`started_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ingest_merge_run_one_active` ON `ingest_merge_run` (`company_id`) WHERE "ingest_merge_run"."state" in ('planning','running');--> statement-breakpoint
CREATE INDEX `ingest_merge_run_company_started_idx` ON `ingest_merge_run` (`company_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `ingest_staged_row` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`row_key` text NOT NULL,
	`candidate_id` text NOT NULL,
	`row_index` integer NOT NULL,
	`raw` text NOT NULL,
	`values` text,
	`entered` text,
	`state` text DEFAULT 'pending' NOT NULL,
	`reasons` text,
	`match_id` text,
	`diff` text,
	`decision` text,
	`merge_state` text DEFAULT 'open' NOT NULL,
	`committed_type` text,
	`committed_id` text,
	`order_key` text,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`candidate_id`) REFERENCES `ingest_candidate`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ingest_staged_row_candidate_index_unique` ON `ingest_staged_row` (`candidate_id`,`row_index`);--> statement-breakpoint
CREATE INDEX `ingest_staged_row_candidate_state_idx` ON `ingest_staged_row` (`candidate_id`,`state`);--> statement-breakpoint
CREATE INDEX `ingest_staged_row_committed_idx` ON `ingest_staged_row` (`company_id`,`committed_type`,`committed_id`);--> statement-breakpoint
CREATE INDEX `ingest_staged_row_company_key_idx` ON `ingest_staged_row` (`company_id`,`row_key`);--> statement-breakpoint
CREATE INDEX `ingest_staged_row_company_order_key_idx` ON `ingest_staged_row` (`company_id`,`order_key`);--> statement-breakpoint
ALTER TABLE `customer` ADD `name_key` text;--> statement-breakpoint
CREATE INDEX `customer_company_name_key_idx` ON `customer` (`company_id`,`name_key`);
--> statement-breakpoint
ALTER TABLE `ingest_staged_row` ADD `name_key` text;--> statement-breakpoint
CREATE INDEX `ingest_staged_row_company_name_key_idx` ON `ingest_staged_row` (`company_id`,`name_key`);--> statement-breakpoint
CREATE TABLE `ingest_order_key` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`key` text NOT NULL,
	`sales_order_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sales_order_id`) REFERENCES `sales_order`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ingest_order_key_company_key_idx` ON `ingest_order_key` (`company_id`,`key`);--> statement-breakpoint
CREATE INDEX `sales_order_company_customer_po_lower_idx` ON `sales_order` (`company_id`,`customer_id`,lower("po_number"));--> statement-breakpoint
ALTER TABLE `ingest_staged_row` ADD `po_key` text;--> statement-breakpoint
CREATE INDEX `ingest_staged_row_company_po_key_idx` ON `ingest_staged_row` (`company_id`,`po_key`);--> statement-breakpoint
ALTER TABLE `ingest_staged_row` ADD `dup_key` text;--> statement-breakpoint
CREATE INDEX `ingest_staged_row_candidate_dup_key_idx` ON `ingest_staged_row` (`candidate_id`,`dup_key`);--> statement-breakpoint
CREATE INDEX `die_company_section_norm_idx` ON `die` (`company_id`,upper(trim("section_code")));
