ALTER TABLE `printer_profile` ADD `media_type` text;--> statement-breakpoint
ALTER TABLE `printer_profile` ADD `media_width_mm` real;--> statement-breakpoint
ALTER TABLE `printer_profile` ADD `media_height_mm` real;--> statement-breakpoint
ALTER TABLE `printer_profile` ADD `gap_mm` real;--> statement-breakpoint
ALTER TABLE `printer_profile` ADD `dpi` integer;--> statement-breakpoint
ALTER TABLE `printer_profile` ADD `speed_in_sec` integer;--> statement-breakpoint
ALTER TABLE `printer_profile` ADD `density` integer;--> statement-breakpoint
ALTER TABLE `printer_profile` ADD `cutter_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `printer_profile` ADD `mac_address` text;--> statement-breakpoint
ALTER TABLE `printer_profile` ADD `verified_host` text;--> statement-breakpoint
ALTER TABLE `printer_profile` ADD `verified_port` integer;--> statement-breakpoint
ALTER TABLE `printer_profile` ADD `discovered_features` text;--> statement-breakpoint
ALTER TABLE `printer_profile` ADD `capabilities_verified_at` integer;