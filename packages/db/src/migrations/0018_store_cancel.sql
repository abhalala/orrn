DROP INDEX `store_item_company_name_key_unique`;--> statement-breakpoint
ALTER TABLE `store_item` ADD `retired_at` integer;--> statement-breakpoint
UPDATE `store_item` SET `retired_at` = `updated_at` WHERE `active` = 0;--> statement-breakpoint
CREATE UNIQUE INDEX `store_item_company_name_key_unique` ON `store_item` (`company_id`,`name_key`) WHERE "store_item"."retired_at" is null;--> statement-breakpoint
ALTER TABLE `store_txn` ADD `client_request_id` text;--> statement-breakpoint
ALTER TABLE `store_txn` ADD `cancelled_at` integer;--> statement-breakpoint
ALTER TABLE `store_txn` ADD `cancelled_by` text REFERENCES user(id) ON UPDATE no action ON DELETE set null;--> statement-breakpoint
ALTER TABLE `store_txn` ADD `cancel_reason` text;--> statement-breakpoint
ALTER TABLE `store_txn` ADD `updated_at` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `store_txn_company_request_unique` ON `store_txn` (`company_id`,`client_request_id`) WHERE "store_txn"."client_request_id" is not null;