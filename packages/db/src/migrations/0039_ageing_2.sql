DROP INDEX `ageing_temp_log_feed_unique`;--> statement-breakpoint
ALTER TABLE `ageing_temp_log` ADD `device_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `ageing_temp_log_feed_device_unique` ON `ageing_temp_log` (`batch_id`,`source`,`device_id`,`at`) WHERE "ageing_temp_log"."source" <> 'typed';--> statement-breakpoint
CREATE INDEX `ageing_batch_company_oven_in_idx` ON `ageing_batch` (`company_id`,`oven_id`,`in_at`);--> statement-breakpoint
CREATE INDEX `ageing_batch_company_trolley_idx` ON `ageing_batch` (`company_id`,`trolley_id`);--> statement-breakpoint
CREATE INDEX `ageing_batch_company_rework_of_idx` ON `ageing_batch` (`company_id`,`rework_of_batch_id`);--> statement-breakpoint
CREATE INDEX `ageing_row_company_rework_row_idx` ON `ageing_row` (`company_id`,`rework_row_id`);