// Issue #162 基準1・2と信頼の境界：読める法律の取り込み（設計書 docs/spec/162.md）。e-Gov は呼ばず、テストデータの一覧と本文を使う
import { beforeEach, expect, test, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import type { FetchJson } from '../egov/client';
import { syncReadable } from '../server/readable-sync';
import { openMemoryDb } from './memory';
import { seedStatements } from './seed';

const MINPO = '129AC0000000089';
const KENPO = '321CONSTITUTION';
const SHOHIN = '337AC0000000134';
const SHOHISHA = '412AC0000000061';
const UNENFORCED = '508AC0000000099';

type Row = Record<string, string | number | null>;
type List = { total_count: number; count: number; laws: { law_info: Record<string, unknown>; revision_info: Record<string, unknown> }[] };

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../../../tests/fixtures/egov/${name}.json`, import.meta.url), 'utf8'));
const all = (sqlite: DatabaseSync, sql: string, ...params: string[]) => sqlite.prepare(sql).all(...params) as Row[];

/** 遊べる法律は消費者契約法だけにする（民法・景品表示法・憲法が読める法律になる） */
function setup() {
	const { sqlite, db } = openMemoryDb();
	for (const statement of seedStatements([SHOHISHA], fixture)) sqlite.exec(statement);
	return { sqlite, db };
}

/** 一覧と本文を返す e-Gov の代わり。adjust で一覧を変えられる。呼ばれた URL を残す */
function fakeEgov(adjust: (list: List, lawType: string) => List = (list) => list) {
	const calls: string[] = [];
	const fetchJson: FetchJson = async (url) => {
		calls.push(url);
		const u = new URL(url);
		if (u.pathname.endsWith('/laws')) {
			const lawType = u.searchParams.get('law_type');
			if (lawType === 'Act') return adjust(fixture('laws_list_act'), lawType);
			if (lawType === 'Constitution') return adjust(fixture('laws_list_constitution'), lawType);
		}
		const data = /\/law_data\/([^/]+)$/.exec(u.pathname);
		if (data) return fixture(`law_data_${decodeURIComponent(data[1])}`);
		throw new Error(`知らない URL ${url}`);
	};
	return { fetchJson, calls, bodies: () => calls.filter((c) => c.includes('/law_data/')) };
}

const noWait = async () => undefined;

beforeEach(() => {
	// 取り込みの失敗はログに出る。テストの出力を埋めない
	vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

test('基準1：一覧から法令名などの欄と、最新の版の条文が入る。遊べる法律の条と未施行だけの法律は入らない', async () => {
	const { sqlite, db } = setup();
	const egov = fakeEgov();
	const result = await syncReadable(db, egov.fetchJson, noWait);
	expect(result.listError).toBeNull();
	expect(result.failed).toEqual([]);

	expect(
		all(sqlite, 'SELECT id, title, title_kana, abbrevs, category, law_num, law_type, promulgation_date, last_amended FROM readable_laws ORDER BY id')
	).toEqual([
		{ id: MINPO, title: '民法', title_kana: 'みんぽう', abbrevs: '[]', category: '民事', law_num: '明治二十九年法律第八十九号', law_type: 'Act', promulgation_date: '1896-04-27', last_amended: '2020-04-01' },
		{ id: KENPO, title: '日本国憲法', title_kana: 'にほんこくけんぽう', abbrevs: '[]', category: '憲法', law_num: '昭和二十一年憲法', law_type: 'Constitution', promulgation_date: '1946-11-03', last_amended: null },
		{ id: SHOHIN, title: '不当景品類及び不当表示防止法', title_kana: 'ふとうけいひんるいおよびふとうひょうじぼうしほう', abbrevs: '["景表法","景品表示法"]', category: '産業通則', law_num: '昭和三十七年法律第百三十四号', law_type: 'Act', promulgation_date: '1962-05-15', last_amended: '2026-05-21' },
		// 遊べる法律の行も入る（#163 の一覧と検索で使う）
		{ id: SHOHISHA, title: '消費者契約法', title_kana: 'しょうひしゃけいやくほう', abbrevs: '[]', category: '商業', law_num: '平成十二年法律第六十一号', law_type: 'Act', promulgation_date: '2000-05-12', last_amended: '2026-06-24' }
	]);
	expect(all(sqlite, 'SELECT id FROM readable_laws WHERE id = ?', UNENFORCED)).toEqual([]);

	// 民法の条が入り、本文の3文字の言葉で引ける
	const [minpo] = all(sqlite, 'SELECT article_count, synced_updated FROM readable_laws WHERE id = ?', MINPO);
	expect(minpo).toEqual({ article_count: 1144, synced_updated: '2024-07-23T04:17:53+09:00' });
	expect(all(sqlite, 'SELECT num, label, caption FROM readable_articles WHERE law_id = ? ORDER BY seq LIMIT 1', MINPO)).toEqual([
		{ num: '1', label: '第1条', caption: '（基本原則）' }
	]);
	const hits = all(
		sqlite,
		`SELECT a.law_id, a.num FROM readable_search s JOIN readable_articles a ON a.id = s.rowid WHERE readable_search MATCH ?`,
		'"私権は"'
	);
	expect(hits).toContainEqual({ law_id: MINPO, num: '1' });

	// 遊べる法律の条は入らない
	expect(all(sqlite, 'SELECT id FROM readable_articles WHERE law_id = ?', SHOHISHA)).toEqual([]);
	expect(egov.bodies().some((u) => u.includes(SHOHISHA))).toBe(false);
}, 60_000);

test('一覧の形：1行の law_info.law_id がない一覧は断り、何も書かない', async () => {
	const { sqlite, db } = setup();
	const egov = fakeEgov((list, lawType) => {
		if (lawType === 'Act') delete list.laws[1].law_info.law_id;
		return list;
	});
	const result = await syncReadable(db, egov.fetchJson, noWait);
	expect(result.listError).toBeTruthy();
	expect(all(sqlite, 'SELECT id FROM readable_laws')).toEqual([]);
	expect(all(sqlite, 'SELECT id FROM readable_articles')).toEqual([]);
	expect(egov.bodies()).toEqual([]);
});

test('基準2：2回目は本文を読まない。updated が変わった法律だけを読み直す', async () => {
	const { sqlite, db } = setup();
	const first = fakeEgov();
	await syncReadable(db, first.fetchJson, noWait);
	expect(first.bodies()).toHaveLength(3);

	const again = fakeEgov();
	const result = await syncReadable(db, again.fetchJson, noWait);
	expect(result.failed).toEqual([]);
	expect(again.bodies()).toEqual([]);

	const minpoBefore = all(sqlite, 'SELECT * FROM readable_articles WHERE law_id = ? ORDER BY id', MINPO);
	const changed = fakeEgov((list) => {
		for (const law of list.laws) if (law.law_info.law_id === SHOHIN) law.revision_info.updated = '2026-11-01T00:00:00+09:00';
		return list;
	});
	await syncReadable(db, changed.fetchJson, noWait);
	expect(changed.bodies()).toEqual([expect.stringContaining('337AC0000000134_20260521_504AC0000000048')]);
	expect(all(sqlite, 'SELECT synced_updated, article_count FROM readable_laws WHERE id = ?', SHOHIN)).toEqual([
		{ synced_updated: '2026-11-01T00:00:00+09:00', article_count: 52 }
	]);
	expect(all(sqlite, 'SELECT * FROM readable_articles WHERE law_id = ? ORDER BY id', MINPO)).toEqual(minpoBefore);

	// 読み直しても条は重ならず、索引に古い行が残らない
	expect(all(sqlite, 'SELECT count(*) AS n FROM readable_articles WHERE law_id = ?', SHOHIN)).toEqual([{ n: 52 }]);
	const indexed = all(sqlite, `SELECT rowid FROM readable_search WHERE readable_search MATCH ?`, '"景品類"');
	const joined = all(sqlite, `SELECT a.id FROM readable_search s JOIN readable_articles a ON a.id = s.rowid WHERE readable_search MATCH ?`, '"景品類"');
	expect(indexed.length).toBeGreaterThan(0);
	expect(indexed).toHaveLength(joined.length);
}, 60_000);
