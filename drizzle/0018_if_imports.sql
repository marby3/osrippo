CREATE TABLE `if_import_articles` (
	`law_id` text NOT NULL,
	`revision_id` text NOT NULL,
	`provision_id` integer NOT NULL,
	`num` text NOT NULL,
	`prev_num` text,
	`change` text NOT NULL,
	`conflict` integer NOT NULL,
	`real_caption` text,
	`real_body` text,
	`if_num` text,
	`if_caption` text,
	`if_body` text,
	`bill_id` integer,
	`closed_provision_id` integer,
	PRIMARY KEY(`law_id`, `revision_id`, `provision_id`),
	FOREIGN KEY (`provision_id`) REFERENCES `provisions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`bill_id`) REFERENCES `bills`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`closed_provision_id`) REFERENCES `provisions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`law_id`,`revision_id`) REFERENCES `if_imports`(`law_id`,`revision_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "if_import_articles_change" CHECK("if_import_articles"."change" IN ('amended', 'renumbered', 'added', 'removed'))
);
--> statement-breakpoint
CREATE TABLE `if_import_runs` (
	`session_key` text NOT NULL,
	`law_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`session_key`, `law_id`),
	FOREIGN KEY (`law_id`) REFERENCES `laws`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `if_imports` (
	`law_id` text NOT NULL,
	`seq` integer NOT NULL,
	`revision_id` text NOT NULL,
	`session_key` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`law_id`, `seq`),
	FOREIGN KEY (`law_id`) REFERENCES `laws`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`revision_id`) REFERENCES `law_revisions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `if_imports_revision` ON `if_imports` (`law_id`,`revision_id`);