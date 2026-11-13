CREATE TABLE `readable_articles` (
	`id` integer PRIMARY KEY NOT NULL,
	`law_id` text NOT NULL,
	`seq` integer NOT NULL,
	`num` text NOT NULL,
	`label` text NOT NULL,
	`caption` text NOT NULL,
	`paragraphs` text NOT NULL,
	FOREIGN KEY (`law_id`) REFERENCES `readable_laws`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `readable_articles_law_id_num_unique` ON `readable_articles` (`law_id`,`num`);--> statement-breakpoint
CREATE TABLE `readable_laws` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`title_kana` text,
	`law_num` text NOT NULL,
	`law_type` text NOT NULL,
	`category` text,
	`abbrevs` text DEFAULT '[]' NOT NULL,
	`promulgation_date` text NOT NULL,
	`last_amended` text,
	`revision_id` text NOT NULL,
	`updated` text NOT NULL,
	`headings` text,
	`article_count` integer,
	`synced_updated` text,
	CONSTRAINT "readable_laws_law_type" CHECK("readable_laws"."law_type" IN ('Act', 'Constitution'))
);
--> statement-breakpoint
-- 読める法律の全文検索（手で書いた。設計書 docs/spec/162.md「表」）。drizzle-kit は FTS5 の仮想表を扱わないので schema.ts には書かない。
-- 本文の写しを持たない（content=''）。rowid は readable_articles.id、text は条の見出しと本文をそろえた文字列（domain/search.ts の readableSearchText）。
-- 消すときは 'delete' の命令に、入れたときと同じ text を渡す
CREATE VIRTUAL TABLE `readable_search` USING fts5 (text, tokenize = 'trigram', content = '');
