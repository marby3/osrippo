CREATE TABLE `notification_reads` (
	`user_id` text PRIMARY KEY NOT NULL,
	`read_at` integer NOT NULL,
	`read_id` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`target_id` integer NOT NULL,
	`ref_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `notifications_user` ON `notifications` (`user_id`,`created_at`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_once` ON `notifications` (`user_id`,`kind`,`target_id`,`ref_id`);