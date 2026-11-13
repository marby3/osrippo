// Issue #163 基準1・2 の DB の側：法律の一覧と検索（読める法律は db:reset と同じテストデータ。e-Gov は呼ばない）
import { readFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { beforeAll, expect, test } from 'vitest';
import { parseLawListQuery } from '../domain/law-list';
import { parseQuery } from '../domain/search';
import { listReadableLaws, playableLawGroups, searchLawArticles } from '../server/law-list';
import { openMemoryDb, type MemoryDb } from './memory';
import { seedStatements, TARGET_LAWS } from './seed';
import { readableSeedStatements } from './seed-readable';

const MINPO = '129AC0000000089';
const KENPO = '321CONSTITUTION';
const SHOHIN = '337AC0000000134';
const TOKUSHO = '351AC0000000057';
const SHOHISHA = '412AC0000000061';
const TODAY = '2026-11-13';
/** 審議中の境目（lapsedBefore の値）。これより後に発議した法案が審議中 */
const BEFORE = 1_800_000_000_000;

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../../../tests/fixtures/egov/${name}.json`, import.meta.url), 'utf8'));
const query = (s: string) => parseLawListQuery(new URLSearchParams(s))!;
const wordsOf = (s: string) => {
	const parsed = parseQuery(s);
	if (!parsed.ok) throw new Error(`言葉の形が違う：${s}`);
	return parsed.words;
};

let sqlite: DatabaseSync;
let db: MemoryDb;

/** 発議した法案。対象は lawId の、いまの版を基にした改正 */
function addBill(lawId: string, proposedAt: number) {
	const user = `u${proposedAt}`;
	sqlite.prepare('INSERT INTO user (id, name, email, created_at, updated_at) VALUES (?, ?, ?, 0, 0)').run(user, user, `${user}@test.invalid`);
	const billId = Number(
		sqlite
			.prepare("INSERT INTO bills (user_id, committee_id, kind, status, rev, next_rev, proposed_rev, title, affected, side_effects, created_at, updated_at, proposed_at) VALUES (?, 1, 'amend', 'proposed', 1, 2, 1, 't', 'a', 's', 0, 0, ?)")
			.run(user, proposedAt).lastInsertRowid
	);
	const [revision] = sqlite.prepare("SELECT id FROM law_revisions WHERE law_id = ? AND branch = 'real' ORDER BY seq DESC LIMIT 1").all(lawId) as { id: string }[];
	sqlite.prepare("INSERT INTO bill_laws (bill_id, rev, seq, action, law_id, base_revision_id) VALUES (?, 1, 0, 'amend', ?, ?)").run(billId, lawId, revision.id);
	return billId;
}

beforeAll(async () => {
	({ sqlite, db } = openMemoryDb());
	for (const statement of [...seedStatements(TARGET_LAWS, fixture), ...(await readableSeedStatements(TARGET_LAWS, fixture))]) sqlite.exec(statement);
	// 読める法律を60本足す（五十音で、消費者契約法と特定商取引に関する法律のあいだに入る）。T00 だけ改正日があり、15年変わっていない
	const insert = sqlite.prepare(
		"INSERT INTO readable_laws (id, title, title_kana, law_num, law_type, category, promulgation_date, last_amended, revision_id, updated, article_count, synced_updated) VALUES (?, ?, ?, '令和元年法律第一号', 'Act', '民事', '2019-05-01', ?, 'r', 'u', 0, 'u')"
	);
	for (let i = 0; i < 60; i++) {
		const n = String(i).padStart(2, '0');
		insert.run(`T${n}`, `テスト法${n}`, `てすとほう${n}`, i === 0 ? '2011-08-01' : null);
	}
	// IF世界で変更あり：景品表示法に可決した法案の版
	const passed = addBill(SHOHIN, BEFORE - 10_000);
	sqlite.prepare("INSERT INTO if_revisions (law_id, seq, bill_id, bill_rev, law_seq, session_key, created_at) VALUES (?, 1, ?, 1, 0, '2026-10', 0)").run(SHOHIN, passed);
	// 審議中の法案あり：消費者契約法に、境目のあとに発議した法案。特定商取引に関する法律の法案は境目より前（終わった）
	addBill(SHOHISHA, BEFORE + 1);
	addBill(TOKUSHO, BEFORE - 1);
});

test('基準1：いま遊べる法律が委員会の名前付きで出て、読める法律は50件ずつ。行は法令名（略称）・法令番号・最後の改正日・タグ', async () => {
	// いま遊べる法律：今月の委員会の対象法令と、委員会の名前
	const groups = await playableLawGroups(db, BEFORE, TODAY);
	expect(groups.map((g) => g.committee)).toEqual(['消費者保護']);
	expect(groups[0].laws.map((l) => l.id).sort()).toEqual([...TARGET_LAWS].sort());
	expect(groups[0].laws.find((l) => l.id === SHOHIN)).toMatchObject({
		title: '不当景品類及び不当表示防止法',
		abbrev: '景表法',
		lawNum: '昭和37年法律第134号',
		lastAmended: '2026-05-21',
		playable: true,
		ifChanged: true,
		deliberating: false,
		linked: true
	});
	expect(groups[0].laws.find((l) => l.id === SHOHISHA)).toMatchObject({ playable: true, ifChanged: false, deliberating: true });
	expect(groups[0].laws.find((l) => l.id === TOKUSHO)).toMatchObject({ abbrev: '特定商取引法', deliberating: false });

	// 読める法律：遊べる法律も含めて、五十音の順に50件ずつ
	const first = await listReadableLaws(db, query(''), [], BEFORE, TODAY);
	expect(first.rows).toHaveLength(50);
	expect(first.hasNext).toBe(true);
	const second = await listReadableLaws(db, query('page=2'), [], BEFORE, TODAY);
	expect(second.rows).toHaveLength(15);
	expect(second.hasNext).toBe(false);
	expect([...first.rows, ...second.rows].map((r) => r.id)).toEqual([
		SHOHISHA,
		...Array.from({ length: 60 }, (_, i) => `T${String(i).padStart(2, '0')}`),
		TOKUSHO,
		KENPO,
		SHOHIN,
		MINPO
	]);
	const row = (id: string) => [...first.rows, ...second.rows].find((r) => r.id === id);
	expect(row(SHOHISHA)).toMatchObject({ title: '消費者契約法', abbrev: null, lawNum: '平成12年法律第61号', lastAmended: '2026-06-24', playable: true, deliberating: true, linked: true });
	expect(row(MINPO)).toMatchObject({ title: '民法', lawNum: '明治29年法律第89号', lastAmended: '2020-04-01', unchangedYears: null, playable: false, ifChanged: false, deliberating: false, linked: true });
	// 制定から改正のない法律は、改正日なし
	expect(row(KENPO)).toMatchObject({ lawNum: '昭和21年憲法', lastAmended: null, unchangedYears: null, linked: true });
	// 長く変わっていない法律には年数のタグ。条のない法律はリンクにしない
	expect(row('T00')).toMatchObject({ lastAmended: '2011-08-01', unchangedYears: 15, playable: false, linked: false });
});

test('基準2：法令名・読み・略称・法令番号で探せる。条文は、読める法律は3文字以上、遊べる法律はいまの全文検索で探す', async () => {
	const ids = async (q: string) => (await listReadableLaws(db, query(`q=${encodeURIComponent(q)}`), wordsOf(q), BEFORE, TODAY)).rows.map((r) => r.id);
	// 法令名・読み（ひらがなとカタカナ）・略称・法令番号（漢数字と算用数字）
	expect(await ids('民法')).toEqual([MINPO]);
	expect(await ids('しょうひしゃ')).toEqual([SHOHISHA]);
	expect(await ids('ショウヒシャ')).toEqual([SHOHISHA]);
	expect(await ids('景品表示法')).toEqual([SHOHIN]);
	expect(await ids('明治二十九年法律第八十九号')).toEqual([MINPO]);
	expect(await ids('明治29年法律第89号')).toEqual([MINPO]);
	// 言葉が2つなら両方に当てはまるもの
	expect(await ids('昭和37年 第134号')).toEqual([SHOHIN]);
	expect(await ids('昭和37年 民法')).toEqual([]);

	const hits = (q: string) => searchLawArticles(db, wordsOf(q));
	// 読める法律の条文（3文字以上）
	const fukushi = await hits('公共の福祉');
	expect(fukushi.rows).toContainEqual(expect.objectContaining({ lawId: MINPO, lawTitle: '民法', label: '第1条', href: `/hourei/${MINPO}#jo-1` }));
	expect(fukushi.rows.some((r) => r.lawId === KENPO)).toBe(true);
	expect(fukushi.readableShort).toBe(false);
	// 2文字の言葉は、読める法律の条文を引かない（法令名と遊べる3法の条文だけ）
	const shiken = await hits('私権');
	expect(shiken.rows.filter((r) => r.lawId === MINPO)).toEqual([]);
	expect(shiken.readableShort).toBe(true);
	// 遊べる法律の条文は2文字でも、いまの全文検索（bigram）で引ける。
	// メモリの DB は生の SQL の結果を列名のない配列で返すので、いまの全文検索の行の中身は画面のテスト（e2e/kensaku.spec.ts と e2e/hourei-ichiran.spec.ts）で見る
	const keiyaku = await hits('契約');
	expect(keiyaku.readableShort).toBe(true);
	expect(keiyaku.rows.length).toBeGreaterThan(0);

	// 遊べる法律の readable_articles の行が残っていても、読める法律の条文としては引かない
	sqlite.prepare("INSERT INTO readable_articles (id, law_id, seq, num, label, caption, paragraphs) VALUES (9999999, ?, 0, '1', '第1条', '', ?)").run(
		SHOHISHA,
		JSON.stringify([{ num: '1', text: 'のこったぎょうのほんぶん', items: [] }])
	);
	sqlite.prepare("INSERT INTO readable_search (rowid, text) VALUES (9999999, 'のこったぎょうのほんぶん')").run();
	expect((await hits('のこったぎょう')).rows).toEqual([]);
});
