CREATE TABLE `solution_reactions` (
	`solution_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`solution_id`, `user_id`, `kind`),
	FOREIGN KEY (`solution_id`) REFERENCES `solutions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "solution_reactions_kind" CHECK("solution_reactions"."kind" IN ('support', 'changed'))
);
--> statement-breakpoint
CREATE TABLE `solutions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`issue_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `solutions_issue_id` ON `solutions` (`issue_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_actions` (
	`id` integer PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`user_id` text NOT NULL,
	`ip_hash` text NOT NULL,
	`target_id` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "actions_kind" CHECK("__new_actions"."kind" IN ('issue_post', 'support_add', 'support_remove', 'violation', 'solution_post', 'reaction_add', 'reaction_remove'))
);
--> statement-breakpoint
INSERT INTO `__new_actions`("id", "kind", "user_id", "ip_hash", "target_id", "created_at") SELECT "id", "kind", "user_id", "ip_hash", "target_id", "created_at" FROM `actions`;--> statement-breakpoint
DROP TABLE `actions`;--> statement-breakpoint
ALTER TABLE `__new_actions` RENAME TO `actions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `actions_user` ON `actions` (`user_id`,`kind`,`created_at`);--> statement-breakpoint
CREATE INDEX `actions_ip` ON `actions` (`ip_hash`,`kind`,`created_at`);--> statement-breakpoint
CREATE INDEX `actions_target` ON `actions` (`target_id`,`kind`,`created_at`);--> statement-breakpoint
-- 課題の状態が変わったときのトリガーを作り直す（手で足した。設計書 docs/spec/34.md 決めたこと7）。
-- 0005 の3つの文（記録を書く、「わかる」を写す、統合先を付け替える）はそのまま残し、統合のときに解決策も統合先へ移す
DROP TRIGGER `issues_status_log`;--> statement-breakpoint
CREATE TRIGGER `issues_status_log` AFTER UPDATE OF `status` ON `issues`
WHEN NEW.`status` <> OLD.`status`
BEGIN
	INSERT INTO `moderation_logs` (`issue_id`, `action`, `actor`, `actor_user_id`, `reason`, `note`, `merged_into`, `created_at`)
	VALUES (
		NEW.`id`,
		CASE NEW.`status`
			WHEN 'auto_hidden' THEN 'auto_hide'
			WHEN 'hidden' THEN 'hide'
			WHEN 'restored' THEN 'restore'
			WHEN 'merged' THEN 'merge'
		END,
		NEW.`status_actor`,
		NEW.`status_actor_user_id`,
		NEW.`status_reason`,
		NEW.`status_note`,
		NEW.`merged_into`,
		NEW.`status_changed_at`
	);
	-- 主キーの重なり（両方に付けた人）だけを捨てる。OR IGNORE だと NOT NULL 違反なども黙って捨てるので使わない
	INSERT INTO `issue_supports` (`issue_id`, `user_id`, `created_at`)
	SELECT NEW.`merged_into`, `user_id`, `created_at` FROM `issue_supports`
	WHERE `issue_id` = NEW.`id` AND NEW.`status` = 'merged' AND NEW.`merged_into` IS NOT NULL
	ON CONFLICT (`issue_id`, `user_id`) DO NOTHING;
	UPDATE `issues` SET `merged_into` = NEW.`merged_into`
	WHERE `merged_into` = NEW.`id` AND NEW.`status` = 'merged' AND NEW.`merged_into` IS NOT NULL;
	UPDATE `solutions` SET `issue_id` = NEW.`merged_into`
	WHERE `issue_id` = NEW.`id` AND NEW.`status` = 'merged' AND NEW.`merged_into` IS NOT NULL;
END;
