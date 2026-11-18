-- Onboarding per plant (plan 2026-11-18, Task 9; spec Amendment item 5). Additive: one nullable column.
-- Null means that plant's welcome steps are still open for the person. Members who already finished
-- onboarding (the old user-level flag) are marked as onboarded in every plant they belong to today, at
-- the time they joined, so nobody who is set up is sent back through setup.

ALTER TABLE `membership` ADD `onboarded_at` integer;--> statement-breakpoint
UPDATE `membership` SET `onboarded_at` = `created_at` WHERE `onboarded_at` IS NULL AND `user_id` IN (SELECT `id` FROM `user` WHERE `onboarding_completed` = 1);
