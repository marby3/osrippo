ALTER TABLE `bills` ADD `resubmitted_from` integer REFERENCES bills(id);--> statement-breakpoint
CREATE INDEX `bills_resubmitted_from` ON `bills` (`resubmitted_from`);