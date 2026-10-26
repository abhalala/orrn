ALTER TABLE `cast` ADD `legacy_code` text;--> statement-breakpoint
CREATE UNIQUE INDEX `cast_company_legacy_unique` ON `cast` (`company_id`,`legacy_code`) WHERE "cast"."legacy_code" is not null;