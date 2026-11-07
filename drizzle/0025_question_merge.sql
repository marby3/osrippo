ALTER TABLE `bill_moderation_logs` ADD `merged_into` integer;--> statement-breakpoint
ALTER TABLE `posts` ADD `merged_into` integer;--> statement-breakpoint
CREATE INDEX `posts_merged_into` ON `posts` (`merged_into`);--> statement-breakpoint
DROP TRIGGER `posts_status_log`;
--> statement-breakpoint
CREATE TRIGGER `posts_status_log` AFTER UPDATE OF `status` ON `posts`
WHEN NEW.`status` <> OLD.`status`
BEGIN
	INSERT INTO `bill_moderation_logs` (`bill_id`, `post_id`, `action`, `actor`, `actor_user_id`, `reason`, `note`, `merged_into`, `created_at`)
	VALUES (
		NEW.`bill_id`,
		NEW.`id`,
		CASE NEW.`status` WHEN 'auto_hidden' THEN 'auto_hide' WHEN 'hidden' THEN 'hide' WHEN 'restored' THEN 'restore' WHEN 'merged' THEN 'merge' END,
		NEW.`status_actor`,
		NEW.`status_actor_user_id`,
		NEW.`status_reason`,
		NEW.`status_note`,
		CASE WHEN NEW.`status` = 'merged' THEN NEW.`merged_into` END,
		NEW.`status_changed_at`
	);
END;
