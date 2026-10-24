ALTER TABLE `bundle` ADD `held_for_line_id` text;--> statement-breakpoint
ALTER TABLE `bundle` ADD `held_at` integer;--> statement-breakpoint
CREATE INDEX `bundle_company_held_line_idx` ON `bundle` (`company_id`,`held_for_line_id`);