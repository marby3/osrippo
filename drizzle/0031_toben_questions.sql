CREATE TABLE `toben_answers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`question_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer NOT NULL,
	`edited_at` integer,
	`moderation_status` text DEFAULT 'visible' NOT NULL,
	`moderation_changed_at` integer,
	FOREIGN KEY (`question_id`) REFERENCES `toben_questions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "toben_answers_status" CHECK("toben_answers"."moderation_status" IN ('visible', 'auto_hidden', 'hidden', 'restored'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `toben_answers_once` ON `toben_answers` (`question_id`);--> statement-breakpoint
CREATE TABLE `toben_moderation_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` integer NOT NULL,
	`target_kind` text NOT NULL,
	`target_id` integer NOT NULL,
	`action` text NOT NULL,
	`actor` text NOT NULL,
	`actor_user_id` text,
	`reason` text,
	`note` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `toben_events`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "toben_moderation_logs_kind" CHECK("toben_moderation_logs"."target_kind" IN ('question', 'answer'))
);
--> statement-breakpoint
CREATE INDEX `toben_moderation_logs_created` ON `toben_moderation_logs` (`created_at`);--> statement-breakpoint
CREATE TABLE `toben_questions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer NOT NULL,
	`moderation_status` text DEFAULT 'visible' NOT NULL,
	`moderation_changed_at` integer,
	FOREIGN KEY (`event_id`) REFERENCES `toben_events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "toben_questions_status" CHECK("toben_questions"."moderation_status" IN ('visible', 'auto_hidden', 'hidden', 'restored'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `toben_questions_once` ON `toben_questions` (`event_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `toben_reports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`target_kind` text NOT NULL,
	`target_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`reason` text NOT NULL,
	`note` text,
	`counted` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "toben_reports_kind" CHECK("toben_reports"."target_kind" IN ('question', 'answer')),
	CONSTRAINT "toben_reports_reason" CHECK("toben_reports"."reason" IN ('attack', 'spam', 'other', 'none'))
);
--> statement-breakpoint
CREATE INDEX `toben_reports_user` ON `toben_reports` (`user_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `toben_reports_once` ON `toben_reports` (`target_kind`,`target_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `toben_want_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`question_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`ip_hash` text NOT NULL,
	`op` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "toben_want_logs_op" CHECK("toben_want_logs"."op" IN ('add', 'remove'))
);
--> statement-breakpoint
CREATE INDEX `toben_want_logs_user` ON `toben_want_logs` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `toben_want_logs_question` ON `toben_want_logs` (`question_id`,`ip_hash`,`created_at`);--> statement-breakpoint
CREATE TABLE `toben_wants` (
	`question_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`question_id`, `user_id`),
	FOREIGN KEY (`question_id`) REFERENCES `toben_questions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
