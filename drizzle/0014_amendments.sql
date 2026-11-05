CREATE TABLE `amendment_supports` (
	`amendment_id` integer NOT NULL,
	`revision` integer NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`amendment_id`, `revision`, `user_id`),
	FOREIGN KEY (`amendment_id`) REFERENCES `amendments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `amendment_votes` (
	`session_key` text NOT NULL,
	`amendment_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`choice` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`session_key`, `amendment_id`, `user_id`),
	FOREIGN KEY (`amendment_id`) REFERENCES `amendments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "amendment_votes_choice" CHECK("amendment_votes"."choice" IN ('yes', 'no', 'abstain'))
);
--> statement-breakpoint
CREATE TABLE `amendments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`bill_id` integer NOT NULL,
	`session_key` text NOT NULL,
	`user_id` text NOT NULL,
	`base_rev` integer NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`law_seq` integer NOT NULL,
	`num` text NOT NULL,
	`provision_id` integer,
	`caption` text,
	`body` text NOT NULL,
	`reason` text,
	`status` text DEFAULT 'open' NOT NULL,
	`applied_rev` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`bill_id`) REFERENCES `bills`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`provision_id`) REFERENCES `provisions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `amendments_bill` ON `amendments` (`bill_id`,`id`);--> statement-breakpoint
CREATE INDEX `amendments_user` ON `amendments` (`user_id`);--> statement-breakpoint
ALTER TABLE `bills` ADD `proposed_rev` integer;