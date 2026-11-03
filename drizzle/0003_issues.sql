CREATE TABLE `actions` (
	`id` integer PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`user_id` text NOT NULL,
	`ip_hash` text NOT NULL,
	`target_id` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "actions_kind" CHECK("actions"."kind" IN ('issue_post', 'support_add', 'support_remove', 'violation'))
);
--> statement-breakpoint
CREATE INDEX `actions_user` ON `actions` (`user_id`,`kind`,`created_at`);--> statement-breakpoint
CREATE INDEX `actions_ip` ON `actions` (`ip_hash`,`kind`,`created_at`);--> statement-breakpoint
CREATE INDEX `actions_target` ON `actions` (`target_id`,`kind`,`created_at`);--> statement-breakpoint
CREATE TABLE `bans` (
	`user_id` text PRIMARY KEY NOT NULL,
	`until` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `issue_supports` (
	`issue_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`issue_id`, `user_id`),
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `issue_supports_issue_created` ON `issue_supports` (`issue_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `issues` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`affected` text NOT NULL,
	`example` text NOT NULL,
	`topic_id` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`topic_id`) REFERENCES `topics`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `issues_topic_id` ON `issues` (`topic_id`);--> statement-breakpoint
CREATE TABLE `topics` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
-- 第1回のお題（手で足した。設計書 docs/spec/25.md「表」）
INSERT INTO `topics` (`id`, `name`) VALUES (1, '消費者保護');
