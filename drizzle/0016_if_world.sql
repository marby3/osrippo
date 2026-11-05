CREATE TABLE `bill_adjustments` (
	`bill_id` integer NOT NULL,
	`session_key` text NOT NULL,
	`reason` text NOT NULL,
	`due_at` integer NOT NULL,
	`proposed_at` integer NOT NULL,
	`resolved_at` integer,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`bill_id`, `session_key`),
	FOREIGN KEY (`bill_id`) REFERENCES `bills`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "bill_adjustments_reason" CHECK("bill_adjustments"."reason" IN ('article', 'repealed', 'title'))
);
--> statement-breakpoint
CREATE TABLE `if_added_articles` (
	`law_id` text NOT NULL,
	`num` text NOT NULL,
	`provision_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`law_id`, `num`),
	FOREIGN KEY (`law_id`) REFERENCES `laws`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`provision_id`) REFERENCES `provisions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `if_branches` (
	`law_id` text PRIMARY KEY NOT NULL,
	`revision_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`law_id`) REFERENCES `laws`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`revision_id`) REFERENCES `law_revisions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `if_laws` (
	`id` text PRIMARY KEY NOT NULL,
	`bill_id` integer NOT NULL,
	`bill_rev` integer NOT NULL,
	`title` text NOT NULL,
	`session_key` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`bill_id`) REFERENCES `bills`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `if_laws_bill_id_unique` ON `if_laws` (`bill_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `if_laws_title_unique` ON `if_laws` (`title`);--> statement-breakpoint
CREATE TABLE `if_revisions` (
	`law_id` text NOT NULL,
	`seq` integer NOT NULL,
	`bill_id` integer NOT NULL,
	`bill_rev` integer NOT NULL,
	`law_seq` integer NOT NULL,
	`session_key` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`law_id`, `seq`),
	FOREIGN KEY (`law_id`) REFERENCES `laws`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`bill_id`,`bill_rev`,`law_seq`) REFERENCES `bill_laws`(`bill_id`,`rev`,`seq`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `if_revisions_bill` ON `if_revisions` (`bill_id`,`bill_rev`,`law_seq`);--> statement-breakpoint
ALTER TABLE `bill_laws` ADD `base_if_seq` integer DEFAULT 0 NOT NULL;