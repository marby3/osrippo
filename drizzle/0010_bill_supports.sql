CREATE TABLE `bill_supports` (
	`bill_id` integer NOT NULL,
	`rev` integer NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`bill_id`, `rev`, `user_id`),
	FOREIGN KEY (`bill_id`) REFERENCES `bills`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `session_participants` (
	`committee_id` integer NOT NULL,
	`session_key` text NOT NULL,
	`active_count` integer NOT NULL,
	`fixed_at` integer NOT NULL,
	PRIMARY KEY(`committee_id`, `session_key`),
	FOREIGN KEY (`committee_id`) REFERENCES `committees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `bills` ADD `proposed_at` integer;--> statement-breakpoint
CREATE INDEX `bills_status_created` ON `bills` (`status`,`created_at`);