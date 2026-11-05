// Issue #71 基準1〜3・8 の DB の側（設計書 docs/spec/71.md 決めたこと1・2・5）
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { beforeAll, expect, test, vi } from 'vitest';
import { openMemoryDb, type MemoryDb } from './memory';
import { sessionAt, type Session } from '../domain/session';
import { billById } from '../server/bills';
import { settleOnRead, settleSession } from '../server/results';

/** 修正案の処理が別の実行と重なったときの形を作る */
const overlap = vi.hoisted(() => ({ on: false }));
vi.mock('../server/amendments', async (original) => {
	const actual = await original<typeof import('../server/amendments')>();
	return { ...actual, settleAmendments: (...args: Parameters<typeof actual.settleAmendments>) => (overlap.on ? Promise.resolve(false) : actual.settleAmendments(...args)) };
});

let sqlite: DatabaseSync;
let db: MemoryDb;
const jst = (s: string) => Date.parse(`${s}+09:00`);
const monthOf = (key: string) => sessionAt(jst(`${key}-10T00:00:00`), null);
const previousOf = (s: Session) => sessionAt(s.startsAt - 1, null);
const MINUTE = 60_000;
/** 締切から1分たったあと */
const after = (s: Session) => s.endsAt + MINUTE;

let nextUser = 1;
function addUser(createdAt = 0) {
	const id = `r${nextUser++}`;
	sqlite.prepare('INSERT INTO user (id, name, email, created_at, updated_at) VALUES (?, ?, ?, ?, 0)').run(id, id, `${id}@test.invalid`, createdAt);
	return id;
}
/** 投票資格のある人 */
function voter() {
	const id = addUser();
	sqlite.prepare("INSERT INTO actions (kind, user_id, ip_hash, created_at) VALUES ('issue_post', ?, 'x', 0)").run(id);
	return id;
}
/** 発議した制定の法案（条は2つ）。その会期の採決の対象 */
function addBill(s: Session, offset = 1) {
	const author = addUser();
	const id = Number(
		sqlite
			.prepare("INSERT INTO bills (user_id, committee_id, kind, status, rev, next_rev, proposed_rev, title, affected, side_effects, created_at, updated_at, proposed_at) VALUES (?, 1, 'enact', 'proposed', 1, 2, 1, 't', 'a', 's', 0, 0, ?)")
			.run(author, s.startsAt + offset).lastInsertRowid
	);
	sqlite.prepare("INSERT INTO bill_laws (bill_id, rev, seq, action, new_title) VALUES (?, 1, 0, 'enact', '新しい法律')").run(id);
	sqlite.prepare('INSERT INTO bill_solutions (bill_id, rev, seq, solution_id) VALUES (?, 1, 0, 1)').run(id);
	for (const num of ['1', '2']) {
		sqlite.prepare("INSERT INTO bill_changes (bill_id, rev, law_seq, num, op, caption, body) VALUES (?, 1, 0, ?, 'add', '（見出し）', ?)").run(id, num, JSON.stringify([{ num: '1', text: `第${num}条の本文`, items: [] }]));
	}
	return id;
}
/** 票を入れる。割り当ての行がない人は、割り当てを済ませた扱い（docs/spec/65.md 決めたこと10） */
function votes(s: Session, bill: number, choice: 'yes' | 'no' | 'abstain', n: number, who = voter) {
	for (let i = 0; i < n; i++) sqlite.prepare('INSERT INTO votes (session_key, bill_id, user_id, choice, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 0)').run(s.key, bill, who(), choice);
}
const resultOf = (s: Session, bill: number) => {
	const row = sqlite.prepare('SELECT * FROM bill_results WHERE session_key = ? AND bill_id = ?').get(s.key, bill);
	return row ? { ...row } : undefined;
};
const fixParticipants = (s: Session, n: number) => sqlite.prepare('INSERT INTO session_participants (committee_id, session_key, active_count, fixed_at) VALUES (1, ?, ?, 0)').run(s.key, n);

beforeAll(() => {
	({ sqlite, db } = openMemoryDb());
	sqlite.exec("INSERT INTO user (id, name, email, created_at, updated_at) VALUES ('issuer', 'i', 'i@test.invalid', 0, 0); INSERT INTO issues (id, user_id, title, affected, example, topic_id, created_at) VALUES (1, 'issuer', '課題', '人', '例', NULL, 0); INSERT INTO solutions (id, issue_id, user_id, body, created_at) VALUES (1, 1, 'issuer', '解決策', 0);");
});

test('基準1：0015 で結果の表が増え、既存の行は残る。結果の値は決まったものだけ', () => {
	const old = new DatabaseSync(':memory:');
	old.exec('PRAGMA foreign_keys = ON');
	const dir = new URL('../../../drizzle/', import.meta.url);
	const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
	for (const f of files.filter((f) => f < '0015')) old.exec(readFileSync(new URL(f, dir), 'utf8'));
	old.exec("INSERT INTO user (id, name, email, created_at, updated_at) VALUES ('u', 'u', 'u@test.invalid', 0, 0)");
	old.exec("INSERT INTO bills (id, user_id, committee_id, kind, title, affected, side_effects, created_at, updated_at) VALUES (1, 'u', 1, 'amend', 't', 'a', 's', 0, 0)");
	old.exec("INSERT INTO votes (session_key, bill_id, user_id, choice, created_at, updated_at) VALUES ('s', 1, 'u', 'yes', 0, 0)");

	const later = files.filter((f) => f >= '0015');
	expect(later.length).toBeGreaterThan(0);
	for (const f of later) old.exec(readFileSync(new URL(f, dir), 'utf8'));

	expect(old.prepare('SELECT choice FROM votes').all().map((r) => ({ ...r }))).toEqual([{ choice: 'yes' }]);
	expect(old.prepare('SELECT title FROM bills').all().map((r) => ({ ...r }))).toEqual([{ title: 't' }]);
	const insert = (outcome: string) =>
		old.exec(`INSERT INTO bill_results (session_key, bill_id, outcome, yes, no, abstain, ref_yes, ref_no, ref_abstain, participants, quorum, rev, settled_at) VALUES ('s', 1, '${outcome}', 0, 0, 0, 0, 0, 0, 0, 10, 1, 0)`);
	expect(() => insert('maybe')).toThrow();
	insert('passed');
	// 同じ会期の同じ法案は1行だけ
	expect(() => insert('rejected')).toThrow();
});

test('基準2：可決・否決（同数）・廃案を判定して記録する。定足数は固定した今月の参加者の 20% を切り上げ、最低10人。その会期の法案だけ。締切から1分は処理しない。1本が失敗しても残りを処理する', async () => {
	const s = monthOf('2061-05');
	const previous = previousOf(s);
	fixParticipants(s, 51);

	// 51人の 20% は 10.2 → 11票
	const passed = addBill(s, 1);
	votes(s, passed, 'yes', 7);
	votes(s, passed, 'no', 3);
	votes(s, passed, 'abstain', 1);
	// 参考の票：前に行動していない人
	votes(s, passed, 'no', 2, () => addUser());
	votes(s, passed, 'abstain', 1, () => addUser());
	const tie = addBill(s, 2);
	votes(s, tie, 'yes', 5);
	votes(s, tie, 'no', 5);
	votes(s, tie, 'abstain', 1);
	const lapsed = addBill(s, 3);
	votes(s, lapsed, 'yes', 10);
	const nextSession = addBill(s, s.deliberationAt - s.startsAt);
	const broken = addBill(s, 4);
	// 修正案の本文が壊れていて、この法案の処理だけが失敗する
	sqlite.prepare("INSERT INTO amendments (bill_id, session_key, base_rev, law_seq, num, user_id, body, revision, status, created_at, updated_at) VALUES (?, ?, 1, 0, '1', 'issuer', 'こわれた本文', 1, 'open', 0, 0)").run(broken, s.key);
	const afterBroken = addBill(s, 5);
	votes(s, afterBroken, 'no', 11);

	// 締切から1分たつまでは何もしない
	await settleSession(db, s, previous, after(s) - 1);
	expect(resultOf(s, passed)).toBeUndefined();

	await expect(settleSession(db, s, previous, after(s))).rejects.toThrow();
	expect(resultOf(s, passed)).toMatchObject({ outcome: 'passed', yes: 7, no: 3, abstain: 1, ref_yes: 0, ref_no: 2, ref_abstain: 1, participants: 51, quorum: 11, rev: 1, settled_at: after(s) });
	expect(resultOf(s, tie)).toMatchObject({ outcome: 'rejected', yes: 5, no: 5, abstain: 1 });
	expect(resultOf(s, lapsed)).toMatchObject({ outcome: 'lapsed', yes: 10, quorum: 11 });
	expect(resultOf(s, broken)).toBeUndefined();
	expect(resultOf(s, afterBroken)).toMatchObject({ outcome: 'rejected', no: 11 });
	// 次の会期に採決する法案は入らない
	expect(sqlite.prepare('SELECT count(*) AS n FROM bill_results WHERE bill_id = ?').get(nextSession)).toEqual({ n: 0 });

	// 最低10人：参加者が少ない会期
	const small = monthOf('2062-05');
	fixParticipants(small, 3);
	const nine = addBill(small, 1);
	votes(small, nine, 'yes', 9);
	const ten = addBill(small, 2);
	votes(small, ten, 'yes', 10);
	await settleSession(db, small, previousOf(small), after(small));
	expect(resultOf(small, nine)).toMatchObject({ outcome: 'lapsed', quorum: 10 });
	expect(resultOf(small, ten)).toMatchObject({ outcome: 'passed', quorum: 10 });
});

test('基準3：何度走っても結果は変わらない。修正案は本案より先に処理し、記録する版は当てたあとの版。処理が重なったら結果を書かず、やり直すと書く', async () => {
	const s = monthOf('2063-05');
	const previous = previousOf(s);
	fixParticipants(s, 0);
	const bill = addBill(s);
	const backers = [addUser(), addUser()];
	const amendment = Number(
		sqlite
			.prepare("INSERT INTO amendments (bill_id, session_key, base_rev, law_seq, num, user_id, body, revision, status, created_at, updated_at) VALUES (?, ?, 1, 0, '2', 'issuer', ?, 1, 'open', 0, 0)")
			.run(bill, s.key, JSON.stringify([{ num: '1', text: '修正案の本文', items: [] }])).lastInsertRowid
	);
	for (const b of backers) sqlite.prepare('INSERT INTO amendment_supports (amendment_id, revision, user_id, created_at) VALUES (?, 1, ?, 0)').run(amendment, b);
	for (let i = 0; i < 10; i++) {
		const v = voter();
		sqlite.prepare("INSERT INTO votes (session_key, bill_id, user_id, choice, created_at, updated_at) VALUES (?, ?, ?, 'yes', 0, 0)").run(s.key, bill, v);
		sqlite.prepare("INSERT INTO amendment_votes (session_key, amendment_id, user_id, choice, created_at, updated_at) VALUES (?, ?, ?, 'yes', 0, 0)").run(s.key, amendment, v);
	}

	// 重なったときは結果を書かない
	overlap.on = true;
	await settleSession(db, s, previous, after(s));
	expect(resultOf(s, bill)).toBeUndefined();
	overlap.on = false;

	await settleSession(db, s, previous, after(s));
	const first = resultOf(s, bill);
	expect(first).toMatchObject({ outcome: 'passed', yes: 10, rev: 2 });
	expect((await billById(db, bill))?.rev).toBe(2);
	expect(sqlite.prepare('SELECT status FROM amendments WHERE id = ?').get(amendment)).toEqual({ status: 'passed' });

	// 結果の行は変わらない
	sqlite.prepare("INSERT INTO votes (session_key, bill_id, user_id, choice, created_at, updated_at) VALUES (?, ?, ?, 'no', 0, 0)").run(s.key, bill, voter());
	await settleSession(db, s, previous, after(s) + 3 * MINUTE);
	expect(resultOf(s, bill)).toEqual(first);
	expect((await billById(db, bill))?.rev).toBe(2);
});

test('基準8：読むときの処理が失敗しても、ページの読み込みを止めない', async () => {
	const s = monthOf('2064-05');
	const log = vi.spyOn(console, 'error').mockImplementation(() => {});
	const broken = {
		select() {
			throw new Error('DB が読めない');
		}
	} as unknown as MemoryDb;
	await expect(settleOnRead(broken, s, previousOf(s), after(s))).resolves.toBeUndefined();
	expect(log).toHaveBeenCalled();
	log.mockRestore();
});
