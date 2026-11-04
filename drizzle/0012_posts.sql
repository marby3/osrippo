CREATE TABLE `posts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`bill_id` integer NOT NULL,
	`session_key` text NOT NULL,
	`kind` text NOT NULL,
	`parent_id` integer,
	`user_id` text NOT NULL,
	`role` text,
	`body` text NOT NULL,
	`status` text DEFAULT 'visible' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`bill_id`) REFERENCES `bills`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`parent_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "posts_kind" CHECK("posts"."kind" IN ('question', 'answer', 'supplement')),
	CONSTRAINT "posts_parent_kind" CHECK(("posts"."kind" = 'question') = ("posts"."parent_id" IS NULL)),
	CONSTRAINT "posts_role_kind" CHECK(("posts"."kind" = 'answer') = ("posts"."role" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX `posts_bill` ON `posts` (`bill_id`,`kind`,`id`);--> statement-breakpoint
CREATE INDEX `posts_parent` ON `posts` (`parent_id`);--> statement-breakpoint
CREATE INDEX `posts_user` ON `posts` (`user_id`);--> statement-breakpoint
CREATE TABLE `stance_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_key` text NOT NULL,
	`bill_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`stance` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`bill_id`) REFERENCES `bills`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `stance_log_bill` ON `stance_log` (`bill_id`,`session_key`);--> statement-breakpoint
CREATE TABLE `stances` (
	`session_key` text NOT NULL,
	`bill_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`stance` text NOT NULL,
	`changes` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`session_key`, `bill_id`, `user_id`),
	FOREIGN KEY (`bill_id`) REFERENCES `bills`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "stances_stance" CHECK("stances"."stance" IN ('for', 'against', 'undecided'))
);
--> statement-breakpoint
CREATE TRIGGER `stances_log_insert` AFTER INSERT ON `stances`
BEGIN
	INSERT INTO `stance_log` (`session_key`, `bill_id`, `user_id`, `stance`, `created_at`)
	VALUES (NEW.`session_key`, NEW.`bill_id`, NEW.`user_id`, NEW.`stance`, NEW.`updated_at`);
END;--> statement-breakpoint
CREATE TRIGGER `stances_log_update` AFTER UPDATE OF `stance` ON `stances`
WHEN NEW.`stance` <> OLD.`stance`
BEGIN
	INSERT INTO `stance_log` (`session_key`, `bill_id`, `user_id`, `stance`, `created_at`)
	VALUES (NEW.`session_key`, NEW.`bill_id`, NEW.`user_id`, NEW.`stance`, NEW.`updated_at`);
END;
