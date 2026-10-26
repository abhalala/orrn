PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_ageing_hardness` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`server_seq` integer DEFAULT 0 NOT NULL,
	`batch_id` text NOT NULL,
	`row_id` text NOT NULL,
	`method` text NOT NULL,
	`reading_x10` integer NOT NULL,
	`pass` integer,
	`tested_by` text,
	`tested_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`batch_id`) REFERENCES `ageing_batch`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`row_id`) REFERENCES `ageing_row`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tested_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_ageing_hardness`("id", "company_id", "server_seq", "batch_id", "row_id", "method", "reading_x10", "pass", "tested_by", "tested_at") SELECT "id", "company_id", "server_seq", "batch_id", "row_id", "method", "reading_x10", "pass", "tested_by", "tested_at" FROM `ageing_hardness`;--> statement-breakpoint
DROP TABLE `ageing_hardness`;--> statement-breakpoint
ALTER TABLE `__new_ageing_hardness` RENAME TO `ageing_hardness`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `ageing_hardness_company_row_idx` ON `ageing_hardness` (`company_id`,`row_id`);--> statement-breakpoint
CREATE INDEX `ageing_hardness_company_batch_idx` ON `ageing_hardness` (`company_id`,`batch_id`);--> statement-breakpoint
CREATE INDEX `ageing_hardness_company_server_seq_idx` ON `ageing_hardness` (`company_id`,`server_seq`);