CREATE INDEX `dispatch_company_completed_idx` ON `dispatch` (`company_id`,`completed_at`);--> statement-breakpoint
CREATE INDEX `bundle_company_created_idx` ON `bundle` (`company_id`,`created_at`);