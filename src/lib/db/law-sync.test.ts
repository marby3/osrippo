// Issue #74 基準2・3と信頼の境界：現実の改正の同期（設計書 docs/spec/74.md）。e-Gov は呼ばず、テストデータで過去の一覧を再現する
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { provisionsAt } from '../server/law';
import { syncAll, syncLaw } from '../server/law-sync';
import { runSessionEnd } from '../server/results';
import { ifAddedArticles, provisions } from './schema';
import { openMemoryDb, type MemoryDb } from './memory';
import { seedStatements } from './seed';
import type { FetchJson } from '../egov/client';

const SHOHIN = '337AC0000000134';
const TOKUSHO = '351AC0000000057';
const SHOHISHA = '412AC0000000061';
const START = '2018-01-01';
const FINAL = '2026-11-01';

type Raw = Record<string, unknown> & { law_revision_id: string; amendment_enforcement_date: string; amendment_promulgate_date: string | null; current_revision_status: string };
type Row = Record<string, string | number | null>;

const cache = new Map<string, unknown>();
function fixture(name: string) {
	if (!cache.has(name)) cache.set(name, JSON.parse(readFileSync(new URL(`../../../tests/fixtures/egov/${name}.json`, import.meta.url), 'utf8')));
	return cache.get(name) as { law_info: unknown; revisions: Raw[]; law_full_text: unknown };
}

/** その日の一覧を再現する。新しい順はそのまま */
function listAsOf(lawId: string, date: string): Raw[] {
	const rows = fixture(`law_revisions_${lawId}`).revisions.filter((r) => [r.amendment_promulgate_date ?? r.amendment_enforcement_date, r.amendment_enforcement_date].some((d) => d <= date));
	const current = rows.findIndex((r) => r.amendment_enforcement_date <= date);
	return rows.map((r, i) => ({ ...r, current_revision_status: r.amendment_enforcement_date > date ? 'UnEnforced' : i === current ? 'CurrentEnforced' : 'PreviousEnforced' }));
}

/** 一覧を返す e-Gov の代わり。本文はテストデータ。呼ばれた URL を残す */
function fakeEgov(list: (lawId: string) => unknown) {
	const calls: string[] = [];
	const fetchJson: FetchJson = async (url) => {
		calls.push(url);
		const revisions = /\/law_revisions\/([^/]+)$/.exec(url);
		if (revisions) return { law_info: fixture(`law_revisions_${revisions[1]}`).law_info, revisions: list(revisions[1]) };
		const data = /\/law_data\/([^/]+)$/.exec(url);
		if (data) return fixture(`law_data_${data[1]}`);
		throw new Error(`知らない URL ${url}`);
	};
	return { fetchJson, calls };
}

/** その一覧で DB を作る（db:reset と同じ取り込み） */
function seeded(lawIds: string[], date: string, adjust: (rows: Raw[]) => Raw[] = (rows) => rows) {
	const { sqlite, db } = openMemoryDb();
	const load = (name: string) => {
		const id = /^law_revisions_(.+)$/.exec(name)?.[1];
		return id ? { law_info: fixture(name).law_info, revisions: adjust(listAsOf(id, date)) } : fixture(name);
	};
	for (const statement of seedStatements(lawIds, load)) sqlite.exec(statement);
	return { sqlite, db: db as MemoryDb };
}

const all = (sqlite: DatabaseSync, sql: string, ...params: string[]) => sqlite.prepare(sql).all(...params) as Row[];

/** DB の中身そのまま（内部IDの値も含む）。変わっていないことを確かめる */
const snapshot = (sqlite: DatabaseSync) => ({
	laws: all(sqlite, 'SELECT * FROM laws ORDER BY id'),
	revisions: all(sqlite, 'SELECT * FROM law_revisions ORDER BY law_id, seq'),
	provisions: all(sqlite, 'SELECT * FROM provisions ORDER BY id'),
	versions: all(sqlite, 'SELECT * FROM provision_versions ORDER BY id'),
	trigram: all(sqlite, 'SELECT kind, ref_id, text FROM search_trigram ORDER BY ref_id'),
	bigram: all(sqlite, 'SELECT kind, ref_id, text FROM search_bigram ORDER BY ref_id')
});

/** 内部IDと行の番号の値を除いた中身。内部IDは最初の版の番号と木の位置に置き換える。行のない内部IDや消えた行を指す検索の行があれば、一度に作った場合と違いが出る（この DB は1つの法令だけ） */
function canonical(sqlite: DatabaseSync, lawId: string) {
	const rows = all(
		sqlite,
		`SELECT v.id AS vid, v.provision_id AS pid, p.kind, p.parent_id AS parent, v.from_revision_id AS "from", v.to_revision_id AS "to", v.num, v.caption, v.text, v.change, v.similarity, v.unconfirmed_of AS unconfirmed, f.seq
		 FROM provision_versions v JOIN provisions p ON p.id = v.provision_id JOIN law_revisions f ON f.id = v.from_revision_id
		 WHERE p.law_id = ? ORDER BY f.seq, v.id`,
		lawId
	);
	const first = new Map<number, Row>();
	for (const r of rows) if (!first.has(r.pid as number)) first.set(r.pid as number, r);
	const keyOf = (id: number | null): string | null => {
		if (id === null) return null;
		const r = first.get(id)!;
		return `${keyOf(r.parent as number | null) ?? ''}/${r.kind}:${r.from}:${r.num}`;
	};
	const vidKey = new Map(rows.map((r) => [r.vid as number, `${keyOf(r.pid as number)}@${r.from}`]));
	const search = (table: string) => all(sqlite, `SELECT ref_id, text FROM ${table} WHERE kind = 'provision'`).map((s) => `${vidKey.get(s.ref_id as number)}=${s.text}`).sort();
	return {
		law: all(sqlite, 'SELECT * FROM laws WHERE id = ?', lawId),
		revisions: all(sqlite, 'SELECT * FROM law_revisions WHERE law_id = ? ORDER BY seq', lawId),
		rows: rows.map((r) => ({ key: keyOf(r.pid as number), from: r.from, to: r.to, num: r.num, caption: r.caption, text: r.text, change: r.change, similarity: r.similarity, unconfirmed: keyOf(r.unconfirmed as number | null) })).sort((a, b) => `${a.key}@${a.from}`.localeCompare(`${b.key}@${b.from}`)),
		provisions: all(sqlite, 'SELECT id, kind FROM provisions WHERE law_id = ?', lawId).map((p) => `${keyOf(p.id as number)}`).sort(),
		trigram: search('search_trigram'),
		bigram: search('search_bigram')
	};
}

const revisionIds = (sqlite: DatabaseSync, lawId: string) => all(sqlite, 'SELECT id FROM law_revisions WHERE law_id = ? ORDER BY seq', lawId).map((r) => r.id);

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

beforeEach(() => {
	// 同期の失敗はログに出る。テストの出力を埋めない
	vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

test.each([SHOHIN, TOKUSHO, SHOHISHA])(
	'基準2：%s を過去の一覧から順に同期すると、一度に作った場合と同じになり、固定の版までの内部IDは変わらない',
	async (lawId) => {
		const { sqlite, db } = seeded([lawId], START);
		const rows = fixture(`law_revisions_${lawId}`).revisions;
		const events = [...new Set(rows.flatMap((r) => [r.amendment_promulgate_date, r.amendment_enforcement_date]))]
			.filter((d): d is string => d !== null && d > START && d <= FINAL)
			.sort();
		const [branch] = all(sqlite, `SELECT id FROM law_revisions WHERE law_id = ? AND status = 'enforced' ORDER BY seq DESC LIMIT 1`, lawId);
		const byId = (rows: Awaited<ReturnType<typeof provisionsAt>>) => [...rows].sort((a, b) => a.id - b.id);
		const pinned = byId(await provisionsAt(db, branch.id as string));

		let skipped = 0;
		for (const date of [...events, FINAL]) {
			const result = await syncLaw(db, lawId, fakeEgov(() => listAsOf(lawId, date)).fetchJson);
			skipped += result.skipped.length;
		}
		expect(skipped, '起点の日より前に施行された版はその日までに公布されているので、飛ばす版は出ない').toBe(0);
		expect(all(sqlite, 'SELECT revision_id FROM if_branches WHERE law_id = ?', lawId)[0].revision_id, '分岐は同期の前の版で固定される').toBe(branch.id);

		const once = seeded([lawId], FINAL);
		expect(canonical(sqlite, lawId)).toEqual(canonical(once.sqlite, lawId));
		expect(byId(await provisionsAt(db, branch.id as string))).toEqual(pinned);

		// 何度走っても同じで、本文を読み直さない
		const before = snapshot(sqlite);
		const again = fakeEgov(() => listAsOf(lawId, FINAL));
		expect(await syncLaw(db, lawId, again.fetchJson)).toMatchObject({ changed: false, skipped: [] });
		expect(snapshot(sqlite)).toEqual(before);
		expect(again.calls.filter((u) => u.includes('/law_data/'))).toEqual([]);
	},
	180_000
);

test('基準2：公布と施行の順が逆の改正は、先に公布された施行予定の版の前に入る', async () => {
	const { sqlite, db } = seeded([SHOHIN], '2023-05-16');
	const LATER = '337AC0000000134_20250601_504AC0000000068';
	const EARLIER = '337AC0000000134_20241001_505AC0000000029';
	expect(revisionIds(sqlite, SHOHIN)).toContain(LATER);
	expect(revisionIds(sqlite, SHOHIN)).not.toContain(EARLIER);
	await syncLaw(db, SHOHIN, fakeEgov(() => listAsOf(SHOHIN, '2023-05-17')).fetchJson);
	const ids = revisionIds(sqlite, SHOHIN);
	expect(ids.indexOf(EARLIER)).toBeGreaterThan(-1);
	expect(ids.indexOf(EARLIER)).toBeLessThan(ids.indexOf(LATER));
}, 60_000);

test('基準2：一覧から消えた版は消え、遅れて来た版は飛ばして続き、固定の版がおかしいと止まる', async () => {
	// 末尾の版が一覧から消える（IF世界で足した条は残る）
	const SCHEDULED = '412AC0000000061_20281223_508AC0000000046';
	const gone = seeded([SHOHISHA], FINAL);
	await syncLaw(gone.db, SHOHISHA, fakeEgov(() => listAsOf(SHOHISHA, FINAL)).fetchJson);
	const [added] = await gone.db.insert(provisions).values({ lawId: SHOHISHA, kind: 'article' }).returning({ id: provisions.id });
	await gone.db.insert(ifAddedArticles).values({ lawId: SHOHISHA, num: '99', provisionId: added.id, createdAt: 1 });
	const onlyInScheduled = all(gone.sqlite, `SELECT provision_id AS id FROM provision_versions WHERE from_revision_id = ? AND provision_id NOT IN (SELECT provision_id FROM provision_versions WHERE from_revision_id <> ?)`, SCHEDULED, SCHEDULED);
	await syncLaw(gone.db, SHOHISHA, fakeEgov(() => listAsOf(SHOHISHA, FINAL).filter((r) => r.law_revision_id !== SCHEDULED)).fetchJson);
	expect(revisionIds(gone.sqlite, SHOHISHA)).not.toContain(SCHEDULED);
	expect(all(gone.sqlite, 'SELECT id FROM provision_versions WHERE from_revision_id = ? OR to_revision_id = ?', SCHEDULED, SCHEDULED)).toEqual([]);
	for (const { id } of onlyInScheduled) expect(all(gone.sqlite, 'SELECT id FROM provisions WHERE id = ?', String(id))).toEqual([]);
	expect(all(gone.sqlite, 'SELECT id FROM provisions WHERE id = ?', String(added.id))).toHaveLength(1);

	// 固定の版より前に遅れて来た版は飛ばして、後ろの版は入る
	const LATE = '337AC0000000134_20241001_505AC0000000029';
	const late = seeded([SHOHIN], '2025-06-30', (rows) => rows.filter((r) => r.law_revision_id !== LATE));
	await syncLaw(late.db, SHOHIN, fakeEgov(() => listAsOf(SHOHIN, '2025-06-30').filter((r) => r.law_revision_id !== LATE)).fetchJson);
	const result = await syncLaw(late.db, SHOHIN, fakeEgov(() => listAsOf(SHOHIN, FINAL)).fetchJson);
	expect(result).toMatchObject({ changed: true, skipped: [LATE] });
	const ids = revisionIds(late.sqlite, SHOHIN);
	expect(ids).not.toContain(LATE);
	expect(ids.at(-1)).toBe('337AC0000000134_20260521_504AC0000000048');

	// 固定の版が一覧から消える、施行予定に戻る
	const pinned = seeded([SHOHISHA], FINAL);
	await syncLaw(pinned.db, SHOHISHA, fakeEgov(() => listAsOf(SHOHISHA, FINAL)).fetchJson);
	const PIN = '412AC0000000061_20260624_508AC0000000046';
	const before = snapshot(pinned.sqlite);
	await expect(syncLaw(pinned.db, SHOHISHA, fakeEgov(() => listAsOf(SHOHISHA, FINAL).filter((r) => r.law_revision_id !== PIN)).fetchJson)).rejects.toThrow();
	await expect(syncLaw(pinned.db, SHOHISHA, fakeEgov(() => listAsOf(SHOHISHA, FINAL).map((r) => (r.law_revision_id === PIN ? { ...r, current_revision_status: 'UnEnforced' } : r))).fetchJson)).rejects.toThrow();
	expect(snapshot(pinned.sqlite)).toEqual(before);
}, 120_000);

test('基準2：本文を読めないとき、入れ替えの途中で失敗したときは何も変わらず、次に続く', async () => {
	const { sqlite, db } = seeded([SHOHIN], '2023-05-16');
	await syncLaw(db, SHOHIN, fakeEgov(() => listAsOf(SHOHIN, '2023-05-16')).fetchJson);
	const before = snapshot(sqlite);
	const next = () => listAsOf(SHOHIN, '2023-05-17');

	const broken = fakeEgov(next);
	const failing: FetchJson = async (url) => {
		if (url.includes('/law_data/')) throw new Error('読めない');
		return broken.fetchJson(url);
	};
	await expect(syncLaw(db, SHOHIN, failing)).rejects.toThrow();
	expect(snapshot(sqlite)).toEqual(before);

	sqlite.exec(`CREATE TRIGGER fail_sync BEFORE INSERT ON provision_versions BEGIN SELECT RAISE(ABORT, '途中で失敗'); END`);
	await expect(syncLaw(db, SHOHIN, fakeEgov(next).fetchJson)).rejects.toThrow();
	expect(snapshot(sqlite)).toEqual(before);

	sqlite.exec('DROP TRIGGER fail_sync');
	expect(await syncLaw(db, SHOHIN, fakeEgov(next).fetchJson)).toMatchObject({ changed: true });
	expect(revisionIds(sqlite, SHOHIN)).toContain('337AC0000000134_20241001_505AC0000000029');
}, 60_000);

test('基準3：1つの法令の失敗で残りを止めず、失敗を返す。Cron は e-Gov を呼ばない', async () => {
	const { sqlite, db } = seeded([SHOHIN, SHOHISHA], '2023-05-16');
	const egov = fakeEgov((lawId) => listAsOf(lawId, '2026-07-01'));
	const failing: FetchJson = async (url) => {
		if (url.includes(`/law_revisions/${SHOHIN}`)) throw new Error('つながらない');
		return egov.fetchJson(url);
	};
	const result = await syncAll(db, failing);
	expect(result.failed).toEqual([SHOHIN]);
	expect(revisionIds(sqlite, SHOHISHA)).toContain('412AC0000000061_20260624_508AC0000000046');

	const ok = await syncAll(db, egov.fetchJson);
	expect(ok.failed).toEqual([]);
	expect(revisionIds(sqlite, SHOHIN)).toContain('337AC0000000134_20260521_504AC0000000048');

	const network = vi.fn();
	vi.stubGlobal('fetch', network);
	await runSessionEnd(db, Date.parse('2026-12-01T00:10:00+09:00'));
	expect(network).not.toHaveBeenCalled();
}, 60_000);

test('信頼の境界：e-Gov の応答の形が違えば、その法令の同期を止めて DB を変えない', async () => {
	const { sqlite, db } = seeded([SHOHIN], '2023-05-16');
	await syncLaw(db, SHOHIN, fakeEgov(() => listAsOf(SHOHIN, '2023-05-16')).fetchJson);
	const before = snapshot(sqlite);
	const NEW = '337AC0000000134_20241001_505AC0000000029';
	const PIN = all(sqlite, 'SELECT revision_id FROM if_branches WHERE law_id = ?', SHOHIN)[0].revision_id;
	const next = () => listAsOf(SHOHIN, '2023-05-17');
	const edit = (id: unknown, change: Record<string, unknown>) => () => next().map((r) => (r.law_revision_id === id ? { ...r, ...change } : r));
	const lists: [string, () => unknown][] = [
		['配列でない', () => 'oops'],
		['行に番号がない', () => [{}, ...next()]],
		['行が物でない', () => [null, ...next()]],
		['知らない状態', edit(NEW, { current_revision_status: 'Repeal' })],
		['オブジェクトの持つ名前の状態', edit(NEW, { current_revision_status: 'constructor' })],
		['固定の版の知らない状態', edit(PIN, { current_revision_status: 'Unknown' })],
		['廃止', edit(NEW, { repeal_status: 'Repeal' })],
		['固定の版の廃止', edit(PIN, { repeal_status: 'Expire' })],
		['施行日の形', edit(NEW, { amendment_enforcement_date: '2024年10月1日' })],
		['施行日がない', edit(NEW, { amendment_enforcement_date: null })],
		['題名がない', edit(NEW, { law_title: 1 })],
		['読みの形', edit(NEW, { law_title_kana: 1 })],
		['読みがない', edit(NEW, { law_title_kana: undefined })]
	];
	for (const [name, list] of lists) {
		await expect(syncLaw(db, SHOHIN, fakeEgov(list).fetchJson), name).rejects.toThrow();
		expect(snapshot(sqlite), name).toEqual(before);
	}

	const data = fixture(`law_data_${NEW}`) as unknown as Record<string, unknown>;
	const texts: [string, unknown][] = [
		['物でない', 'oops'],
		['別の版の本文', { ...data, revision_info: { law_revision_id: PIN } }],
		['版の番号がない', { ...data, revision_info: undefined }],
		['本文がない', { ...data, law_full_text: undefined }],
		['根が違う', { ...data, law_full_text: { tag: 'Other', children: [] } }],
		['条が0件', { ...data, law_full_text: { tag: 'Law', children: [] } }]
	];
	for (const [name, text] of texts) {
		const egov = fakeEgov(next);
		const fetchJson: FetchJson = async (url) => (url.endsWith(`/law_data/${NEW}`) ? text : egov.fetchJson(url));
		await expect(syncLaw(db, SHOHIN, fetchJson), name).rejects.toThrow();
		expect(snapshot(sqlite), name).toEqual(before);
	}

	// 固定の版より前の古い版の値では止めない
	const old = fakeEgov(() => next().map((r, i, rows) => (i === rows.length - 1 ? { ...r, current_revision_status: 'Unknown', amendment_enforcement_date: null } : r)));
	expect(await syncLaw(db, SHOHIN, old.fetchJson)).toMatchObject({ changed: true });
}, 120_000);
