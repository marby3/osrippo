CREATE TABLE `vote_assignments` (
	`session_key` text NOT NULL,
	`user_id` text NOT NULL,
	`seq` integer NOT NULL,
	`bill_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`session_key`, `user_id`, `seq`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`bill_id`) REFERENCES `bills`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "vote_assignments_seq" CHECK("vote_assignments"."seq" BETWEEN 0 AND 2)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vote_assignments_session_key_user_id_bill_id_unique` ON `vote_assignments` (`session_key`,`user_id`,`bill_id`);--> statement-breakpoint
CREATE TABLE `votes` (
	`session_key` text NOT NULL,
	`bill_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`choice` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`session_key`, `bill_id`, `user_id`),
	FOREIGN KEY (`bill_id`) REFERENCES `bills`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "votes_choice" CHECK("votes"."choice" IN ('yes', 'no', 'abstain'))
);
--> statement-breakpoint
CREATE INDEX `votes_user` ON `votes` (`user_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_actions` (
	`id` integer PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`user_id` text NOT NULL,
	`ip_hash` text NOT NULL,
	`target_id` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "actions_kind" CHECK("__new_actions"."kind" IN ('issue_post', 'support_add', 'support_remove', 'violation', 'solution_post', 'reaction_add', 'reaction_remove', 'bill_draft', 'bill_save', 'bill_support_add', 'bill_support_remove', 'bill_propose', 'question_post', 'answer_post', 'supplement_post', 'stance_set', 'evaluation_add', 'evaluation_remove', 'amendment_post', 'amendment_accept', 'amendment_support_add', 'amendment_support_remove', 'vote_cast'))
);
--> statement-breakpoint
INSERT INTO `__new_actions`("id", "kind", "user_id", "ip_hash", "target_id", "created_at") SELECT "id", "kind", "user_id", "ip_hash", "target_id", "created_at" FROM `actions`;--> statement-breakpoint
DROP TABLE `actions`;--> statement-breakpoint
ALTER TABLE `__new_actions` RENAME TO `actions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `actions_user` ON `actions` (`user_id`,`kind`,`created_at`);--> statement-breakpoint
CREATE INDEX `actions_ip` ON `actions` (`ip_hash`,`kind`,`created_at`);--> statement-breakpoint
CREATE INDEX `actions_target` ON `actions` (`target_id`,`kind`,`created_at`);