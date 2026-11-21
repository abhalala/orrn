-- Who set the vision tick of a model-read table and when (import portal release 2 fix round, security L2,
-- lead decision 5). Additive: two nullable columns, no default, no foreign key. Existing ticks read as null
-- (no one recorded); every write that clears the tick clears both.

ALTER TABLE `ingest_block` ADD `model_checked_by` text;--> statement-breakpoint
ALTER TABLE `ingest_block` ADD `model_checked_at` integer;