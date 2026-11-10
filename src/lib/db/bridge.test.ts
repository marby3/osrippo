// Issue #126：立場を超えた支持順（課題の橋渡しスコア）。設計書 docs/spec/126.md
// 2つのグループに10人ずつ数えた票を作るのは画面のテストでは重いので、DB で確かめる
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { openMemoryDb } from './memory';
import type { Db } from '../server/law';
import { listIssues } from '../server/issues';
import type { ListQuery } from '../domain/issues';
import { sessionAt } from '../domain/session';

let sqlite: DatabaseSync;
let db: Db;

const jst = (t: string) => Date.parse(`${t}+09:00`);
const NOW = jst('2030-07-10T09:00:00');
const current = sessionAt(NOW, null);
/** 直近に締め切った会期（2030-06） */
const previous = sessionAt(current.startsAt - 1, null);
/** その前の会期（2030-05） */
const older = sessionAt(previous.startsAt - 1, null);
const BEFORE = older.startsAt - 1000;

let seq = 0;
/** 投票資格のある人（会期の前に登録し、参加の行動がある） */
const person = (eligible = true) => {
	const id = `p${++seq}`;
	const created = eligible ? BEFORE : previous.startsAt + 1000;
	sqlite.prepare('INSERT INTO user (id, name, email, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(id, id, `${id}@test.invalid`, created, created);
	sqlite.prepare("INSERT INTO actions (kind, user_id, ip_hash, created_at) VALUES ('support_add', ?, 'h', ?)").run(id, created);
	return id;
};
let billSeq = 0;
const bill = () => {
	const id = ++billSeq;
	sqlite
		.prepare(
			"INSERT INTO bills (id, user_id, committee_id, kind, status, rev, next_rev, title, affected, side_effects, created_at, updated_at, proposed_at) VALUES (?, 'author', 1, 'amend', 'proposed', 1, 2, ?, 'a', 's', 0, 0, 0)"
		)
		.run(id, `法案${id}`);
	return id;
};
const vote = (userId: string, billId: number, choice: 'yes' | 'no' | 'abstain', session = previous) =>
	sqlite.prepare('INSERT INTO votes (session_key, bill_id, user_id, choice, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 0)').run(session.key, billId, userId, choice);
const review = (billId: number, status: 'noted' | 'open' | 'confirmed' | 'voided') =>
	sqlite.prepare("INSERT INTO vote_reviews (session_key, bill_id, signals, detail, status, created_at) VALUES (?, ?, '[]', '{}', ?, 0)").run(previous.key, billId, status);

let A: number;
let B: number;
/** 賛成寄りの人（直近の会期の数えた票で賛成が多い） */
const forPerson = () => {
	const p = person();
	vote(p, A, 'yes');
	vote(p, B, 'yes');
	return p;
};
/** 反対寄りの人 */
const againstPerson = () => {
	const p = person();
	vote(p, A, 'no');
	vote(p, B, 'abstain');
	return p;
};
let issueSeq = 0;
const issue = (supporters: string[]) => {
	const id = ++issueSeq;
	sqlite.prepare("INSERT INTO issues (id, user_id, title, affected, example, created_at) VALUES (?, 'author', ?, 'a', 'e', 0)").run(id, `課題${id}`);
	for (const u of supporters) sqlite.prepare('INSERT INTO issue_supports (issue_id, user_id, created_at) VALUES (?, ?, 0)').run(id, u);
	return id;
};
const query = (o: Partial<ListQuery> = {}): ListQuery => ({ sort: 'bridge', topic: 'all', solutions: false, bills: false, q: '', page: 1, ...o });
const list = (o: Partial<ListQuery> = {}) => listIssues(db, query(o), null, NOW, [], previous);
const times = <T>(n: number, f: () => T) => Array.from({ length: n }, f);

beforeAll(() => {
	({ sqlite, db } = openMemoryDb());
});

beforeEach(() => {
	sqlite.exec(
		'DELETE FROM issue_supports; DELETE FROM issues; DELETE FROM vote_assignments; DELETE FROM vote_reviews; DELETE FROM votes; DELETE FROM bills; DELETE FROM actions; DELETE FROM user;'
	);
	sqlite.prepare("INSERT INTO user (id, name, email, created_at, updated_at) VALUES ('author', 'author', 'a@test.invalid', 0, 0)").run();
	A = bill();
	B = bill();
});

describe('立場を超えた支持順', () => {
	test('基準2・決めること E：低いほうの割合が高い順。課題ごとにどちらのグループも10人以上のときだけ割合を使い、足りない課題は下に「わかる」の多い順', async () => {
		const fors = times(12, forPerson);
		const againsts = times(12, againstPerson);
		// どちらにも入らない人（賛成と反対が同じ数）
		const neutrals = times(30, () => {
			const p = person();
			vote(p, A, 'yes');
			vote(p, B, 'no');
			return p;
		});
		const p = issue([...fors, ...againsts.slice(0, 10)]); // min(12/12, 10/12) = 0.83、わかる 22
		const q = issue([...fors.slice(0, 10), ...againsts]); // 0.83、わかる 22（p より新しい）
		const r = issue([...fors.slice(0, 11), ...againsts.slice(0, 11)]); // 0.92
		const s = issue([...fors, ...againsts.slice(0, 9)]); // 反対寄りが9人：割合を使わない、わかる 21
		const t = issue(neutrals); // グループの人がいない：割合を使わない、わかる 30
		const result = await list();
		expect(result.bridgeFallback).toBe(false);
		expect(result.rows.map((row) => row.id)).toEqual([r, q, p, t, s]);
	});

	test('決めること A：直近に締め切った会期の数えた票だけで分け、参考の票・確認中と無効の法案の票・前の会期の票・同じ数・棄権だけの人は入れない', async () => {
		times(10, forPerson);
		times(9, againstPerson);
		// 反対寄りに見えるが入らない人
		const reference = person(false);
		vote(reference, A, 'no');
		const tie = person();
		vote(tie, A, 'yes');
		vote(tie, B, 'no');
		const abstainOnly = person();
		vote(abstainOnly, A, 'abstain');
		const oldSession = person();
		vote(oldSession, A, 'no', older);
		const voided = bill();
		review(voided, 'voided');
		const underReview = bill();
		review(underReview, 'open');
		for (const billId of [voided, underReview]) {
			const p = person();
			vote(p, billId, 'no');
		}
		// 割り当てのすべてに票を入れていない人の票は数えた票にならない
		const unfinished = person();
		vote(unfinished, A, 'no');
		sqlite.prepare('INSERT INTO vote_assignments (session_key, user_id, seq, bill_id, created_at) VALUES (?, ?, 0, ?, 0)').run(previous.key, unfinished, B);
		// 足りなかったかは一覧の行と一緒に返すので、課題を1つ置く
		issue([]);
		expect((await list()).bridgeFallback).toBe(true);

		// 記録だけ（noted）と確かめた（confirmed）法案の票は使う：反対寄りが10人になる
		const noted = bill();
		review(noted, 'noted');
		const p = person();
		vote(p, noted, 'no');
		expect((await list()).bridgeFallback).toBe(false);
	});

	test('基準3：どちらかのグループが10人未満なら「わかる」の多い順で、足りなかったことを返す', async () => {
		const fors = times(10, forPerson);
		const againsts = times(9, againstPerson);
		const few = issue([...fors.slice(0, 1), ...againsts.slice(0, 1)]);
		const many = issue(fors);
		const result = await list();
		expect(result.bridgeFallback).toBe(true);
		expect(result.rows.map((row) => row.id)).toEqual([many, few]);
		// ほかの並びを選んだときは計算せず、足りなかったことも返さない
		expect((await list({ sort: 'support' })).bridgeFallback).toBe(false);
	});

	test('基準5：行には割合・グループの人数・グループを入れない', async () => {
		const fors = times(10, forPerson);
		const againsts = times(10, againstPerson);
		issue([...fors, ...againsts]);
		const { rows } = await list();
		for (const key of ['score', 'fallback', 'side', 'for', 'against', 'bridge_user_id']) expect(rows[0]).not.toHaveProperty(key);
		expect(rows[0]).toMatchObject({ supports: 20 });
	});
});

describe('Issue #149：議員ダッシュボードの割合（設計書 docs/spec/149.md の 2）', () => {
	test('ダッシュボードの一覧だけが、どちらの区分も10人以上の課題に5%刻みの割合を返す。課題の一覧には割合を入れない', async () => {
		const fors = times(13, forPerson);
		const againsts = times(10, againstPerson);
		// 10/13 = 0.769… と 10/10 = 1 の低いほう → 75%
		const both = issue([...fors.slice(0, 10), ...againsts]);
		// 反対寄りが9人なので割合を出さない
		const short = issue([...fors.slice(0, 10), ...againsts.slice(0, 9)]);
		const dashboard = await listIssues(db, query(), null, NOW, [], previous, 20, true);
		const ratioOf = (id: number) => dashboard.rows.find((r) => r.id === id)?.ratio;
		expect(ratioOf(both)).toBe(75);
		expect(ratioOf(short)).toBeNull();
		// 課題の一覧の呼び方では、割合の列そのものがない
		const general = await list();
		expect(general.rows.every((r) => !('ratio' in r))).toBe(true);
	});

	test('グループ全体が10人未満なら、どの課題も割合を出さない', async () => {
		const fors = times(9, forPerson);
		const againsts = times(12, againstPerson);
		const id = issue([...fors, ...againsts]);
		const dashboard = await listIssues(db, query(), null, NOW, [], previous, 20, true);
		expect(dashboard.rows.find((r) => r.id === id)?.ratio).toBeNull();
	});
});
