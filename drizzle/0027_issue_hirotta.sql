CREATE TABLE `issue_hirotta` (
	`issue_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`url` text,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`issue_id`, `user_id`, `kind`),
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "issue_hirotta_kind" CHECK("issue_hirotta"."kind" IN ('considering', 'questioned')),
	CONSTRAINT "issue_hirotta_url" CHECK(("issue_hirotta"."kind" = 'questioned') = ("issue_hirotta"."url" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE `issue_hirotta_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`issue_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`action` text NOT NULL,
	`display_name` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "issue_hirotta_logs_kind" CHECK("issue_hirotta_logs"."kind" IN ('considering', 'questioned')),
	CONSTRAINT "issue_hirotta_logs_action" CHECK("issue_hirotta_logs"."action" IN ('add', 'remove'))
);
--> statement-breakpoint
CREATE INDEX `issue_hirotta_logs_created` ON `issue_hirotta_logs` (`created_at`,`id`);