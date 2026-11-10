// Issue #149：議員ダッシュボードの「IF世界で可決」のタブの範囲（設計書 docs/spec/149.md の 3）。画面は e2e/giin.spec.ts
import { expect, test } from 'vitest';
import { openMemoryDb } from './memory';
import { passedBills } from '../server/giin';

test('可決した法案だけを、新しい会期の順に。確認中と無効にした法案は出さない', async () => {
	const { sqlite, db } = openMemoryDb();
	sqlite.exec("INSERT INTO user (id, name, email, created_at, updated_at) VALUES ('a', 'a', 'a@test.invalid', 0, 0)");
	const bill = (title: string) =>
		Number(
			sqlite
				.prepare("INSERT INTO bills (user_id, committee_id, kind, status, rev, next_rev, title, affected, side_effects, created_at, updated_at, proposed_at) VALUES ('a', 1, 'amend', 'proposed', 1, 2, ?, 'x', 'y', 0, 0, 0)")
				.run(title).lastInsertRowid
		);
	const result = (id: number, session: string, outcome: string) =>
		sqlite
			.prepare('INSERT INTO bill_results (session_key, bill_id, outcome, yes, no, abstain, ref_yes, ref_no, ref_abstain, participants, quorum, rev, settled_at) VALUES (?, ?, ?, 7, 2, 1, 0, 0, 0, 10, 10, 1, 0)')
			.run(session, id, outcome);
	const review = (id: number, session: string, status: string) =>
		sqlite.prepare("INSERT INTO vote_reviews (session_key, bill_id, signals, detail, status, created_at) VALUES (?, ?, '[]', '{}', ?, 0)").run(session, id, status);
	const older = bill('前の会期の可決');
	const newer = bill('次の会期の可決');
	const rejected = bill('否決');
	const reviewing = bill('確認中');
	const voided = bill('無効');
	const noted = bill('記録だけ');
	result(older, '2041-04', 'passed');
	result(newer, '2041-05', 'passed');
	result(rejected, '2041-05', 'rejected');
	result(reviewing, '2041-05', 'passed');
	review(reviewing, '2041-05', 'open');
	result(voided, '2041-05', 'passed');
	review(voided, '2041-05', 'voided');
	result(noted, '2041-04', 'passed');
	review(noted, '2041-04', 'noted');
	const { rows, total } = await passedBills(db, 1);
	expect(rows.map((r) => r.title)).toEqual(['次の会期の可決', '記録だけ', '前の会期の可決']);
	expect(total).toBe(3);
});
