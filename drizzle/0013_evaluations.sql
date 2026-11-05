CREATE TABLE `evaluations` (
	`post_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`stance` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`post_id`, `user_id`, `kind`),
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "evaluations_kind" CHECK("evaluations"."kind" IN ('reasonable', 'changed')),
	CONSTRAINT "evaluations_stance" CHECK("evaluations"."stance" IN ('for', 'against', 'undecided'))
);
--> statement-breakpoint
CREATE INDEX `evaluations_user` ON `evaluations` (`user_id`);--> statement-breakpoint
CREATE TABLE `post_views` (
	`post_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`stance` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`post_id`, `user_id`),
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "post_views_stance" CHECK("post_views"."stance" IN ('for', 'against', 'undecided'))
);
--> statement-breakpoint
ALTER TABLE `posts` ADD `stance` text DEFAULT 'undecided' NOT NULL;--> statement-breakpoint
CREATE INDEX `posts_session` ON `posts` (`session_key`);