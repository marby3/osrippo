CREATE TABLE `moderation_logs` (
	`id` integer PRIMARY KEY NOT NULL,
	`issue_id` integer NOT NULL,
	`action` text NOT NULL,
	`actor` text NOT NULL,
	`actor_user_id` text,
	`reason` text,
	`note` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `moderation_logs_issue` ON `moderation_logs` (`issue_id`);--> statement-breakpoint
CREATE TABLE `reports` (
	`id` integer PRIMARY KEY NOT NULL,
	`issue_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`reason` text NOT NULL,
	`note` text,
	`counted` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "reports_reason" CHECK("reports"."reason" IN ('attack', 'spam', 'duplicate', 'other', 'none'))
);
--> statement-breakpoint
CREATE INDEX `reports_user` ON `reports` (`user_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `reports_issue_id_user_id_unique` ON `reports` (`issue_id`,`user_id`);--> statement-breakpoint
ALTER TABLE `issues` ADD `status` text DEFAULT 'visible' NOT NULL;--> statement-breakpoint
ALTER TABLE `issues` ADD `status_actor` text;--> statement-breakpoint
ALTER TABLE `issues` ADD `status_actor_user_id` text;--> statement-breakpoint
ALTER TABLE `issues` ADD `status_reason` text;--> statement-breakpoint
ALTER TABLE `issues` ADD `status_note` text;--> statement-breakpoint
ALTER TABLE `issues` ADD `status_changed_at` integer;--> statement-breakpoint
ALTER TABLE `user` ADD `role` text;--> statement-breakpoint
-- 課題の状態が変わったら、同じ文の中で公開の記録を書く（手で足した。設計書 docs/spec/28.md 決めたこと3・5）。
-- 状態を変える UPDATE が status_* に対応した人・理由・メモ・時刻を一緒に入れる。記録だけが抜けることも、同時の操作で重なることもない
CREATE TRIGGER `issues_status_log` AFTER UPDATE OF `status` ON `issues`
WHEN NEW.`status` <> OLD.`status`
BEGIN
	INSERT INTO `moderation_logs` (`issue_id`, `action`, `actor`, `actor_user_id`, `reason`, `note`, `created_at`)
	VALUES (
		NEW.`id`,
		CASE NEW.`status` WHEN 'auto_hidden' THEN 'auto_hide' WHEN 'hidden' THEN 'hide' WHEN 'restored' THEN 'restore' END,
		NEW.`status_actor`,
		NEW.`status_actor_user_id`,
		NEW.`status_reason`,
		NEW.`status_note`,
		NEW.`status_changed_at`
	);
END;
