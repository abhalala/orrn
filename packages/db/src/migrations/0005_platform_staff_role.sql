ALTER TABLE `platform_admin` ADD COLUMN `role` text DEFAULT 'support' NOT NULL;
--> statement-breakpoint
ALTER TABLE `platform_admin` ADD COLUMN `created_by` text REFERENCES `user`(`id`) ON DELETE set null;
--> statement-breakpoint
UPDATE `platform_admin` SET `role` = 'super_admin' WHERE `role` = 'support';
