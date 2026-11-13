// 画面のテストの D1 に入れる読める法律の SQL（Issue #162、設計書 docs/spec/162.md 決めたこと6）。
// 取り込みの関数（syncReadable）に、テストデータを返す読み込みの関数を渡して node:sqlite の上で流し、できた行を SQL にする。e-Gov は呼ばない。
// node:sqlite を使うので、Worker から読まない（seed.ts は Worker からも読まれるので、ここを分けている）
import type { FetchJson } from '../egov/client';
import { readableSearchText } from '../domain/search';
import { syncReadable } from '../server/readable-sync';
import { openMemoryDb } from './memory';
import { inserts, seedStatements, type Table, type Value } from './seed';

/** load(name) は tests/fixtures/egov/<name>.json の中身を返す。lawIds は遊べる法律（seedStatements と同じもの） */
export async function readableSeedStatements(lawIds: string[], load: (name: string) => unknown): Promise<string[]> {
	const { sqlite, db } = openMemoryDb();
	for (const statement of seedStatements(lawIds, load)) sqlite.exec(statement);
	const fetchJson: FetchJson = async (url) => {
		const u = new URL(url);
		const lawType = u.searchParams.get('law_type');
		if (u.pathname.endsWith('/laws') && lawType) return load(`laws_list_${lawType.toLowerCase()}`);
		const data = /\/law_data\/([^/]+)$/.exec(u.pathname);
		if (data) return load(`law_data_${decodeURIComponent(data[1])}`);
		throw new Error(`テストデータにない URL ${url}`);
	};
	const result = await syncReadable(db, fetchJson, async () => undefined);
	if (result.listError || result.failed.length) throw new Error(`読める法律のテストデータを取り込めませんでした：${result.listError ?? result.failed.join(', ')}`);

	const table = (name: string, sql: string): Table => {
		const rows = sqlite.prepare(sql).all() as Record<string, Value>[];
		const columns = rows.length ? Object.keys(rows[0]) : [];
		return { name, columns, rows: rows.map((r) => columns.map((c) => r[c])) };
	};
	const laws = table('readable_laws', 'SELECT * FROM readable_laws ORDER BY id');
	const articles = table('readable_articles', 'SELECT * FROM readable_articles ORDER BY id');
	// 索引は本文の写しを持たないので、条の行から作り直す（取り込みと同じ関数）
	const search: Table = {
		name: 'readable_search',
		columns: ['rowid', 'text'],
		rows: (sqlite.prepare('SELECT id, caption, paragraphs FROM readable_articles ORDER BY id').all() as { id: number; caption: string; paragraphs: string }[]).map((a) => [
			a.id,
			readableSearchText(a.caption, JSON.parse(a.paragraphs))
		])
	};
	return [laws, articles, search].filter((t) => t.rows.length).flatMap(inserts);
}
