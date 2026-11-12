CREATE TABLE `stance_stats` (
	`session_key` text NOT NULL,
	`bill_id` integer NOT NULL,
	`data` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`session_key`, `bill_id`),
	FOREIGN KEY (`bill_id`) REFERENCES `bills`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "stance_stats_data" CHECK(json_valid("stance_stats"."data"))
);
