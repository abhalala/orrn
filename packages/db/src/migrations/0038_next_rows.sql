-- W4-NEXTROWS (FP-DR-18): die work log. Additive only. Numbered 0038 (0033-0037 reserved for other W4 lanes); journal idx to be renumbered at merge.
CREATE TABLE `die_work` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`die_instance_id` text NOT NULL,
	`reason_code_id` text NOT NULL,
	`kind_code` text NOT NULL,
	`worked_at` integer NOT NULL,
	`note` text,
	`hardness` integer,
	`set_on_trial` integer DEFAULT 0 NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`die_instance_id`) REFERENCES `die_instance`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `die_work_instance_idx` ON `die_work` (`company_id`,`die_instance_id`,`worked_at`);--> statement-breakpoint
CREATE INDEX `die_work_company_server_seq_idx` ON `die_work` (`company_id`,`server_seq`);