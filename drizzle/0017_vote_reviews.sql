CREATE TABLE `vote_reviews` (
	`session_key` text NOT NULL,
	`bill_id` integer NOT NULL,
	`signals` text NOT NULL,
	`detail` text NOT NULL,
	`status` text NOT NULL,
	`note` text,
	`decided_role` text,
	`decided_by` text,
	`decided_at` integer,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`session_key`, `bill_id`),
	FOREIGN KEY (`bill_id`) REFERENCES `bills`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "vote_reviews_status_check" CHECK("vote_reviews"."status" IN ('noted', 'open', 'confirmed', 'voided'))
);
--> statement-breakpoint
CREATE INDEX `vote_reviews_status` ON `vote_reviews` (`status`);