// Issue #45 基準1・2：委員会と法案の下書きの表（設計書 docs/spec/45.md）。
// マイグレーションと取り込みを node:sqlite に流して確かめる
import { beforeAll, describe, expect, test } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { openMemoryDb } from './memory';
import { seedStatements, TARGET_LAWS } from './seed';
import { currentRevision, provisionsAt, type Db } from '../server/law';
import { billById, candidateSolutions, citedCandidates, createDraft, saveDraft, type DraftInput } from '../server/bills';

const root = new URL('../../../', import.meta.url);
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`tests/fixtures/egov/${name}.json`, root), 'utf8'));
const LAW = '412AC0000000061';
const T0 = Date.UTC(2030, 4, 3, 0, 0);

let sqlite: DatabaseSync;
let db: Db;
const all = (sql: string, ...p: (string | number)[]) => sqlite.prepare(sql).all(...p) as Record<string, unknown>[];
const run = (sql: string, ...p: (string | number | null)[]) => sqlite.prepare(sql).run(...p);

beforeAll(() => {
	({ sqlite, db } = openMemoryDb());
	for (const sql of seedStatements(TARGET_LAWS, fixture)) sqlite.exec(sql);
	for (const id of ['u1', 'u2']) {
		run('INSERT INTO user (id, name, email, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', id, id, `${id}@test.invalid`, T0, T0);
	}
	run(
		"INSERT INTO issues (id, user_id, title, affected, example, topic_id, created_at) VALUES (1, 'u1', '課題', '人', '例', 1, ?)",
		T0
	);
	for (const id of [1, 2, 3]) run("INSERT INTO solutions (id, issue_id, user_id, body, created_at) VALUES (?, 1, 'u2', ?, ?)", id, `解決策${id}`, T0);
}, 120_000);

describe('基準1：マイグレーション 0009', () => {
	test('委員会1と対象3法、法案の表の CHECK、actions の種類、既存のトリガーと全文検索の表', () => {
		expect(all('SELECT id, name FROM committees')).toEqual([{ id: 1, name: '消費者保護' }]);
		expect(all('SELECT law_id FROM committee_laws WHERE committee_id = 1 ORDER BY law_id').map((r) => r.law_id)).toEqual(
			[...TARGET_LAWS].sort()
		);
		// 1本だけ取り込むと、その1本だけが入る（入っていない法令の外部キーで止まらない）
		const one = openMemoryDb();
		for (const sql of seedStatements([LAW], fixture)) one.sqlite.exec(sql);
		expect(one.sqlite.prepare('SELECT law_id FROM committee_laws').all()).toEqual([{ law_id: LAW }]);

		const rev = all('SELECT id FROM law_revisions WHERE law_id = ? ORDER BY seq DESC LIMIT 1', LAW)[0].id as string;
		run(
			"INSERT INTO bills (id, user_id, committee_id, kind, title, affected, side_effects, created_at, updated_at) VALUES (900, 'u1', 1, 'amend', 't', 'a', 's', 0, 0)"
		);
		const law = (action: string, lawId: string | null, base: string | null, title: string | null, seq = 0) =>
			run('INSERT INTO bill_laws (bill_id, rev, seq, action, law_id, base_revision_id, new_title) VALUES (900, 1, ?, ?, ?, ?, ?)', seq, action, lawId, base, title);
		// 制定の新法は law_id・base_revision_id が NULL で new_title がある。改正・廃止はその逆
		expect(() => law('enact', LAW, null, '新法')).toThrow(/CHECK/);
		expect(() => law('enact', null, null, null)).toThrow(/CHECK/);
		expect(() => law('amend', LAW, null, null)).toThrow(/CHECK/);
		expect(() => law('amend', LAW, rev, '名前')).toThrow(/CHECK/);
		expect(() => law('amend', LAW, rev, null, 5)).toThrow(/CHECK/);
		expect(() => law('bogus', LAW, rev, null)).toThrow(/CHECK/);
		law('amend', LAW, rev, null);
		const change = (op: string, num: string, provision: number | null, body: string | null) =>
			run('INSERT INTO bill_changes (bill_id, rev, law_seq, num, op, provision_id, caption, body) VALUES (900, 1, 0, ?, ?, ?, NULL, ?)', num, op, provision, body);
		const provision = all("SELECT id FROM provisions WHERE law_id = ? AND kind = 'article' LIMIT 1", LAW)[0].id as number;
		// add だけが provision_id を持たず、delete だけが body を持たない
		expect(() => change('add', '3_2', provision, '[]')).toThrow(/CHECK/);
		expect(() => change('amend', '1', null, '[]')).toThrow(/CHECK/);
		expect(() => change('delete', '1', provision, '[]')).toThrow(/CHECK/);
		expect(() => change('amend', '1', provision, null)).toThrow(/CHECK/);
		change('add', '3_2', null, '[]');
		change('delete', '1', provision, null);
		expect(() => run('INSERT INTO bill_solutions (bill_id, rev, seq, solution_id) VALUES (900, 1, 5, 1)')).toThrow(/CHECK/);

		// actions に v0.3 の種類
		for (const kind of ['bill_draft', 'bill_save', 'bill_support_add', 'bill_support_remove', 'bill_propose']) {
			run("INSERT INTO actions (kind, user_id, ip_hash, target_id, created_at) VALUES (?, 'u1', 'ip', 1, 0)", kind);
		}
		expect(() => run("INSERT INTO actions (kind, user_id, ip_hash, target_id, created_at) VALUES ('bogus', 'u1', 'ip', 1, 0)")).toThrow(/CHECK/);

		// 既存のトリガーと全文検索の表、作り直した actions の索引が残っている
		const names = (type: string) => all('SELECT name FROM sqlite_master WHERE type = ?', type).map((r) => r.name);
		expect(names('trigger')).toEqual(expect.arrayContaining(['issues_status_log', 'solutions_status_log']));
		expect(names('table')).toEqual(expect.arrayContaining(['search_trigram', 'search_bigram']));
		expect(names('index')).toEqual(expect.arrayContaining(['actions_user', 'actions_ip', 'actions_target']));
	});
});

describe('基準2：版ごとの保存', () => {
	async function input(title: string, text: string, solutionIds: number[]): Promise<DraftInput> {
		const base = (await currentRevision(db, LAW))!;
		const article1 = (await provisionsAt(db, base.id)).find((r) => r.kind === 'article' && r.num === '1')!;
		return {
			kind: 'amend',
			committeeId: 1,
			title,
			affected: '困っている人',
			sideEffects: '副作用',
			summary: null,
			supplementary: null,
			laws: [
				{
					action: 'amend',
					lawId: LAW,
					baseRevisionId: base.id,
					baseIfSeq: 0,
					newTitle: null,
					changes: [{ op: 'amend', num: '1', provisionId: article1.id, caption: '（目的）', paragraphs: [{ num: '1', text, items: [] }] }]
				}
			],
			solutionIds
		};
	}

	test('作って読める。保存は開いたときの rev・提出者・下書きのときだけ。作りかけは読めず保存もできない。同時の保存は混ざらない', async () => {
		const id = await createDraft(db, 'u1', await input('最初', '本文その1', [1]), T0);
		const first = (await billById(db, id))!;
		expect(first.rev).toBe(1);
		expect(first.title).toBe('最初');
		expect(first.userId).toBe('u1');
		expect(first.status).toBe('draft');
		expect(first.laws[0].changes[0].paragraphs).toEqual([{ num: '1', text: '本文その1', items: [] }]);
		expect(first.solutionIds).toEqual([1]);

		// 開いたときの rev が古い・ほかの人・rev = 0 は保存しない
		expect(await saveDraft(db, id, 'u1', 1, await input('2回目', '本文その2', [1, 2]), T0 + 1)).toBe(true);
		expect(await saveDraft(db, id, 'u1', 1, await input('古い', '古い本文', [3]), T0 + 2)).toBe(false);
		expect(await saveDraft(db, id, 'u2', 2, await input('ほかの人', '他人の本文', [3]), T0 + 2)).toBe(false);
		expect(await saveDraft(db, id, 'u1', 0, await input('作りかけ', 'x', [3]), T0 + 2)).toBe(false);
		// 種類（kind）は作ったあとは変えないので、違う種類の中身は保存しない
		expect(await saveDraft(db, id, 'u1', 2, { ...(await input('種類違い', 'x', [3])), kind: 'enact' }, T0 + 2)).toBe(false);
		const second = (await billById(db, id))!;
		expect([second.rev, second.title, second.solutionIds, second.updatedAt]).toEqual([2, '2回目', [1, 2], T0 + 1]);
		expect(second.laws[0].changes[0].paragraphs![0].text).toBe('本文その2');

		// 発議した法案は保存しない
		run("UPDATE bills SET status = 'proposed' WHERE id = ?", id);
		expect(await saveDraft(db, id, 'u1', 2, await input('発議のあと', 'x', [3]), T0 + 3)).toBe(false);
		run("UPDATE bills SET status = 'draft' WHERE id = ?", id);

		// 作りかけ（rev = 0）は読めず、保存もできない
		run(
			"INSERT INTO bills (id, user_id, committee_id, kind, title, affected, side_effects, created_at, updated_at) VALUES (5000, 'u1', 1, 'amend', 't', 'a', 's', 0, 0)"
		);
		expect(await billById(db, 5000)).toBeUndefined();
		expect(await saveDraft(db, 5000, 'u1', 0, await input('乗っ取り', 'x', [1]), T0)).toBe(false);
		expect(await billById(db, 9999)).toBeUndefined();

		// 同じ rev から同時に保存すると、片方だけが通り、中身は通った方のものだけになる。
		// 値は先に作っておき、2つの保存が DB への問い合わせのたびに交互に進むようにする
		const [inputA, inputB] = [await input('タブA', 'Aの本文', [1]), await input('タブB', 'Bの本文', [2, 3])];
		const revsBefore = all('SELECT DISTINCT rev FROM bill_laws WHERE bill_id = ?', id).length;
		const [a, b] = await Promise.all([saveDraft(db, id, 'u1', 2, inputA, T0 + 4), saveDraft(db, id, 'u1', 2, inputB, T0 + 4)]);
		expect([a, b].filter(Boolean)).toHaveLength(1);
		// 2つとも子の行を書いた（別々の版の番号で）。負けた方の行は残るが読まれない
		expect(all('SELECT DISTINCT rev FROM bill_laws WHERE bill_id = ?', id).length).toBe(revsBefore + 2);
		const third = (await billById(db, id))!;
		const winner = a ? { title: 'タブA', text: 'Aの本文', solutions: [1] } : { title: 'タブB', text: 'Bの本文', solutions: [2, 3] };
		expect({ title: third.title, text: third.laws[0].changes[0].paragraphs![0].text, solutions: third.solutionIds }).toEqual(winner);
	});
});

// Issue #46 のレビューの Blocker：候補を30件で切ると、31件目以降を引用した法案を直すときに引用が黙って消えていた
test('引用の候補は、課題の表示中の解決策をすべて返す', async () => {
	run("INSERT INTO issues (id, user_id, title, affected, example, topic_id, created_at) VALUES (46, 'u1', '候補の課題', '人', '例', 1, ?)", T0);
	const ids = Array.from({ length: 31 }, (_, i) => 4600 + i);
	for (const id of ids) run("INSERT INTO solutions (id, issue_id, user_id, body, created_at) VALUES (?, 46, 'u2', ?, ?)", id, `候補${id}`, T0);
	expect((await candidateSolutions(db, 46)).map((c) => c.id)).toEqual(ids);
	expect((await citedCandidates(db, [ids[30]])).map((c) => c.id)).toEqual(ids);
});
