CREATE TABLE `auth_throttle` (
	`key` text PRIMARY KEY NOT NULL,
	`window_start` integer NOT NULL,
	`hits` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `auth_throttle_window_idx` ON `auth_throttle` (`window_start`);--> statement-breakpoint
ALTER TABLE `print_log` ADD `label_version` integer;--> statement-breakpoint
ALTER TABLE `print_log` ADD `job_key` text;--> statement-breakpoint
ALTER TABLE `reason_code` ADD `label_hi` text;--> statement-breakpoint
ALTER TABLE `reason_code` ADD `label_gu` text;