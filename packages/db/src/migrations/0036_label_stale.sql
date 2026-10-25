-- FINAL-EXPLORE round 1. Written as 0036; renumber at merge if another migration took it (D30).
-- I3: a printed sticker may carry an old party number after a move renumbers the bundle.
ALTER TABLE `bundle` ADD `sticker_stale` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- m5: no two live reasons of one kind with the same words. Any such pair already there keeps its first
-- (oldest) row live and retires the later ones, so the index can be built. A retired reason keeps its history.
UPDATE `reason_code` SET `active` = 0 WHERE `active` = 1 AND `code` <> 'other' AND EXISTS (SELECT 1 FROM `reason_code` r2 WHERE r2.`company_id` = `reason_code`.`company_id` AND r2.`kind` = `reason_code`.`kind` AND r2.`active` = 1 AND lower(trim(r2.`label`)) = lower(trim(`reason_code`.`label`)) AND (r2.`created_at` < `reason_code`.`created_at` OR (r2.`created_at` = `reason_code`.`created_at` AND r2.`id` < `reason_code`.`id`)));--> statement-breakpoint
CREATE UNIQUE INDEX `reason_code_live_label_unique` ON `reason_code` (`company_id`,`kind`,lower(trim("label"))) WHERE "reason_code"."active" = 1;
