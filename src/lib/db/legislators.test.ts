// Issue #158：議員を今月の参加者に数えないこと、議員になる前の票、割り当て（設計書 docs/spec/158.md の 4・5）。画面は e2e/giin-seigen.spec.ts
import { expect, test } from 'vitest';
import { openMemoryDb } from './memory';
import { sessionParticipants } from '../server/bills';
import { writeGrant } from '../server/verifications';
import { assignedBills, assignmentRows, castVote, tallyVotes } from '../server/votes';
import { sessionAt, type Session } from '../domain/session';

const jst = (s: string) => Date.parse(`${s}+09:00`);
const monthOf = (key: string) => sessionAt(jst(`${key}-10T00:00:00`), null);
const previousOf = (s: Session) => sessionAt(s.startsAt - 1, null);
const first = () => 0;

function world() {
	const { sqlite, db } = openMemoryDb();
	const run = (sql: string, ...p: (string | number | null)[]) => sqlite.prepare(sql).run(...p);
	run("INSERT INTO user (id, name, email, created_at, updated_at) VALUES ('op', '運営', 'op@test.invalid', 0, 0)");
	const addUser = (id: string) => run('INSERT INTO user (id, name, email, created_at, updated_at) VALUES (?, ?, ?, 0, 0)', id, id, `${id}@test.invalid`);
	const action = (kind: string, userId: string, at: number) => run("INSERT INTO actions (kind, user_id, ip_hash, created_at) VALUES (?, ?, 'x', ?)", kind, userId, at);
	const grant = (userId: string, kind: 'legislator' | 'expert', at: number) =>
		writeGrant(db, { userId, kind, name: `名前 ${userId}`, field: kind === 'expert' ? '民法' : null }, 'op', at);
	const addBill = (author: string, proposedAt: number) =>
		Number(
			run(
				"INSERT INTO bills (user_id, committee_id, kind, status, rev, next_rev, title, affected, side_effects, created_at, updated_at, proposed_at) VALUES (?, 1, 'amend', 'proposed', 1, 2, 't', 'a', 's', 0, 0, ?)",
				author,
				proposedAt
			).lastInsertRowid
		);
	return { sqlite, db, addUser, action, grant, addBill };
}

test('基準3：数える時点で議員の人は今月の参加者に数えない。有識者は数える。数えたあとで付けても、決まった数は変わらない', async () => {
	const w = world();
	const s = monthOf('2046-05');
	const previous = previousOf(s);
	for (const id of ['a', 'b', 'leg', 'exp', 'late']) {
		w.addUser(id);
		w.action('issue_post', id, previous.startsAt + 1000);
	}
	expect(await w.grant('leg', 'legislator', previous.startsAt + 2000)).toBe(true);
	expect(await w.grant('exp', 'expert', previous.startsAt + 2000)).toBe(true);
	// a・b・exp・late の4人（leg は数えない）
	expect(await sessionParticipants(w.db, 1, s, previous, s.startsAt)).toBe(4);
	// 決まったあとで late を議員にしても変わらない
	expect(await w.grant('late', 'legislator', s.startsAt + 1000)).toBe(true);
	expect(await sessionParticipants(w.db, 1, s, previous, s.startsAt + 2000)).toBe(4);
});

test('基準4：議員になる前に入れた票は、今までどおり数える', async () => {
	const w = world();
	const s = monthOf('2046-06');
	const previous = previousOf(s);
	w.addUser('author');
	w.addUser('v');
	// 会期の前に登録して行動した、投票資格のある人
	w.action('issue_post', 'v', s.startsAt - 1);
	const bill = w.addBill('author', jst('2046-06-01T00:00:00'));
	const now = s.voteAt + 1000;
	expect(await castVote(w.db, { userId: 'v', registeredAt: 0, ipHash: 'ip-v' }, s, previous, bill, 'yes', now, first)).toBe(true);
	expect(await w.grant('v', 'legislator', now + 1000)).toBe(true);
	expect((await tallyVotes(w.db, s, bill)).counted).toEqual({ yes: 1, no: 0, abstain: 0 });
});

test('割り当て：議員には採決の割り当てを作らない。議員でなくなれば作る', async () => {
	const w = world();
	const s = monthOf('2046-07');
	const previous = previousOf(s);
	w.addUser('author');
	w.addUser('leg');
	w.addBill('author', jst('2046-07-01T00:00:00'));
	const now = s.voteAt + 1000;
	expect(await w.grant('leg', 'legislator', now - 1000)).toBe(true);
	expect(await assignmentRows(w.db, 'leg', s, previous, now, first)).toEqual([]);
	expect(w.sqlite.prepare("SELECT count(*) AS n FROM vote_assignments WHERE user_id = 'leg'").get()).toEqual({ n: 0 });
	// 取り消すと、一般の参加者と同じく割り当てる
	w.sqlite.prepare("UPDATE user_verifications SET revoked_at = ? WHERE user_id = 'leg'").run(now);
	expect(await assignmentRows(w.db, 'leg', s, previous, now + 1, first)).toHaveLength(1);
});

test('割り当て：採決の「ほかの法案」のページのように割り当てを直接決めるときも、議員には作らない', async () => {
	const w = world();
	const s = monthOf('2046-08');
	const previous = previousOf(s);
	w.addUser('author');
	w.addUser('leg');
	w.addBill('author', jst('2046-08-01T00:00:00'));
	const now = s.voteAt + 1000;
	expect(await w.grant('leg', 'legislator', now - 1000)).toBe(true);
	expect(await assignedBills(w.db, 'leg', s, previous, now, first)).toEqual([]);
	expect(w.sqlite.prepare("SELECT count(*) AS n FROM vote_assignments WHERE user_id = 'leg'").get()).toEqual({ n: 0 });
});
