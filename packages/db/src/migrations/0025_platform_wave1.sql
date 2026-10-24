ALTER TABLE `app_release` ADD `build_number` integer;--> statement-breakpoint
ALTER TABLE `app_release` ADD `min_build` integer;--> statement-breakpoint
ALTER TABLE `app_release` ADD `mandatory` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `backup_run` ADD `purpose` text DEFAULT 'export' NOT NULL;--> statement-breakpoint
ALTER TABLE `backup_run` ADD `source_run_id` text;--> statement-breakpoint
ALTER TABLE `backup_run` ADD `scratch_company_id` text;--> statement-breakpoint
ALTER TABLE `backup_run` ADD `detail` text;