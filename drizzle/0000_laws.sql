CREATE TABLE `law_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`law_id` text NOT NULL,
	`branch` text NOT NULL,
	`seq` integer NOT NULL,
	`enforcement_date` text NOT NULL,
	`status` text NOT NULL,
	`amendment_law_title` text,
	`amendment_law_num` text,
	`amendment_promulgate_date` text,
	FOREIGN KEY (`law_id`) REFERENCES `laws`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "law_revisions_branch" CHECK("law_revisions"."branch" IN ('real')),
	CONSTRAINT "law_revisions_status" CHECK("law_revisions"."status" IN ('enforced', 'scheduled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `law_revisions_law_id_branch_seq_unique` ON `law_revisions` (`law_id`,`branch`,`seq`);--> statement-breakpoint
CREATE TABLE `laws` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`title_kana` text,
	`law_num` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `provision_versions` (
	`id` integer PRIMARY KEY NOT NULL,
	`provision_id` integer NOT NULL,
	`from_revision_id` text NOT NULL,
	`to_revision_id` text,
	`num` text NOT NULL,
	`caption` text,
	`text` text,
	`change` text NOT NULL,
	`similarity` real,
	`unconfirmed_of` integer,
	FOREIGN KEY (`provision_id`) REFERENCES `provisions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`from_revision_id`) REFERENCES `law_revisions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_revision_id`) REFERENCES `law_revisions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`unconfirmed_of`) REFERENCES `provisions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "provision_versions_change" CHECK("provision_versions"."change" IN ('baseline', 'added', 'amended', 'renumbered', 'unconfirmed'))
);
--> statement-breakpoint
CREATE INDEX `provision_versions_from` ON `provision_versions` (`from_revision_id`);--> statement-breakpoint
CREATE INDEX `provision_versions_to` ON `provision_versions` (`to_revision_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `provision_versions_provision_id_from_revision_id_unique` ON `provision_versions` (`provision_id`,`from_revision_id`);--> statement-breakpoint
CREATE TABLE `provisions` (
	`id` integer PRIMARY KEY NOT NULL,
	`law_id` text NOT NULL,
	`kind` text NOT NULL,
	`parent_id` integer,
	FOREIGN KEY (`law_id`) REFERENCES `laws`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`parent_id`) REFERENCES `provisions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "provisions_kind" CHECK("provisions"."kind" IN ('article', 'paragraph', 'item'))
);
--> statement-breakpoint
CREATE INDEX `provisions_law_id` ON `provisions` (`law_id`);