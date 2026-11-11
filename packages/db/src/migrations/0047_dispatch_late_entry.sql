-- Late packing-list entry for line-down hours (arch 52). Additive: a dispatch completed afterwards at
-- the time the truck left carries the flag, the reason and the approval that allowed it.
ALTER TABLE `dispatch` ADD `late_entry` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `dispatch` ADD `late_entry_reason` text;--> statement-breakpoint
ALTER TABLE `dispatch` ADD `late_entry_approval_id` text;
