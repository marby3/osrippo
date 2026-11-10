// Issue #149：議員ダッシュボードの「IF世界で可決」のタブの範囲（設計書 docs/spec/149.md の 3）。画面は e2e/giin.spec.ts
import { expect, test } from 'vitest';
import { openMemoryDb } from './memory';
import { passedBills, passedCount } from '../server/giin';

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
	const { rows } = await passedBills(db, 1);
	expect(rows.map((r) => r.title)).toEqual(['次の会期の可決', '記録だけ', '前の会期の可決']);
	expect(await passedCount(db)).toBe(3);
});

test('対象の法令は結果の版のものを順に、IF世界の法令の番号で返す（改正は法令の番号、制定は IF世界の法令の番号）', async () => {
	const { sqlite, db } = openMemoryDb();
	sqlite.exec(`
		INSERT INTO user (id, name, email, created_at, updated_at) VALUES ('a', 'a', 'a@test.invalid', 0, 0);
		INSERT INTO laws (id, title, law_num) VALUES ('L1', '消費者契約法', 'x');
		INSERT INTO law_revisions (id, law_id, branch, seq, enforcement_date, status) VALUES ('R1', 'L1', 'real', 1, '2000-01-01', 'enforced');
		INSERT INTO bills (id, user_id, committee_id, kind, status, rev, next_rev, title, affected, side_effects, created_at, updated_at, proposed_at) VALUES (1, 'a', 1, 'amend', 'proposed', 2, 3, '二つの法令の法案', 'x', 'y', 0, 0, 0);
		INSERT INTO bill_laws (bill_id, rev, seq, action, law_id, base_revision_id, new_title) VALUES (1, 1, 0, 'amend', 'L1', 'R1', NULL);
		INSERT INTO bill_laws (bill_id, rev, seq, action, law_id, base_revision_id, new_title) VALUES (1, 2, 0, 'amend', 'L1', 'R1', NULL);
		INSERT INTO bill_laws (bill_id, rev, seq, action, law_id, base_revision_id, new_title) VALUES (1, 2, 1, 'enact', NULL, NULL, '新しい法律');
		INSERT INTO if_laws (id, bill_id, bill_rev, title, session_key, created_at) VALUES ('if-1', 1, 2, '新しい法律', '2041-05', 0);
		INSERT INTO bill_results (session_key, bill_id, outcome, yes, no, abstain, ref_yes, ref_no, ref_abstain, participants, quorum, rev, settled_at) VALUES ('2041-05', 1, 'passed', 7, 2, 1, 0, 0, 0, 10, 10, 2, 0);
	`);
	const { rows } = await passedBills(db, 1);
	expect(rows).toEqual([{ id: 1, title: '二つの法令の法案', sessionKey: '2041-05', laws: [{ id: 'L1', title: '消費者契約法' }, { id: 'if-1', title: '新しい法律' }] }]);
});

test('可決のあとにぶつかって要調整になった結果は出さない。直して次の会期に可決したら、その1行だけ', async () => {
	const { sqlite, db } = openMemoryDb();
	sqlite.exec(`
		INSERT INTO user (id, name, email, created_at, updated_at) VALUES ('a', 'a', 'a@test.invalid', 0, 0);
		INSERT INTO bills (id, user_id, committee_id, kind, status, rev, next_rev, title, affected, side_effects, created_at, updated_at, proposed_at) VALUES (1, 'a', 1, 'amend', 'proposed', 1, 2, 'ぶつかった法案', 'x', 'y', 0, 0, 0);
		INSERT INTO bill_results (session_key, bill_id, outcome, yes, no, abstain, ref_yes, ref_no, ref_abstain, participants, quorum, rev, settled_at) VALUES ('2041-05', 1, 'passed', 7, 2, 1, 0, 0, 0, 10, 10, 1, 0);
		INSERT INTO bill_adjustments (bill_id, session_key, reason, due_at, proposed_at, resolved_at, created_at) VALUES (1, '2041-05', 'article', 0, 0, 1, 0);
	`);
	expect((await passedBills(db, 1)).rows).toEqual([]);
	expect(await passedCount(db)).toBe(0);
	sqlite.exec(
		"INSERT INTO bill_results (session_key, bill_id, outcome, yes, no, abstain, ref_yes, ref_no, ref_abstain, participants, quorum, rev, settled_at) VALUES ('2041-06', 1, 'passed', 7, 2, 1, 0, 0, 0, 10, 10, 1, 0)"
	);
	expect((await passedBills(db, 1)).rows.map((r) => r.sessionKey)).toEqual(['2041-06']);
});
