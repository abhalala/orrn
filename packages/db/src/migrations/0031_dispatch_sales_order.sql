ALTER TABLE `dispatch` ADD `sales_order_id` text;--> statement-breakpoint
ALTER TABLE `dispatch` ADD `truck_id` text;--> statement-breakpoint
CREATE INDEX `dispatch_company_sales_order_idx` ON `dispatch` (`company_id`,`sales_order_id`);--> statement-breakpoint
CREATE INDEX `dispatch_company_truck_idx` ON `dispatch` (`company_id`,`truck_id`);