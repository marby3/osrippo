// Issue #87：立場別の分布と考えの動きを一度だけ作って残す（設計書 docs/spec/87.md の A・B）
import { expect, test } from 'vitest';
import { openMemoryDb } from './memory';
import { sessionAt, type Session } from '../domain/session';
import { stanceStatsOf } from '../server/stance-stats';

const jst = (s: string) => Date.parse(`${s}+09:00`);

function setup() {
	const { sqlite, db } = openMemoryDb();
	const s: Session = sessionAt(jst('2030-05-10T00:00:00'), null);
	let n = 0;
	const addUser = (createdAt = 0) => {
		const id = `u${++n}`;
		sqlite.prepare('INSERT INTO user (id, name, email, created_at, updated_at) VALUES (?, ?, ?, ?, 0)').run(id, id, `${id}@test.invalid`, createdAt);
		return id;
	};
	/** 投票資格のある人（数えた票になる） */
	const voter = () => {
		const id = addUser();
		sqlite.prepare("INSERT INTO actions (kind, user_id, ip_hash, created_at) VALUES ('issue_post', ?, 'x', 0)").run(id);
		return id;
	};
	const author = addUser();
	const bill = Number(
		sqlite
			.prepare("INSERT INTO bills (user_id, committee_id, kind, status, rev, next_rev, proposed_rev, title, affected, side_effects, created_at, updated_at, proposed_at) VALUES (?, 1, 'enact', 'proposed', 1, 2, 1, 't', 'a', 's', 0, 0, ?)")
			.run(author, s.startsAt + 1).lastInsertRowid
	);
	const vote = (userId: string, choice: 'yes' | 'no' | 'abstain') =>
		sqlite.prepare('INSERT INTO votes (session_key, bill_id, user_id, choice, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 0)').run(s.key, bill, userId, choice);
	/** 立場を選ぶ（stances のトリガーが stance_log に足す） */
	const stance = (userId: string, value: 'for' | 'against', at: number) =>
		sqlite.prepare('INSERT INTO stances (session_key, bill_id, user_id, stance, changes, updated_at) VALUES (?, ?, ?, ?, 0, ?)').run(s.key, bill, userId, value, at);
	const settle = () =>
		sqlite
			.prepare("INSERT INTO bill_results (session_key, bill_id, outcome, yes, no, abstain, ref_yes, ref_no, ref_abstain, participants, quorum, rev, settled_at) VALUES (?, ?, 'rejected', 0, 0, 0, 0, 0, 0, 10, 10, 1, ?)")
			.run(s.key, bill, s.endsAt + 60_000);
	const review = (status: 'open' | 'voided' | 'confirmed') =>
		sqlite.prepare("INSERT INTO vote_reviews (session_key, bill_id, signals, detail, status, created_at) VALUES (?, ?, '[]', '{}', ?, 0)").run(s.key, bill, status);
	const rows = () => (sqlite.prepare('SELECT count(*) AS n FROM stance_stats').get() as { n: number }).n;
	const target = { id: bill, proposedAt: s.startsAt + 1 };
	return { sqlite, s, voter, addUser, vote, stance, settle, review, rows, stanceStatsOf: () => stanceStatsOf(db, target, null, s.endsAt + 120_000) };
}

test('一度作ると残り、あとで票や立場が変わっても値は変わらない。参考の票は入れない', async () => {
	const t = setup();
	const people = Array.from({ length: 10 }, () => t.voter());
	for (const p of people) {
		t.stance(p, 'for', t.s.startsAt + 1000);
		t.vote(p, 'yes');
	}
	// 投票資格のない人（参考の票）
	const ref = t.addUser();
	t.stance(ref, 'for', t.s.startsAt + 1000);
	t.vote(ref, 'no');
	t.settle();
	const first = await t.stanceStatsOf();
	expect(first?.votes.for).toEqual({ yes: 10, no: 0, abstain: 0 });
	// 立場を選んだ人は11人（参考の票の人も含む。考えの動きは票と関係なく数える）
	expect(first?.weeks[3]).toEqual({ for: 11, undecided: 0, against: 0 });
	expect(t.rows()).toBe(1);

	// あとから票が消えても（#89 の削除）、残した値を返す
	t.sqlite.prepare('DELETE FROM votes WHERE user_id = ?').run(people[0]);
	expect(await t.stanceStatsOf()).toEqual(first);
	expect(t.rows()).toBe(1);
});

test('結果がない、確認中、無効のときは作らない。確定したら作る', async () => {
	const t = setup();
	for (let i = 0; i < 10; i++) t.vote(t.voter(), 'no');
	expect(await t.stanceStatsOf()).toBeNull();
	t.settle();
	t.review('open');
	expect(await t.stanceStatsOf()).toBeNull();
	expect(t.rows()).toBe(0);
	t.sqlite.prepare("UPDATE vote_reviews SET status = 'voided'").run();
	expect(await t.stanceStatsOf()).toBeNull();
	expect(t.rows()).toBe(0);
	t.sqlite.prepare("UPDATE vote_reviews SET status = 'confirmed'").run();
	expect((await t.stanceStatsOf())?.votes.undecided).toEqual({ yes: 0, no: 10, abstain: 0 });
	expect(t.rows()).toBe(1);
});
