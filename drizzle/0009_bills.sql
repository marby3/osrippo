CREATE TABLE `bill_changes` (
	`bill_id` integer NOT NULL,
	`rev` integer NOT NULL,
	`law_seq` integer NOT NULL,
	`num` text NOT NULL,
	`op` text NOT NULL,
	`provision_id` integer,
	`caption` text,
	`body` text,
	PRIMARY KEY(`bill_id`, `rev`, `law_seq`, `num`),
	FOREIGN KEY (`provision_id`) REFERENCES `provisions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`bill_id`,`rev`,`law_seq`) REFERENCES `bill_laws`(`bill_id`,`rev`,`seq`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "bill_changes_op" CHECK("bill_changes"."op" IN ('amend', 'add', 'delete')),
	CONSTRAINT "bill_changes_provision" CHECK(("bill_changes"."op" = 'add') = ("bill_changes"."provision_id" IS NULL)),
	CONSTRAINT "bill_changes_body" CHECK(("bill_changes"."op" = 'delete') = ("bill_changes"."body" IS NULL))
);
--> statement-breakpoint
CREATE TABLE `bill_laws` (
	`bill_id` integer NOT NULL,
	`rev` integer NOT NULL,
	`seq` integer NOT NULL,
	`action` text NOT NULL,
	`law_id` text,
	`base_revision_id` text,
	`new_title` text,
	PRIMARY KEY(`bill_id`, `rev`, `seq`),
	FOREIGN KEY (`bill_id`) REFERENCES `bills`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`law_id`) REFERENCES `laws`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`base_revision_id`) REFERENCES `law_revisions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "bill_laws_seq" CHECK("bill_laws"."seq" BETWEEN 0 AND 4),
	CONSTRAINT "bill_laws_action" CHECK("bill_laws"."action" IN ('amend', 'repeal', 'enact')),
	CONSTRAINT "bill_laws_shape" CHECK(("bill_laws"."action" = 'enact') = ("bill_laws"."law_id" IS NULL AND "bill_laws"."base_revision_id" IS NULL AND "bill_laws"."new_title" IS NOT NULL)
				AND ("bill_laws"."action" <> 'enact') = ("bill_laws"."law_id" IS NOT NULL AND "bill_laws"."base_revision_id" IS NOT NULL AND "bill_laws"."new_title" IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bill_laws_law` ON `bill_laws` (`bill_id`,`rev`,`law_id`);--> statement-breakpoint
CREATE TABLE `bill_solutions` (
	`bill_id` integer NOT NULL,
	`rev` integer NOT NULL,
	`seq` integer NOT NULL,
	`solution_id` integer NOT NULL,
	PRIMARY KEY(`bill_id`, `rev`, `seq`),
	FOREIGN KEY (`bill_id`) REFERENCES `bills`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`solution_id`) REFERENCES `solutions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "bill_solutions_seq" CHECK("bill_solutions"."seq" BETWEEN 0 AND 4)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bill_solutions_solution` ON `bill_solutions` (`bill_id`,`rev`,`solution_id`);--> statement-breakpoint
CREATE TABLE `bills` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`committee_id` integer NOT NULL,
	`kind` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`rev` integer DEFAULT 0 NOT NULL,
	`next_rev` integer DEFAULT 1 NOT NULL,
	`title` text NOT NULL,
	`affected` text NOT NULL,
	`side_effects` text NOT NULL,
	`summary` text,
	`supplementary` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`committee_id`) REFERENCES `committees`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "bills_kind" CHECK("bills"."kind" IN ('amend', 'repeal', 'enact'))
);
--> statement-breakpoint
CREATE INDEX `bills_user` ON `bills` (`user_id`);--> statement-breakpoint
CREATE INDEX `bills_status_updated` ON `bills` (`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `committee_laws` (
	`committee_id` integer NOT NULL,
	`law_id` text NOT NULL,
	PRIMARY KEY(`committee_id`, `law_id`),
	FOREIGN KEY (`committee_id`) REFERENCES `committees`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`law_id`) REFERENCES `laws`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `committees` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_actions` (
	`id` integer PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`user_id` text NOT NULL,
	`ip_hash` text NOT NULL,
	`target_id` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "actions_kind" CHECK("__new_actions"."kind" IN ('issue_post', 'support_add', 'support_remove', 'violation', 'solution_post', 'reaction_add', 'reaction_remove', 'bill_draft', 'bill_save', 'bill_support_add', 'bill_support_remove', 'bill_propose'))
);
--> statement-breakpoint
INSERT INTO `__new_actions`("id", "kind", "user_id", "ip_hash", "target_id", "created_at") SELECT "id", "kind", "user_id", "ip_hash", "target_id", "created_at" FROM `actions`;--> statement-breakpoint
DROP TABLE `actions`;--> statement-breakpoint
ALTER TABLE `__new_actions` RENAME TO `actions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `actions_user` ON `actions` (`user_id`,`kind`,`created_at`);--> statement-breakpoint
CREATE INDEX `actions_ip` ON `actions` (`ip_hash`,`kind`,`created_at`);--> statement-breakpoint
CREATE INDEX `actions_target` ON `actions` (`target_id`,`kind`,`created_at`);--> statement-breakpoint
-- 第1委員会（設計書 docs/spec/45.md）。対象法令（committee_laws）は laws と同じく取り込み（seed.ts）で入れる
INSERT INTO `committees` (`id`, `name`) VALUES (1, '消費者保護');
