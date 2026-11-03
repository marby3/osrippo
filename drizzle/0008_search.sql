-- 全文検索の表（手で書いた。設計書 docs/spec/38.md「表」）。drizzle-kit は FTS5 の仮想表を扱わないので schema.ts には書かない。
-- kind：provision（ref_id は provision_versions.id）・issue（issues.id）・solution（solutions.id）。
-- text はそろえた文字列（search_bigram は2文字ずつの組を空白でつないだもの）。表示中かどうかは引くときに元の表と結んで絞る
CREATE VIRTUAL TABLE `search_trigram` USING fts5 (kind UNINDEXED, ref_id UNINDEXED, text, tokenize = 'trigram');
--> statement-breakpoint
CREATE VIRTUAL TABLE `search_bigram` USING fts5 (kind UNINDEXED, ref_id UNINDEXED, text, tokenize = 'unicode61 remove_diacritics 0');
