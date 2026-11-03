ALTER TABLE `issues` ADD `merged_into` integer;--> statement-breakpoint
CREATE INDEX `issues_merged_into` ON `issues` (`merged_into`);--> statement-breakpoint
ALTER TABLE `moderation_logs` ADD `merged_into` integer;--> statement-breakpoint
-- 課題の状態が変わったときのトリガーを作り直す（手で足した。設計書 docs/spec/30.md 決めたこと4・7）。
-- 0004 の記録に加えて、統合（merged）のときは同じ文の中で次も行う：
--   ・元の課題の「わかる」を統合先へ写す（両方に付けた人は統合先の行が残る。created_at は元のまま）
--   ・元の課題へすでに統合されていた課題を、新しい統合先に付け替える（転送が1回で済むように）
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
END;
