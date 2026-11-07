CREATE TABLE `bill_moderation_logs` (
	`id` integer PRIMARY KEY NOT NULL,
	`bill_id` integer NOT NULL,
	`post_id` integer,
	`action` text NOT NULL,
	`actor` text NOT NULL,
	`actor_user_id` text,
	`reason` text,
	`note` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`bill_id`) REFERENCES `bills`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `bill_moderation_logs_actor_user` ON `bill_moderation_logs` (`actor_user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `post_reports` (
	`id` integer PRIMARY KEY NOT NULL,
	`post_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`reason` text NOT NULL,
	`note` text,
	`counted` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "post_reports_reason" CHECK("post_reports"."reason" IN ('attack', 'spam', 'other', 'none'))
);
--> statement-breakpoint
CREATE INDEX `post_reports_user` ON `post_reports` (`user_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `post_reports_post_id_user_id_unique` ON `post_reports` (`post_id`,`user_id`);--> statement-breakpoint
ALTER TABLE `posts` ADD `status_actor` text;--> statement-breakpoint
ALTER TABLE `posts` ADD `status_actor_user_id` text;--> statement-breakpoint
ALTER TABLE `posts` ADD `status_reason` text;--> statement-breakpoint
ALTER TABLE `posts` ADD `status_note` text;--> statement-breakpoint
ALTER TABLE `posts` ADD `status_changed_at` integer;--> statement-breakpoint
CREATE TRIGGER `posts_status_log` AFTER UPDATE OF `status` ON `posts`
WHEN NEW.`status` <> OLD.`status`
BEGIN
	INSERT INTO `bill_moderation_logs` (`bill_id`, `post_id`, `action`, `actor`, `actor_user_id`, `reason`, `note`, `created_at`)
	VALUES (
		NEW.`bill_id`,
		NEW.`id`,
		CASE NEW.`status` WHEN 'auto_hidden' THEN 'auto_hide' WHEN 'hidden' THEN 'hide' WHEN 'restored' THEN 'restore' END,
		NEW.`status_actor`,
		NEW.`status_actor_user_id`,
		NEW.`status_reason`,
		NEW.`status_note`,
		NEW.`status_changed_at`
	);
END;
