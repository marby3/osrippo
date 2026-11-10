CREATE TABLE `user_verification_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`action` text NOT NULL,
	`kind` text NOT NULL,
	`display_name` text NOT NULL,
	`field` text,
	`actor_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "user_verification_logs_action" CHECK("user_verification_logs"."action" IN ('grant', 'renew', 'revoke'))
);
--> statement-breakpoint
CREATE INDEX `user_verification_logs_created` ON `user_verification_logs` (`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `user_verifications` (
	`user_id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`display_name` text NOT NULL,
	`field` text,
	`granted_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	`updated_at` integer NOT NULL,
	`op` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "user_verifications_kind" CHECK("user_verifications"."kind" IN ('legislator', 'expert')),
	CONSTRAINT "user_verifications_field" CHECK(("user_verifications"."kind" = 'expert') = ("user_verifications"."field" IS NOT NULL))
);
