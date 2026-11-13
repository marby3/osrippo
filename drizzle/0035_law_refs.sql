-- 本文の「特商法9条」を条へのリンクにする（Issue #165）。名前の表は、いま入っている読める法律から作る（このあとは取り込みが書く）
CREATE TABLE `readable_law_names` (
	`name` text NOT NULL,
	`law_id` text NOT NULL,
	PRIMARY KEY(`name`, `law_id`),
	FOREIGN KEY (`law_id`) REFERENCES `readable_laws`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `readable_law_names_law` ON `readable_law_names` (`law_id`);--> statement-breakpoint
CREATE INDEX `provisions_parent` ON `provisions` (`parent_id`);--> statement-breakpoint
INSERT INTO `readable_law_names` (`name`, `law_id`)
SELECT `title`, `id` FROM `readable_laws`
UNION
SELECT j.`value`, r.`id` FROM `readable_laws` r, json_each(r.`abbrevs`) j WHERE j.`value` <> '';
