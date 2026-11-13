-- 質疑の論点（Issue #168）。表を足すだけ。立てた・閉じたの記録は bill_moderation_logs の action（point_open・point_close。CHECK がないので作り直さない）
CREATE TABLE `bill_points` (
	`id` integer PRIMARY KEY NOT NULL,
	`bill_id` integer NOT NULL,
	`title` text NOT NULL,
	`created_at` integer NOT NULL,
	`closed_at` integer,
	FOREIGN KEY (`bill_id`) REFERENCES `bills`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `bill_points_bill` ON `bill_points` (`bill_id`,`id`);