CREATE TABLE `bill_cosponsors` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`bill_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`accepted_at` integer,
	FOREIGN KEY (`bill_id`) REFERENCES `bills`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "bill_cosponsors_status" CHECK("bill_cosponsors"."status" IN ('requested', 'accepted', 'left', 'declined'))
);
--> statement-breakpoint
CREATE INDEX `bill_cosponsors_user` ON `bill_cosponsors` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `bill_cosponsors_bill_user` ON `bill_cosponsors` (`bill_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `bill_merge_consents` (
	`merged_bill_id` integer NOT NULL,
	`origin_bill_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`rev` integer NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`merged_bill_id`, `origin_bill_id`, `user_id`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`merged_bill_id`,`origin_bill_id`) REFERENCES `bill_relations`(`merged_bill_id`,`origin_bill_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `bill_relations` (
	`merged_bill_id` integer NOT NULL,
	`origin_bill_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`merged_bill_id`, `origin_bill_id`),
	FOREIGN KEY (`merged_bill_id`) REFERENCES `bills`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`origin_bill_id`) REFERENCES `bills`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "bill_relations_differ" CHECK("bill_relations"."merged_bill_id" <> "bill_relations"."origin_bill_id")
);
--> statement-breakpoint
CREATE INDEX `bill_relations_origin` ON `bill_relations` (`origin_bill_id`);--> statement-breakpoint
CREATE TABLE `bill_withdraw_consents` (
	`bill_id` integer NOT NULL,
	`proposed_rev` integer NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`bill_id`, `proposed_rev`, `user_id`),
	FOREIGN KEY (`bill_id`) REFERENCES `bills`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_actions` (
	`id` integer PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`user_id` text NOT NULL,
	`ip_hash` text NOT NULL,
	`target_id` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "actions_kind" CHECK("__new_actions"."kind" IN ('issue_post', 'support_add', 'support_remove', 'violation', 'solution_post', 'reaction_add', 'reaction_remove', 'bill_draft', 'bill_save', 'bill_support_add', 'bill_support_remove', 'bill_propose', 'question_post', 'answer_post', 'supplement_post', 'stance_set', 'evaluation_add', 'evaluation_remove', 'amendment_post', 'amendment_accept', 'amendment_support_add', 'amendment_support_remove', 'vote_cast', 'bill_cosponsor', 'bill_withdraw'))
);
--> statement-breakpoint
INSERT INTO `__new_actions`("id", "kind", "user_id", "ip_hash", "target_id", "created_at") SELECT "id", "kind", "user_id", "ip_hash", "target_id", "created_at" FROM `actions`;--> statement-breakpoint
DROP TABLE `actions`;--> statement-breakpoint
ALTER TABLE `__new_actions` RENAME TO `actions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `actions_user` ON `actions` (`user_id`,`kind`,`created_at`);--> statement-breakpoint
CREATE INDEX `actions_ip` ON `actions` (`ip_hash`,`kind`,`created_at`);--> statement-breakpoint
CREATE INDEX `actions_target` ON `actions` (`target_id`,`kind`,`created_at`);--> statement-breakpoint
ALTER TABLE `bills` ADD `withdrawn_at` integer;