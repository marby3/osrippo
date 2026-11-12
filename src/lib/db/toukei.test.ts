// Issue #154：統計ページの立場を超えた支持は、選んだ会期の分を読む（設計書 docs/spec/154.md の F）
import { expect, test } from 'vitest';
import { openMemoryDb } from './memory';
import { sessionAt } from '../domain/session';
import { bridgeRanking, sessionResults } from '../server/toukei';

const jst = (s: string) => Date.parse(`${s}+09:00`);

test('要調整で発議の日付が次の会期に動いた法案も、前の会期の分で数える', async () => {
	const { sqlite, db } = openMemoryDb();
	const s = sessionAt(jst('2030-05-10T00:00:00'), null);
	const nextSession = sessionAt(s.endsAt, null);
	let n = 0;
	const voter = () => {
		const id = `u${++n}`;
		sqlite.prepare('INSERT INTO user (id, name, email, created_at, updated_at) VALUES (?, ?, ?, 0, 0)').run(id, id, `${id}@test.invalid`);
		sqlite.prepare("INSERT INTO actions (kind, user_id, ip_hash, created_at) VALUES ('issue_post', ?, 'x', 0)").run(id);
		return id;
	};
	const author = voter();
	const bill = Number(
		sqlite
			.prepare("INSERT INTO bills (user_id, committee_id, kind, status, rev, next_rev, proposed_rev, title, affected, side_effects, created_at, updated_at, proposed_at) VALUES (?, 1, 'enact', 'proposed', 1, 2, 1, '動いた法案', 'a', 's', 0, 0, ?)")
			.run(author, s.startsAt + 1).lastInsertRowid
	);
	// 賛成寄り10人（賛成6）と反対寄り10人（賛成2）→ 20%
	for (let i = 0; i < 20; i++) {
		const id = voter();
		sqlite.prepare('INSERT INTO stances (session_key, bill_id, user_id, stance, changes, updated_at) VALUES (?, ?, ?, ?, 0, ?)').run(s.key, bill, id, i < 10 ? 'for' : 'against', s.startsAt + 1000);
		const choice = i < 10 ? (i < 6 ? 'yes' : 'no') : i < 12 ? 'yes' : 'no';
		sqlite.prepare('INSERT INTO votes (session_key, bill_id, user_id, choice, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 0)').run(s.key, bill, id, choice);
	}
	sqlite
		.prepare("INSERT INTO bill_results (session_key, bill_id, outcome, yes, no, abstain, ref_yes, ref_no, ref_abstain, participants, quorum, rev, settled_at) VALUES (?, ?, 'rejected', 8, 12, 0, 0, 0, 0, 20, 10, 1, ?)")
		.run(s.key, bill, s.endsAt + 60_000);
	// 要調整で次の会期へ（saveAdjustedBill が発議の日付を動かす）
	sqlite.prepare('UPDATE bills SET proposed_at = ? WHERE id = ?').run(nextSession.startsAt + 1, bill);

	const rows = await sessionResults(db, s);
	expect(await bridgeRanking(db, s, rows, s.endsAt + 120_000)).toEqual([{ billId: bill, title: '動いた法案', ratio: 20 }]);
});
