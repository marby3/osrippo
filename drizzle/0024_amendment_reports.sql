CREATE TABLE `amendment_reports` (
	`id` integer PRIMARY KEY NOT NULL,
	`amendment_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`reason` text NOT NULL,
	`note` text,
	`counted` integer NOT NULL,
	`revision` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`amendment_id`) REFERENCES `amendments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "amendment_reports_reason" CHECK("amendment_reports"."reason" IN ('attack', 'spam', 'other', 'none'))
);
--> statement-breakpoint
CREATE INDEX `amendment_reports_user` ON `amendment_reports` (`user_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `amendment_reports_amendment_id_user_id_unique` ON `amendment_reports` (`amendment_id`,`user_id`);--> statement-breakpoint
ALTER TABLE `amendments` ADD `moderation_status` text DEFAULT 'visible' NOT NULL;--> statement-breakpoint
ALTER TABLE `amendments` ADD `moderation_actor` text;--> statement-breakpoint
ALTER TABLE `amendments` ADD `moderation_actor_user_id` text;--> statement-breakpoint
ALTER TABLE `amendments` ADD `moderation_reason` text;--> statement-breakpoint
ALTER TABLE `amendments` ADD `moderation_note` text;--> statement-breakpoint
ALTER TABLE `amendments` ADD `moderation_changed_at` integer;--> statement-breakpoint
ALTER TABLE `bill_moderation_logs` ADD `amendment_id` integer;--> statement-breakpoint
CREATE INDEX `amendment_votes_amendment_user` ON `amendment_votes` (`amendment_id`,`user_id`);--> statement-breakpoint
CREATE TRIGGER `amendments_moderation_log` AFTER UPDATE OF `moderation_status` ON `amendments`
WHEN NEW.`moderation_status` <> OLD.`moderation_status`
BEGIN
	INSERT INTO `bill_moderation_logs` (`bill_id`, `amendment_id`, `action`, `actor`, `actor_user_id`, `reason`, `note`, `created_at`)
	VALUES (
		NEW.`bill_id`,
		NEW.`id`,
		CASE NEW.`moderation_status` WHEN 'auto_hidden' THEN 'auto_hide' WHEN 'hidden' THEN 'hide' WHEN 'restored' THEN 'restore' END,
		NEW.`moderation_actor`,
		NEW.`moderation_actor_user_id`,
		NEW.`moderation_reason`,
		NEW.`moderation_note`,
		NEW.`moderation_changed_at`
	);
END;
