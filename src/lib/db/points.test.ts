// Issue #168 のレビューの指摘：同じ論点を同じ時刻に2回閉じても、記録は1行で、2回目は「もう閉じた」。画面は e2e/ronten.spec.ts
import { expect, test } from 'vitest';
import { openMemoryDb } from './memory';
import { closePoint, openPoint } from '../server/points';

test('同じ論点を同じ時刻に2回閉じると、2回目は記録を書かずに closed を返す。同じ時刻に2回立てると、論点と記録が1つずつ入る', async () => {
	const { sqlite, db } = openMemoryDb();
	const now = Date.parse('2047-05-16T09:00:00+09:00');
	const run = (q: string, ...p: (string | number | null)[]) => sqlite.prepare(q).run(...p);
	run("INSERT INTO user (id, name, email, created_at, updated_at) VALUES ('author', 'author', 'author@test.invalid', 0, 0)");
	const bill = Number(
		run(
			"INSERT INTO bills (user_id, committee_id, kind, status, rev, next_rev, proposed_rev, title, affected, side_effects, created_at, updated_at, proposed_at) VALUES ('author', 1, 'amend', 'proposed', 1, 2, 1, '法案', 'a', 's', 0, 0, ?)",
			now
		).lastInsertRowid
	);
	const staff = { userId: 'op', role: 'operator' as const };
	await Promise.all([openPoint(db, bill, '同じ見出し', staff, now), openPoint(db, bill, '同じ見出し', staff, now)]);
	const logs = (action: string) => (sqlite.prepare('SELECT count(*) AS n FROM bill_moderation_logs WHERE action = ?').get(action) as { n: number }).n;
	expect((sqlite.prepare('SELECT count(*) AS n FROM bill_points WHERE bill_id = ?').get(bill) as { n: number }).n).toBe(2);
	expect(logs('point_open')).toBe(2);

	// 2つの要求が、どちらも開いている論点を読んでから閉じる（同じミリ秒）
	const results = await Promise.all([closePoint(db, bill, 1, staff, now), closePoint(db, bill, 1, staff, now)]);
	expect(results.sort()).toEqual(['closed', 'ok']);
	expect(logs('point_close')).toBe(1);
});
