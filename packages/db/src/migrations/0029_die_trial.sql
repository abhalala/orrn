ALTER TABLE `die_maker_job` ADD `from_status` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `die_issue` ADD `trial` integer DEFAULT 0 NOT NULL;