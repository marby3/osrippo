CREATE TABLE `commentary_reports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`commentary_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`reason` text NOT NULL,
	`note` text,
	`counted` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`commentary_id`) REFERENCES `expert_commentaries`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "commentary_reports_reason" CHECK("commentary_reports"."reason" IN ('attack', 'spam', 'other', 'none'))
);
--> statement-breakpoint
CREATE INDEX `commentary_reports_user` ON `commentary_reports` (`user_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `commentary_reports_once` ON `commentary_reports` (`commentary_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `expert_commentaries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`bill_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer NOT NULL,
	`edited_at` integer,
	`moderation_status` text DEFAULT 'visible' NOT NULL,
	`moderation_changed_at` integer,
	FOREIGN KEY (`bill_id`) REFERENCES `bills`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "expert_commentaries_status" CHECK("expert_commentaries"."moderation_status" IN ('visible', 'auto_hidden', 'hidden', 'restored'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `expert_commentaries_once` ON `expert_commentaries` (`bill_id`,`user_id`);--> statement-breakpoint
ALTER TABLE `bill_moderation_logs` ADD `commentary_id` integer;