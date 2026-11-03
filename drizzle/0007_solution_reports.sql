CREATE TABLE `solution_reports` (
	`id` integer PRIMARY KEY NOT NULL,
	`solution_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`reason` text NOT NULL,
	`note` text,
	`counted` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`solution_id`) REFERENCES `solutions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "solution_reports_reason" CHECK("solution_reports"."reason" IN ('attack', 'spam', 'other', 'none'))
);
--> statement-breakpoint
CREATE INDEX `solution_reports_user` ON `solution_reports` (`user_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `solution_reports_solution_id_user_id_unique` ON `solution_reports` (`solution_id`,`user_id`);--> statement-breakpoint
ALTER TABLE `moderation_logs` ADD `solution_id` integer;--> statement-breakpoint
ALTER TABLE `solutions` ADD `status` text DEFAULT 'visible' NOT NULL;--> statement-breakpoint
ALTER TABLE `solutions` ADD `status_actor` text;--> statement-breakpoint
ALTER TABLE `solutions` ADD `status_actor_user_id` text;--> statement-breakpoint
ALTER TABLE `solutions` ADD `status_reason` text;--> statement-breakpoint
ALTER TABLE `solutions` ADD `status_note` text;--> statement-breakpoint
ALTER TABLE `solutions` ADD `status_changed_at` integer;--> statement-breakpoint
-- 解決策の状態が変わったら、同じ文の中で公開の記録を書く（手で足した。設計書 docs/spec/36.md「表」）。
-- 課題を統合して解決策を移す UPDATE は status を変えないので、このトリガーは動かない
CREATE TRIGGER `solutions_status_log` AFTER UPDATE OF `status` ON `solutions`
WHEN NEW.`status` <> OLD.`status`
BEGIN
	INSERT INTO `moderation_logs` (`issue_id`, `solution_id`, `action`, `actor`, `actor_user_id`, `reason`, `note`, `created_at`)
	VALUES (
		NEW.`issue_id`,
		NEW.`id`,
		CASE NEW.`status` WHEN 'auto_hidden' THEN 'auto_hide' WHEN 'hidden' THEN 'hide' WHEN 'restored' THEN 'restore' END,
		NEW.`status_actor`,
		NEW.`status_actor_user_id`,
		NEW.`status_reason`,
		NEW.`status_note`,
		NEW.`status_changed_at`
	);
END;
