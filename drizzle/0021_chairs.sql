CREATE TABLE `chair_candidates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`committee_id` integer NOT NULL,
	`session_key` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`committee_id`) REFERENCES `committees`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chair_candidates_user` ON `chair_candidates` (`committee_id`,`session_key`,`user_id`);--> statement-breakpoint
CREATE TABLE `chair_elections` (
	`committee_id` integer NOT NULL,
	`session_key` text NOT NULL,
	`total_votes` integer NOT NULL,
	`settled_at` integer NOT NULL,
	PRIMARY KEY(`committee_id`, `session_key`),
	FOREIGN KEY (`committee_id`) REFERENCES `committees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `chair_terms` (
	`committee_id` integer NOT NULL,
	`session_key` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`rank` integer NOT NULL,
	`votes` integer NOT NULL,
	`recalled_at` integer,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`committee_id`, `session_key`, `user_id`),
	FOREIGN KEY (`committee_id`) REFERENCES `committees`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chair_terms_role" CHECK("chair_terms"."role" IN ('chair', 'director')),
	CONSTRAINT "chair_terms_rank_role" CHECK(("chair_terms"."rank" = 0) = ("chair_terms"."role" = 'chair'))
);
--> statement-breakpoint
CREATE INDEX `chair_terms_user` ON `chair_terms` (`user_id`,`session_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `chair_terms_rank` ON `chair_terms` (`committee_id`,`session_key`,`rank`);--> statement-breakpoint
CREATE TABLE `chair_votes` (
	`committee_id` integer NOT NULL,
	`session_key` text NOT NULL,
	`user_id` text NOT NULL,
	`candidate_id` integer NOT NULL,
	`ip_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`committee_id`, `session_key`, `user_id`),
	FOREIGN KEY (`committee_id`) REFERENCES `committees`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`candidate_id`) REFERENCES `chair_candidates`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `chair_votes_candidate` ON `chair_votes` (`candidate_id`);--> statement-breakpoint
CREATE INDEX `chair_votes_line` ON `chair_votes` (`committee_id`,`session_key`,`ip_hash`);--> statement-breakpoint
CREATE TABLE `recall_signatures` (
	`committee_id` integer NOT NULL,
	`session_key` text NOT NULL,
	`user_id` text NOT NULL,
	`ip_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`committee_id`, `session_key`, `user_id`),
	FOREIGN KEY (`committee_id`) REFERENCES `committees`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `recall_signatures_line` ON `recall_signatures` (`committee_id`,`session_key`,`ip_hash`);--> statement-breakpoint
CREATE INDEX `moderation_logs_actor_user` ON `moderation_logs` (`actor_user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `vote_reviews_decided_by` ON `vote_reviews` (`decided_by`,`decided_at`);