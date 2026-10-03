ALTER TABLE `legacy_bundle_map` ADD `server_seq` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `legacy_bundle_map` ADD `created_by` text REFERENCES user(id) ON UPDATE no action ON DELETE set null;--> statement-breakpoint
ALTER TABLE `doc_series` ADD `created_by` text REFERENCES user(id) ON UPDATE no action ON DELETE set null;