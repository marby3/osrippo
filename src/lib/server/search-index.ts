// 全文検索の索引を、ほかの表から作り直す（Issue #202。バックアップから戻したあとに使う。手順は docs/backup.md）。
// text は、取り込みと投稿が索引を書くときと同じ関数で作る（domain/search.ts）。索引の表は drizzle/0008_search.sql と drizzle/0033_readable_laws.sql。
// 自宅サーバーの入口（scripts/restore-index.ts）から読むので、cloudflare:workers、import.meta.env、#lib に頼らない
import { asc, gt } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { insertStatements } from '../backup/sql';
import { issues, provisionVersions, readableArticles, solutions } from '../db/schema';
import { issueSearchSources, provisionSearchSource, readableSearchText, searchTexts, solutionSearchSources } from '../domain/search';
import type { BatchDb, Db } from './law';

// 索引の表は FTS5 で、スキーマでは管理しない。D1 の batch は値つきの db.run を受け付けないので、builder で書くためにここで形だけ宣言する
const searchTable = (name: string) => sqliteTable(name, { kind: text('kind').notNull(), refId: integer('ref_id').notNull(), text: text('text').notNull() });
const searchTrigram = searchTable('search_trigram');
const searchBigram = searchTable('search_bigram');
const readableSearch = sqliteTable('readable_search', { rowid: integer('rowid').notNull(), text: text('text').notNull() });

type Kind = 'provision' | 'issue' | 'solution';
type SearchRow = { kind: Kind; refId: number; trigram: string; bigram: string };
type ReadableRow = { rowid: number; text: string };
type Page = { search: SearchRow[]; readable: ReadableRow[] };

// D1 の上限：1文の値は100個、1文100KB、1回の batch に1000文。余裕をとって下回る値にする
const MAX_PARAMS = 100;
const MAX_BYTES = 90_000;
const STATEMENTS_PER_BATCH = 500;
const PAGE = 500;
const READABLE_PAGE = 100;

const bytes = (s: string) => new TextEncoder().encode(s).length;

/** 値の数と大きさで分ける */
function chunks<T>(rows: T[], perRow: number, size: (row: T) => number): T[][] {
	const result: T[][] = [];
	let chunk: T[] = [];
	let total = 0;
	for (const row of rows) {
		const s = size(row);
		if (chunk.length && ((chunk.length + 1) * perRow > MAX_PARAMS || total + s > MAX_BYTES)) {
			result.push(chunk);
			chunk = [];
			total = 0;
		}
		chunk.push(row);
		total += s;
	}
	if (chunk.length) result.push(chunk);
	return result;
}

/** 番号の順に page 件ずつ読む */
async function* keyset<T extends { id: number }>(read: (after: number) => Promise<T[]>): AsyncGenerator<T[]> {
	for (let after = 0; ; ) {
		const rows = await read(after);
		if (!rows.length) return;
		yield rows;
		after = rows[rows.length - 1].id;
	}
}

const searchRows = (kind: Kind, refId: number, sources: string[]): SearchRow[] =>
	sources.flatMap((source) => {
		const texts = searchTexts(source);
		return texts ? [{ kind, refId, ...texts }] : [];
	});

/** 索引の行を、元の表から順に作る（条・項・号 → 課題 → 解決策 → 読める法律の条） */
async function* indexPages(db: Db): AsyncGenerator<Page> {
	const v = provisionVersions;
	for await (const rows of keyset((after) => db.select({ id: v.id, caption: v.caption, text: v.text }).from(v).where(gt(v.id, after)).orderBy(asc(v.id)).limit(PAGE)))
		yield { search: rows.flatMap((r) => searchRows('provision', r.id, [provisionSearchSource(r)])), readable: [] };
	for await (const rows of keyset((after) =>
		db.select({ id: issues.id, title: issues.title, affected: issues.affected, example: issues.example }).from(issues).where(gt(issues.id, after)).orderBy(asc(issues.id)).limit(PAGE)
	))
		yield { search: rows.flatMap((r) => searchRows('issue', r.id, issueSearchSources(r))), readable: [] };
	for await (const rows of keyset((after) => db.select({ id: solutions.id, body: solutions.body }).from(solutions).where(gt(solutions.id, after)).orderBy(asc(solutions.id)).limit(PAGE)))
		yield { search: rows.flatMap((r) => searchRows('solution', r.id, solutionSearchSources(r))), readable: [] };
	const a = readableArticles;
	for await (const rows of keyset((after) =>
		db.select({ id: a.id, caption: a.caption, paragraphs: a.paragraphs }).from(a).where(gt(a.id, after)).orderBy(asc(a.id)).limit(READABLE_PAGE)
	))
		yield { search: [], readable: rows.map((r) => ({ rowid: r.id, text: readableSearchText(r.caption, r.paragraphs) })) };
}

export type RebuildResult = { search: number; readable: number };

/** 索引を全部消して作り直す（D1 の batch で書く）。作り直すあいだは検索が欠ける */
export async function rebuildSearchIndex(db: BatchDb): Promise<RebuildResult> {
	await db.batch([db.delete(searchTrigram), db.delete(searchBigram), db.delete(readableSearch)] as never);
	const result: RebuildResult = { search: 0, readable: 0 };
	for await (const page of indexPages(db)) {
		const searchBytes = (r: SearchRow) => bytes(r.trigram) + bytes(r.bigram) + 32;
		const statements: BatchItem<'sqlite'>[] = [
			...chunks(page.search, 3, searchBytes).flatMap((rows) => [
				db.insert(searchTrigram).values(rows.map((r) => ({ kind: r.kind, refId: r.refId, text: r.trigram }))),
				db.insert(searchBigram).values(rows.map((r) => ({ kind: r.kind, refId: r.refId, text: r.bigram })))
			]),
			...chunks(page.readable, 2, (r) => bytes(r.text) + 16).map((rows) => db.insert(readableSearch).values(rows))
		];
		for (let i = 0; i < statements.length; i += STATEMENTS_PER_BATCH) await db.batch(statements.slice(i, i + STATEMENTS_PER_BATCH) as never);
		result.search += page.search.length;
		result.readable += page.readable.length;
	}
	return result;
}

/** 索引を作り直す SQL を書く（wrangler d1 execute --file で D1 に流す）。先に索引を全部消す */
export async function writeIndexSql(db: Db, write: (sql: string) => void): Promise<RebuildResult> {
	write('-- 全文検索の索引の作り直し（Issue #202。docs/backup.md）\nDELETE FROM search_trigram;\nDELETE FROM search_bigram;\nDELETE FROM readable_search;\n');
	const result: RebuildResult = { search: 0, readable: 0 };
	for await (const page of indexPages(db)) {
		for (const s of insertStatements('INSERT INTO', 'search_trigram', ['kind', 'ref_id', 'text'], page.search.map((r) => [r.kind, r.refId, r.trigram]))) write(s);
		for (const s of insertStatements('INSERT INTO', 'search_bigram', ['kind', 'ref_id', 'text'], page.search.map((r) => [r.kind, r.refId, r.bigram]))) write(s);
		for (const s of insertStatements('INSERT INTO', 'readable_search', ['rowid', 'text'], page.readable.map((r) => [r.rowid, r.text]))) write(s);
		result.search += page.search.length;
		result.readable += page.readable.length;
	}
	return result;
}
