-- 条の「リンク元」（Issue #166）。前からある課題・解決策・質疑の行は、本文を読み解く一度きりの処理（pnpm backfill:law-refs）で入れる
CREATE TABLE `law_refs` (
	`kind` text NOT NULL,
	`ref_id` integer NOT NULL,
	`law_id` text NOT NULL,
	`num` text NOT NULL,
	PRIMARY KEY(`kind`, `ref_id`, `law_id`, `num`),
	CONSTRAINT "law_refs_kind" CHECK("law_refs"."kind" IN ('issue', 'solution', 'post'))
);
--> statement-breakpoint
CREATE INDEX `law_refs_article` ON `law_refs` (`law_id`,`num`,`kind`,`ref_id`);--> statement-breakpoint
CREATE INDEX `bill_changes_provision` ON `bill_changes` (`provision_id`);--> statement-breakpoint
CREATE INDEX `bill_changes_num` ON `bill_changes` (`num`);