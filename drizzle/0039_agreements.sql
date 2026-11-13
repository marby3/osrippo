CREATE TABLE `agreements` (
	`user_id` text NOT NULL,
	`version` text NOT NULL,
	`agreed_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `version`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
