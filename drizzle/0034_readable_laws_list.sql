-- 法律の一覧（Issue #163）の索引。式の索引は drizzle-kit が括弧を崩して書き出すので、手で直した（schema.ts の readable_laws と同じ式）
CREATE INDEX `readable_laws_kana` ON `readable_laws` (`title_kana`);--> statement-breakpoint
CREATE INDEX `readable_laws_category_kana` ON `readable_laws` (`category`,`title_kana`);--> statement-breakpoint
CREATE INDEX `readable_laws_changed` ON `readable_laws` (coalesce(`last_amended`, `promulgation_date`));--> statement-breakpoint
CREATE INDEX `readable_laws_category_changed` ON `readable_laws` (`category`, coalesce(`last_amended`, `promulgation_date`));
