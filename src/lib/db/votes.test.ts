// Issue #65 基準1・2・5〜7：採決の表、今月の参加者、投票資格、割り当て、票の数え方（設計書 docs/spec/65.md）
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { beforeAll, describe, expect, test } from 'vitest';
import { openMemoryDb } from './memory';
import type { Db } from '../server/law';
import { sessionParticipants } from '../server/bills';
import { assignedBills, billsInVote, castVote, isEligibleVoter, tallyVotes } from '../server/votes';
import { referralSession } from '../domain/bills';
import { drawAssignments } from '../domain/votes';
import { sessionAt, type Session } from '../domain/session';

let sqlite: DatabaseSync;
let db: Db;
const run = (sql: string, ...p: (string | number | null)[]) => sqlite.prepare(sql).run(...p);
const jst = (s: string) => Date.parse(`${s}+09:00`);
const monthOf = (key: string) => sessionAt(jst(`${key}-10T00:00:00`), null);
const previousOf = (s: Session) => sessionAt(s.startsAt - 1, null);
/** その会期の採決の期間のなか */
const inVote = (s: Session) => s.voteAt + 1000;
const first = () => 0;

let nextUser = 1;
const addUser = (createdAt = 0) => {
	const id = `v${nextUser++}`;
	run('INSERT INTO user (id, name, email, created_at, updated_at) VALUES (?, ?, ?, ?, 0)', id, id, `${id}@test.invalid`, createdAt);
	return id;
};
const action = (kind: string, userId: string, at: number) => run("INSERT INTO actions (kind, user_id, ip_hash, created_at) VALUES (?, ?, 'x', ?)", kind, userId, at);
/** 投票資格のある人：会期の前に登録し、前に行動している */
const voter = (s: Session) => {
	const id = addUser();
	action('issue_post', id, s.startsAt - 1);
	return id;
};
const addBill = (author: string, proposedAt: number | null, status = proposedAt === null ? 'draft' : 'proposed') =>
	Number(
		run(
			"INSERT INTO bills (user_id, committee_id, kind, status, rev, next_rev, title, affected, side_effects, created_at, updated_at, proposed_at) VALUES (?, 1, 'amend', ?, 1, 2, 't', 'a', 's', 0, 0, ?)",
			author,
			status,
			proposedAt
		).lastInsertRowid
	);
const clearVotes = () => {
	sqlite.exec('DELETE FROM votes; DELETE FROM vote_assignments; DELETE FROM bill_supports; DELETE FROM bills');
};

beforeAll(() => {
	({ sqlite, db } = openMemoryDb());
});

test('基準1：0011 で票と割り当ての表が増え、actions の行は残り、トリガーと全文検索の表も残る', () => {
	const old = new DatabaseSync(':memory:');
	old.exec('PRAGMA foreign_keys = ON');
	const dir = new URL('../../../drizzle/', import.meta.url);
	const files = readdirSync(dir)
		.filter((f) => f.endsWith('.sql'))
		.sort();
	for (const f of files.filter((f) => f < '0011')) old.exec(readFileSync(new URL(f, dir), 'utf8'));
	old.exec("INSERT INTO user (id, name, email, created_at, updated_at) VALUES ('u', 'u', 'u@test.invalid', 0, 0)");
	old.exec("INSERT INTO actions (kind, user_id, ip_hash, target_id, created_at) VALUES ('issue_post', 'u', 'hash', 7, 123)");

	const later = files.filter((f) => f >= '0011');
	expect(later.length).toBeGreaterThan(0);
	for (const f of later) old.exec(readFileSync(new URL(f, dir), 'utf8'));

	expect(old.prepare('SELECT kind, user_id, ip_hash, target_id, created_at FROM actions').all().map((r) => ({ ...r }))).toEqual([
		{ kind: 'issue_post', user_id: 'u', ip_hash: 'hash', target_id: 7, created_at: 123 }
	]);
	const names = (type: string) => (old.prepare('SELECT name FROM sqlite_master WHERE type = ?').all(type) as { name: string }[]).map((r) => r.name);
	expect(names('table')).toEqual(expect.arrayContaining(['votes', 'vote_assignments', 'search_trigram', 'search_bigram']));
	expect(names('trigger')).toEqual(expect.arrayContaining(['issues_status_log', 'solutions_status_log']));
	expect(names('index')).toEqual(expect.arrayContaining(['actions_user', 'actions_ip', 'actions_target']));

	for (const kind of ['question_post', 'answer_post', 'supplement_post', 'stance_set', 'evaluation_add', 'evaluation_remove', 'amendment_post', 'amendment_accept', 'amendment_support_add', 'amendment_support_remove', 'vote_cast']) {
		old.prepare("INSERT INTO actions (kind, user_id, ip_hash, created_at) VALUES (?, 'u', 'hash', 1)").run(kind);
	}
	expect(() => old.exec("INSERT INTO actions (kind, user_id, ip_hash, created_at) VALUES ('nope', 'u', 'hash', 1)")).toThrow();
	expect(() => old.exec("INSERT INTO votes (session_key, bill_id, user_id, choice, created_at, updated_at) VALUES ('s', 1, 'u', 'maybe', 0, 0)")).toThrow();
});

test('基準2：今月の参加者に質疑・答弁・補足・評価・修正案・投票を数え、立場の変更と取り消しは数えない', async () => {
	const [previous, session] = [monthOf('2041-04'), monthOf('2041-05')];
	for (const kind of ['question_post', 'answer_post', 'supplement_post', 'evaluation_add', 'amendment_post', 'vote_cast']) action(kind, addUser(), previous.startsAt);
	for (const kind of ['stance_set', 'evaluation_remove', 'amendment_accept', 'amendment_support_add', 'amendment_support_remove']) action(kind, addUser(), previous.startsAt);
	expect(await sessionParticipants(db, 1, session, previous, session.startsAt)).toBe(6);
});

test('基準5：投票資格は、会期の始まりより前に登録し、その前に数える行動がある人だけ', async () => {
	const s = monthOf('2042-05');
	const eligible = (id: string, registeredAt: number) => isEligibleVoter(db, id, registeredAt, s);
	const ok = addUser();
	action('issue_post', ok, s.startsAt - 1);
	expect(await eligible(ok, s.startsAt - 1)).toBe(true);
	// 始まりちょうどの登録は間に合わない
	expect(await eligible(ok, s.startsAt)).toBe(false);
	// 始まりちょうどの行動は間に合わない
	const late = addUser();
	action('issue_post', late, s.startsAt);
	expect(await eligible(late, 0)).toBe(false);
	// 数えない行動だけ
	const stanceOnly = addUser();
	action('stance_set', stanceOnly, s.startsAt - 1);
	action('violation', stanceOnly, s.startsAt - 1);
	expect(await eligible(stanceOnly, 0)).toBe(false);
	// 何もしていない
	expect(await eligible(addUser(), 0)).toBe(false);
});

describe('基準6：割り当て', () => {
	test('その会期に採決する法案からくじで3本。自分が提出・賛同した法案は除く。2回目は同じで、同時に開いても組は1つ。期間の外では固定しない', async () => {
		clearVotes();
		const s = monthOf('2043-05');
		const previous = previousOf(s);
		const author = addUser();
		const me = addUser();
		const inRange = [jst('2043-04-15T00:00:00'), jst('2043-05-14T23:59:59.999')];
		const others = [addBill(author, inRange[0]), addBill(author, inRange[1]), addBill(author, jst('2043-05-01T00:00:00')), addBill(author, jst('2043-05-02T00:00:00'))];
		const own = addBill(me, jst('2043-05-03T00:00:00'));
		const supported = addBill(author, jst('2043-05-04T00:00:00'));
		// 古い版の賛同の行でも、賛同したことのある人として除く
		run('INSERT INTO bill_supports (bill_id, rev, user_id, created_at) VALUES (?, 0, ?, 0)', supported, me);
		const lapsed = addBill(author, jst('2043-04-14T23:59:59.999'));
		const nextSession = addBill(author, jst('2043-05-15T00:00:00'));
		addBill(author, null);

		const inVoteIds = (await billsInVote(db, s, previous)).map((b) => b.id).sort((a, b) => a - b);
		expect(inVoteIds).toEqual([...others, own, supported].sort((a, b) => a - b));
		// その会期に採決する法案は、付託先の会期と一致する
		for (const [at, key] of [[inRange[0], '2043-05'], [inRange[1], '2043-05'], [jst('2043-04-14T23:59:59.999'), '2043-04'], [jst('2043-05-15T00:00:00'), '2043-06']] as const) {
			expect(referralSession(at, null).key).toBe(key);
		}
		expect(inVoteIds).not.toContain(lapsed);
		expect(inVoteIds).not.toContain(nextSession);

		// 期間の外では固定しない
		expect(await assignedBills(db, me, s, previous, s.voteAt - 1, first)).toEqual([]);
		expect(await assignedBills(db, me, s, previous, s.endsAt, first)).toEqual([]);
		expect(sqlite.prepare('SELECT count(*) AS n FROM vote_assignments').get()).toEqual({ n: 0 });

		const drawn = await assignedBills(db, me, s, previous, inVote(s), first);
		expect(drawn).toHaveLength(3);
		expect(new Set(drawn).size).toBe(3);
		for (const id of drawn) expect(others).toContain(id);
		// 2回目は、くじの値が違っても同じ
		expect(await assignedBills(db, me, s, previous, inVote(s), () => 0.99)).toEqual(drawn);

		// 同時に開いても組は1つだけ残る
		const racer = addUser();
		const [a, b] = await Promise.all([assignedBills(db, racer, s, previous, inVote(s), first), assignedBills(db, racer, s, previous, inVote(s), () => 0.99)]);
		expect(a).toEqual(b);
		expect(sqlite.prepare('SELECT count(*) AS n FROM vote_assignments WHERE user_id = ?').get(racer)).toEqual({ n: 3 });

		// 足りなければあるだけ。くじは重ならない
		expect(drawAssignments([1, 2], 3, first).sort()).toEqual([1, 2]);
		expect(new Set(drawAssignments([1, 2, 3, 4, 5], 3, Math.random)).size).toBe(3);
		expect(drawAssignments([], 3, first)).toEqual([]);
	});
});

test('基準7：資格があり割り当てをすべて済ませた人の最後の票だけが有効票で、それ以外は参考票。その会期に採決しない法案と期間の外には入らない', async () => {
	clearVotes();
	const s = monthOf('2044-05');
	const previous = previousOf(s);
	const now = inVote(s);
	const author = voter(s);
	const billA = addBill(author, jst('2044-05-01T00:00:00'));
	const billB = addBill(author, jst('2044-05-02T00:00:00'));
	const cast = (who: string, bill: number, choice: 'yes' | 'no' | 'abstain', at = now) => castVote(db, who, s, previous, bill, choice, at, first);

	// 有効票：資格があり、2本とも入れた
	const done = voter(s);
	await cast(done, billA, 'yes');
	await cast(done, billB, 'no');
	// 有効票：入れ直すと最後の票だけ
	const changed = voter(s);
	await cast(changed, billA, 'no');
	await cast(changed, billA, 'yes');
	await cast(changed, billB, 'abstain');
	// 有効票：提出者は候補が0本なので、割り当てを済ませた扱い
	await cast(author, billA, 'abstain');
	// 参考票：割り当てが残っている（画面を通らず入れても、票を入れるときに固定される）
	const unfinished = voter(s);
	await cast(unfinished, billA, 'no');
	expect(sqlite.prepare('SELECT count(*) AS n FROM vote_assignments WHERE user_id = ?').get(unfinished)).toEqual({ n: 2 });
	// 参考票：前に行動していない
	const noAction = addUser();
	await cast(noAction, billA, 'yes');
	await cast(noAction, billB, 'yes');
	// 参考票：会期の始まりちょうどの登録
	const lateSignup = addUser(s.startsAt);
	action('issue_post', lateSignup, s.startsAt - 1);
	await cast(lateSignup, billA, 'abstain');
	await cast(lateSignup, billB, 'abstain');

	expect(await tallyVotes(db, s, billA)).toEqual({ counted: { yes: 2, no: 0, abstain: 1 }, reference: { yes: 1, no: 1, abstain: 1 } });
	expect(await tallyVotes(db, s, billB)).toEqual({ counted: { yes: 0, no: 1, abstain: 1 }, reference: { yes: 1, no: 0, abstain: 1 } });

	// その会期に採決しない法案と、期間の外には入らない
	const outsider = voter(s);
	const lapsed = addBill(author, jst('2044-04-10T00:00:00'));
	const nextSession = addBill(author, jst('2044-05-20T00:00:00'));
	const draft = addBill(author, null);
	const count = () => (sqlite.prepare('SELECT count(*) AS n FROM votes WHERE user_id = ?').get(outsider) as { n: number }).n;
	expect(await cast(outsider, lapsed, 'yes')).toBe(false);
	expect(await cast(outsider, nextSession, 'yes')).toBe(false);
	expect(await cast(outsider, draft, 'yes')).toBe(false);
	expect(await cast(outsider, billA, 'yes', s.voteAt - 1)).toBe(false);
	expect(await cast(outsider, billA, 'yes', s.endsAt)).toBe(false);
	expect(count()).toBe(0);
	expect(await cast(outsider, billA, 'yes')).toBe(true);
	expect(count()).toBe(1);
});
