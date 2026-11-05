// Issue #69 基準1・3 の DB の側：関連法案の決まりと、質疑を一緒に読む
import { readFileSync } from 'node:fs';
import { beforeAll, expect, test } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { openMemoryDb, type MemoryDb } from './memory';
import { seedStatements, TARGET_LAWS } from './seed';
import { sessionAt } from '../domain/session';
import { relatedBills } from '../server/bills';
import { listQuestions, questionTotal } from '../server/posts';

const root = new URL('../../../', import.meta.url);
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`tests/fixtures/egov/${name}.json`, root), 'utf8'));
const [LAW, OTHER] = TARGET_LAWS;

let sqlite: DatabaseSync;
let db: MemoryDb;
const session = sessionAt(Date.parse('2047-05-10T00:00:00+09:00'), null);
const inTime = session.deliberationAt - 1000;
const late = session.deliberationAt + 1000;
const revisionOf = (lawId: string) => (sqlite.prepare('SELECT id FROM law_revisions WHERE law_id = ? ORDER BY seq DESC LIMIT 1').get(lawId) as { id: string }).id;

type LawSpec = { action: 'amend' | 'repeal' | 'enact'; lawId?: string; nums?: string[] };
let nextId = 1;
/** 法案を足す。版 1 の中身を laws に、版 2 の中身を rev2 に入れる（発議した版は 1） */
function addBill(laws: LawSpec[], opts: { status?: string; proposedAt?: number | null; rev2?: LawSpec[] } = {}) {
	const id = nextId++;
	const status = opts.status ?? 'proposed';
	const proposedAt = opts.proposedAt === undefined ? inTime : opts.proposedAt;
	const rev = opts.rev2 ? 2 : 1;
	sqlite
		.prepare("INSERT INTO bills (id, user_id, committee_id, kind, status, rev, next_rev, proposed_rev, title, affected, side_effects, created_at, updated_at, proposed_at) VALUES (?, 'u1', 1, 'amend', ?, ?, 9, ?, ?, 'a', 's', 0, 0, ?)")
		.run(id, status, rev, status === 'draft' ? null : 1, `法案${id}`, proposedAt);
	const write = (r: number, specs: LawSpec[]) =>
		specs.forEach((l, seq) => {
			sqlite
				.prepare('INSERT INTO bill_laws (bill_id, rev, seq, action, law_id, base_revision_id, new_title) VALUES (?, ?, ?, ?, ?, ?, ?)')
				.run(id, r, seq, l.action, l.lawId ?? null, l.lawId ? revisionOf(l.lawId) : null, l.lawId ? null : '新しい法律');
			for (const num of l.nums ?? []) {
				sqlite.prepare("INSERT INTO bill_changes (bill_id, rev, law_seq, num, op, body) VALUES (?, ?, ?, ?, 'add', '[]')").run(id, r, seq, num);
			}
		});
	write(1, laws);
	if (opts.rev2) write(2, opts.rev2);
	return id;
}
const related = async (id: number) => {
	const [bill] = sqlite.prepare('SELECT id, rev, status, proposed_rev AS proposedRev, proposed_at AS proposedAt FROM bills WHERE id = ?').all(id) as never[];
	return (await relatedBills(db, bill, null)).map((b) => b.id);
};

beforeAll(() => {
	({ sqlite, db } = openMemoryDb());
	for (const sql of seedStatements([LAW, OTHER], fixture)) sqlite.exec(sql);
	sqlite.exec("INSERT INTO user (id, name, email, created_at, updated_at) VALUES ('u1', 'u1', 'u1@test.invalid', 0, 0)");
}, 120_000);

test('基準1：同じ会期で同じ法令の同じ条に触れる法案が関連になる。廃止は法令のすべての条に触れる。制定、下書き、別の会期、発議のあとに版が進んだ分は関連にしない', async () => {
	const a = addBill([{ action: 'amend', lawId: LAW, nums: ['1', '2'] }]);
	const sameArticle = addBill([{ action: 'amend', lawId: LAW, nums: ['2'] }]);
	const otherArticle = addBill([{ action: 'amend', lawId: LAW, nums: ['7'] }]);
	const otherLaw = addBill([{ action: 'amend', lawId: OTHER, nums: ['1'] }]);
	const repeal = addBill([{ action: 'repeal', lawId: LAW }]);
	const enact = addBill([{ action: 'enact', nums: ['1'] }]);
	const enactSame = addBill([{ action: 'enact', nums: ['1'] }]);
	const draft = addBill([{ action: 'amend', lawId: LAW, nums: ['1'] }], { status: 'draft', proposedAt: null });
	const nextSession = addBill([{ action: 'amend', lawId: LAW, nums: ['1'] }], { proposedAt: late });
	// 発議した版は第9条で、取り込みで第1条に触れるようになった
	const movedLater = addBill([{ action: 'amend', lawId: LAW, nums: ['9'] }], { rev2: [{ action: 'amend', lawId: LAW, nums: ['1'] }] });
	// 発議した版は第1条で、取り込みの版では触れていない
	const movedAway = addBill([{ action: 'amend', lawId: LAW, nums: ['1'] }], { rev2: [{ action: 'amend', lawId: LAW, nums: ['9'] }] });
	// 2本目の法令で触れる
	const secondLaw = addBill([
		{ action: 'amend', lawId: OTHER, nums: ['5'] },
		{ action: 'amend', lawId: LAW, nums: ['1'] }
	]);

	expect(await related(a)).toEqual([sameArticle, repeal, movedAway, secondLaw]);
	// 互いに関連になる。直接触れる法案だけで、a を通じて secondLaw へはつながらない
	expect(await related(sameArticle)).toEqual([a, repeal]);
	expect(await related(otherArticle)).toEqual([repeal]);
	expect(await related(otherLaw)).toEqual([]);
	// 廃止は同じ法令の法案すべてと関連になる
	expect(await related(repeal)).toEqual([a, sameArticle, otherArticle, movedLater, movedAway, secondLaw]);
	expect(await related(enact)).toEqual([]);
	expect(await related(enactSame)).toEqual([]);
	expect(await related(draft)).toEqual([]);
	expect(await related(nextSession)).toEqual([]);
});

test('基準3：その法案と関連法案の質疑を新しい順に20件ごとに返す。法案の番号が付き、関連法案を渡さなければその法案だけ', async () => {
	const a = addBill([{ action: 'enact', nums: ['1'] }]);
	const b = addBill([{ action: 'enact', nums: ['1'] }]);
	const add = sqlite.prepare("INSERT INTO posts (bill_id, session_key, kind, user_id, body, created_at) VALUES (?, ?, 'question', 'u1', ?, 0)");
	const ids: number[] = [];
	for (let i = 0; i < 21; i++) ids.push(Number(add.run(i % 2 ? b : a, session.key, `質疑${i}`).lastInsertRowid));

	const first = await listQuestions(db, a, null, false, 1, [b]);
	expect(first.rows.map((r) => r.id)).toEqual([...ids].reverse().slice(0, 20));
	expect(first.hasNext).toBe(true);
	expect(first.rows[0].billId).toBe(a);
	expect(first.rows[1].billId).toBe(b);
	const second = await listQuestions(db, a, null, false, 2, [b]);
	expect(second.rows.map((r) => r.id)).toEqual([ids[0]]);
	expect(second.hasNext).toBe(false);

	expect((await listQuestions(db, a, null, false, 1)).rows.every((r) => r.billId === a)).toBe(true);
	expect(await questionTotal(db, a)).toBe(11);
	expect(await questionTotal(db, a, [b])).toBe(21);
});
