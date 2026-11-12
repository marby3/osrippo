CREATE TABLE `toben_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`target_kind` text NOT NULL,
	`target_id` integer NOT NULL,
	`title` text NOT NULL,
	`starts_at` integer NOT NULL,
	`ends_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`cancelled_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "toben_events_kind" CHECK("toben_events"."target_kind" IN ('issue', 'bill')),
	CONSTRAINT "toben_events_time" CHECK("toben_events"."starts_at" < "toben_events"."ends_at")
);
--> statement-breakpoint
CREATE INDEX `toben_events_target` ON `toben_events` (`target_kind`,`target_id`,`starts_at`);--> statement-breakpoint
CREATE INDEX `toben_events_starts` ON `toben_events` (`starts_at`);