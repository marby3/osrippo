// Issue #208 基準3：全体の検索（/kensaku）の読める法律で、出さない行とリンクにしない行（DB の側。画面の側は e2e/kensaku.spec.ts）
import { readFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { beforeAll, expect, test } from 'vitest';
import { parseQuery } from '../domain/search';
import { searchArticleSection, searchLawSection } from '../server/kensaku';
import { openMemoryDb, type MemoryDb } from './memory';
import { seedStatements, TARGET_LAWS } from './seed';
import { readableSeedStatements } from './seed-readable';

const MINPO = '129AC0000000089';
const SHOHISHA = '412AC0000000061';

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../../../tests/fixtures/egov/${name}.json`, import.meta.url), 'utf8'));
const wordsOf = (s: string) => {
	const parsed = parseQuery(s);
	if (!parsed.ok) throw new Error(`言葉の形が違う：${s}`);
	return parsed.words;
};

let sqlite: DatabaseSync;
let db: MemoryDb;

/** 読める法律の条の行と、その索引の行 */
function addArticle(id: number, lawId: string, text: string) {
	sqlite.prepare("INSERT INTO readable_articles (id, law_id, seq, num, label, caption, paragraphs) VALUES (?, ?, 0, '1', '第1条', '', ?)").run(
		id,
		lawId,
		JSON.stringify([{ num: '1', text, items: [] }])
	);
	sqlite.prepare('INSERT INTO readable_search (rowid, text) VALUES (?, ?)').run(id, text);
}

beforeAll(async () => {
	({ sqlite, db } = openMemoryDb());
	for (const statement of [...seedStatements(TARGET_LAWS, fixture), ...(await readableSeedStatements(TARGET_LAWS, fixture))]) sqlite.exec(statement);
	const insert = sqlite.prepare(
		"INSERT INTO readable_laws (id, title, title_kana, law_num, law_type, promulgation_date, revision_id, updated, article_count, synced_updated) VALUES (?, ?, ?, '令和元年法律第一号', 'Act', '2019-05-01', 'r', 'u', ?, ?)"
	);
	// 条のない読める法律と、まだ同期の済んでいない読める法律（本文を入れている途中で、条の行はある）
	insert.run('T01', 'テスト条なし法', 'てすとじょうなしほう', 0, 'u');
	insert.run('T02', 'テスト同期中法', 'てすとどうきちゅうほう', null, null);
	addArticle(9999998, 'T02', 'どうきちゅうのほんぶん');
	// 遊べる法律の readable_articles の行が残っている
	addArticle(9999999, SHOHISHA, 'のこったぎょうのほんぶん');
});

test('#208 基準3：遊べる法律の readable_articles の行は出さない。条のない法律とまだ同期の済んでいない法律はリンクにしない', async () => {
	// 法令名：条のない法律と同期の済んでいない法律は、出すがリンクにしない
	const names = await searchLawSection(db, wordsOf('テスト'), 20, 0);
	expect(names.total).toBe(2);
	expect(names.rows).toEqual([
		{ id: 'T01', title: 'テスト条なし法', href: null },
		{ id: 'T02', title: 'テスト同期中法', href: null }
	]);
	// 本文を入れ終えて条のある法律はリンクにする
	expect((await searchLawSection(db, wordsOf('民法'), 20, 0)).rows).toEqual([{ id: MINPO, title: '民法', href: `/hourei/${MINPO}` }]);

	// 条文：遊べる法律の残った行と、同期の済んでいない法律の条は出さない
	for (const q of ['のこったぎょう', 'どうきちゅう']) {
		const found = await searchArticleSection(db, wordsOf(q), 20, 0);
		expect(found.total, q).toBe(0);
		expect(found.rows, q).toEqual([]);
	}
	// 本文を入れ終えた読める法律の条は、条だけのページへのリンクで出る
	const fukushi = await searchArticleSection(db, wordsOf('公共の福祉'), 20, 0);
	expect(fukushi.rows).toContainEqual(expect.objectContaining({ lawTitle: '民法', position: '第1条', href: `/hourei/${MINPO}/1` }));
});
