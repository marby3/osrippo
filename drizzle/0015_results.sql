CREATE TABLE `bill_results` (
	`session_key` text NOT NULL,
	`bill_id` integer NOT NULL,
	`outcome` text NOT NULL,
	`yes` integer NOT NULL,
	`no` integer NOT NULL,
	`abstain` integer NOT NULL,
	`ref_yes` integer NOT NULL,
	`ref_no` integer NOT NULL,
	`ref_abstain` integer NOT NULL,
	`participants` integer NOT NULL,
	`quorum` integer NOT NULL,
	`rev` integer NOT NULL,
	`settled_at` integer NOT NULL,
	PRIMARY KEY(`session_key`, `bill_id`),
	FOREIGN KEY (`bill_id`) REFERENCES `bills`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "bill_results_outcome" CHECK("bill_results"."outcome" IN ('passed', 'rejected', 'lapsed'))
);
--> statement-breakpoint
CREATE INDEX `bill_results_bill` ON `bill_results` (`bill_id`);