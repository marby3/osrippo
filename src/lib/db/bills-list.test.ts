// Issue #48 基準4〜6：法案の一覧（発議の画面がまだなく、51件作るのも重いので DB で確かめる）
import { beforeAll, describe, expect, test } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { openMemoryDb } from './memory';
import type { Db } from '../server/law';
import { billTabCounts, listBills } from '../server/bills';
import { billListHref, billProgress, lapsedBefore } from '../domain/bills';
import { sessionAt } from '../domain/session';

let sqlite: DatabaseSync;
let db: Db;
let nextId = 1;
const add = (status: string, rev: number, createdAt: number, updatedAt = createdAt, proposedAt: number | null = status === 'proposed' ? createdAt : null) => {
	const id = nextId++;
	sqlite
		.prepare(
			"INSERT INTO bills (id, user_id, committee_id, kind, status, rev, next_rev, title, affected, side_effects, created_at, updated_at, proposed_at) VALUES (?, 'u1', 1, 'amend', ?, ?, ?, ?, 'a', 's', ?, ?, ?)"
		)
		.run(id, status, rev, rev + 1, `法案${id}`, createdAt, updatedAt, proposedAt);
	return id;
};
const clear = () => sqlite.exec('DELETE FROM bills');
/** どの法案もまだ廃案にならない切れ目 */
const NONE_LAPSED = 0;

beforeAll(() => {
	({ sqlite, db } = openMemoryDb());
	sqlite.prepare("INSERT INTO user (id, name, email, created_at, updated_at) VALUES ('u1', 'u1', 'u1@test.invalid', 0, 0)").run();
});

describe('法案の一覧', () => {
	test('基準4：発議した法案は審議中に作ったのが新しい順で出て、数に入る。下書きは審議中と終わったに出ない', async () => {
		clear();
		const older = add('proposed', 1, 100, 900);
		const newer = add('proposed', 1, 200, 200);
		const draft = add('draft', 1, 300);
		expect((await listBills(db, 'shingi', 1, NONE_LAPSED)).rows.map((r) => r.id)).toEqual([newer, older]);
		expect((await listBills(db, 'shitagaki', 1, NONE_LAPSED)).rows.map((r) => r.id)).toEqual([draft]);
		expect((await listBills(db, 'owari', 1, NONE_LAPSED)).rows).toEqual([]);
		expect(await billTabCounts(db, NONE_LAPSED)).toEqual({ shingi: 2, shitagaki: 1 });
	});

	test('Issue #50 基準4：審議中は廃案になっていない発議の法案で、数もそれだけ。終わったは廃案の法案で発議が新しい順。切れ目は法案ごとの進みと同じ', async () => {
		clear();
		const jst = (t: string) => Date.parse(`${t}+09:00`);
		const now = jst('2030-07-10T09:00:00');
		const previous = sessionAt(sessionAt(now, null).startsAt - 1, null);
		const before = lapsedBefore(previous);
		expect(before).toBe(jst('2030-06-15T00:00:00'));
		// 作ったのが古くても、発議が新しければ上に来る
		const lastMinute = add('proposed', 1, jst('2030-01-01T00:00:00'), 0, before - 1);
		const older = add('proposed', 1, jst('2030-05-20T00:00:00'));
		const live = add('proposed', 1, jst('2030-05-01T00:00:00'), 0, before);
		add('draft', 1, jst('2030-07-01T00:00:00'));

		const owari = await listBills(db, 'owari', 1, before);
		const shingi = await listBills(db, 'shingi', 1, before);
		expect(owari.rows.map((r) => r.id)).toEqual([lastMinute, older]);
		expect(shingi.rows.map((r) => r.id)).toEqual([live]);
		expect(await billTabCounts(db, before)).toEqual({ shingi: 1, shitagaki: 1 });
		for (const r of owari.rows) expect(billProgress(r, now, null)).toBe('lapsed');
		for (const r of shingi.rows) expect(billProgress(r, now, null)).not.toBe('lapsed');
	});

	test('基準5：50件ごとに分け、ページを移ってもタブは変わらない', async () => {
		clear();
		const ids = Array.from({ length: 51 }, (_, i) => add('draft', 1, 1000 + i));
		const first = await listBills(db, 'shitagaki', 1, NONE_LAPSED);
		expect(first.rows).toHaveLength(50);
		expect(first.hasNext).toBe(true);
		expect(first.rows[0].id).toBe(ids[50]);
		const second = await listBills(db, 'shitagaki', 2, NONE_LAPSED);
		expect(second.rows.map((r) => r.id)).toEqual([ids[0]]);
		expect(second.hasNext).toBe(false);

		expect(billListHref('shitagaki', 2)).toBe('/houan?tab=shitagaki&page=2');
		expect(billListHref('shitagaki', 1)).toBe('/houan?tab=shitagaki');
		expect(billListHref('shingi', 1)).toBe('/houan');
		expect(billListHref('shingi', 2)).toBe('/houan?page=2');
	});

	test('基準6：作りかけ（rev = 0）は一覧にも数にも入らない', async () => {
		clear();
		add('draft', 0, 100);
		add('proposed', 0, 100);
		const saved = add('draft', 1, 100);
		expect((await listBills(db, 'shitagaki', 1, NONE_LAPSED)).rows.map((r) => r.id)).toEqual([saved]);
		expect((await listBills(db, 'shingi', 1, NONE_LAPSED)).rows).toEqual([]);
		expect(await billTabCounts(db, NONE_LAPSED)).toEqual({ shingi: 0, shitagaki: 1 });
	});
});
