// Issue #125：課題から生まれた法案の数え方（決めること A〜C）と、課題の一覧の「法案あり」
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { openMemoryDb } from './memory';
import type { Db } from '../server/law';
import { issueBillCount, issueBills } from '../server/issue-bills';
import { listIssues } from '../server/issues';
import type { ListQuery } from '../domain/issues';

let sqlite: DatabaseSync;
let db: Db;
let nextId = 1;

const issue = (title = `課題${nextId}`) => {
	const id = nextId++;
	sqlite
		.prepare("INSERT INTO issues (id, user_id, title, affected, example, created_at) VALUES (?, 'u1', ?, 'a', 'e', 0)")
		.run(id, title);
	return id;
};
const solution = (issueId: number, status = 'visible') => {
	const id = nextId++;
	sqlite.prepare("INSERT INTO solutions (id, issue_id, user_id, body, status, created_at) VALUES (?, ?, 'u1', 'b', ?, 0)").run(id, issueId, status);
	return id;
};
/** 法案。cites は版ごとに引く解決策（既定はいまの版 rev だけ） */
const bill = (o: { status?: string; rev?: number; proposedAt?: number | null; cites: Record<number, number[]>; title?: string }) => {
	const id = nextId++;
	const status = o.status ?? 'draft';
	const rev = o.rev ?? 1;
	sqlite
		.prepare(
			"INSERT INTO bills (id, user_id, committee_id, kind, status, rev, next_rev, title, affected, side_effects, created_at, updated_at, proposed_at, withdrawn_at) VALUES (?, 'u1', 1, 'amend', ?, ?, ?, ?, 'a', 's', ?, ?, ?, ?)"
		)
		.run(id, status, rev, rev + 1, o.title ?? `法案${id}`, id, id, o.proposedAt ?? (status === 'draft' ? null : id), status === 'withdrawn' ? id : null);
	for (const [r, ids] of Object.entries(o.cites)) {
		ids.forEach((s, seq) => sqlite.prepare('INSERT INTO bill_solutions (bill_id, rev, seq, solution_id) VALUES (?, ?, ?, ?)').run(id, Number(r), seq, s));
	}
	return id;
};
const query = (o: Partial<ListQuery> = {}): ListQuery => ({ sort: 'new', topic: 'all', solutions: false, bills: false, q: '', page: 1, ...o });

beforeAll(() => {
	({ sqlite, db } = openMemoryDb());
	sqlite.prepare("INSERT INTO user (id, name, email, created_at, updated_at) VALUES ('u1', 'u1', 'u1@test.invalid', 0, 0)").run();
});

beforeEach(() => {
	sqlite.exec('DELETE FROM bill_solutions; DELETE FROM bills; DELETE FROM solutions; DELETE FROM issues;');
});

describe('課題から生まれた法案', () => {
	test('A：いまの版でこの課題の解決策を引く法案を、下書きも発議もした法案も数える。取り下げた法案と、前の版だけで引いていた法案と、保存していない法案は数えない', async () => {
		const i = issue();
		const s = solution(i);
		const other = solution(issue());
		const draft = bill({ cites: { 1: [s] } });
		const proposed = bill({ status: 'proposed', cites: { 1: [other, s] } });
		bill({ status: 'withdrawn', cites: { 1: [s] } });
		bill({ rev: 2, cites: { 1: [s], 2: [other] } });
		bill({ rev: 0, cites: { 0: [s] } });
		expect(await issueBillCount(db, i)).toBe(2);
		expect((await issueBills(db, i, 0)).map((b) => b.id).sort()).toEqual([draft, proposed].sort());
	});

	test('同じ法案が同じ課題の解決策を2つ引いても1本', async () => {
		const i = issue();
		bill({ cites: { 1: [solution(i), solution(i)] } });
		expect(await issueBillCount(db, i)).toBe(1);
	});

	test('B：統合で解決策が統合先へ移ると、統合先で数える', async () => {
		const from = issue();
		const to = issue();
		const s = solution(from);
		bill({ cites: { 1: [s] } });
		sqlite.prepare('UPDATE solutions SET issue_id = ? WHERE id = ?').run(to, s);
		expect(await issueBillCount(db, to)).toBe(1);
		expect(await issueBillCount(db, from)).toBe(0);
	});

	test('C：引いた解決策があとで非表示になっても数える', async () => {
		const i = issue();
		bill({ cites: { 1: [solution(i, 'hidden')] } });
		expect(await issueBillCount(db, i)).toBe(1);
	});

	test('基準4：一覧は新しい順で、種類・題名と、下書き・審議中・終わったのどれかを返す', async () => {
		const i = issue();
		const s = solution(i);
		const before = 1000;
		const draft = bill({ title: '下書きの法案', cites: { 1: [s] } });
		const live = bill({ status: 'proposed', proposedAt: before, title: '審議中の法案', cites: { 1: [s] } });
		const lapsed = bill({ status: 'proposed', proposedAt: before - 1, title: '終わった法案', cites: { 1: [s] } });
		expect(await issueBills(db, i, before)).toEqual([
			{ id: lapsed, kind: 'amend', title: '終わった法案', tab: 'owari' },
			{ id: live, kind: 'amend', title: '審議中の法案', tab: 'shingi' },
			{ id: draft, kind: 'amend', title: '下書きの法案', tab: 'shitagaki' }
		]);
	});
});

describe('課題の一覧', () => {
	test('基準1・2：行に法案の数があり、「法案あり」で法案のある課題だけになる', async () => {
		const withBill = issue('法案のある課題');
		const without = issue('法案のない課題');
		const withdrawnOnly = issue('取り下げた法案だけの課題');
		bill({ cites: { 1: [solution(withBill)] } });
		solution(without);
		bill({ status: 'withdrawn', cites: { 1: [solution(withdrawnOnly)] } });

		const all = await listIssues(db, query(), null, 0);
		expect(Object.fromEntries(all.rows.map((r) => [r.id, r.bills]))).toEqual({ [withBill]: 1, [without]: 0, [withdrawnOnly]: 0 });
		const filtered = await listIssues(db, query({ bills: true }), null, 0);
		expect(filtered.rows.map((r) => r.id)).toEqual([withBill]);
	});
});
