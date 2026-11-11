// Issue #152 基準5：専門家の解説の通報で見えなくなる条件（質疑・修正案と同じ。HIDE_THRESHOLD・countsTowardHide・involvedSql）。画面は e2e/kaisetsu.spec.ts
import { expect, test } from 'vitest';
import { openMemoryDb } from './memory';
import { reportCommentary, writeCommentary } from '../server/commentaries';

const DAY = 24 * 60 * 60 * 1000;

test('別々の3人の通報で一時的に見えなくなる。法案の賛同者の通報と、登録から24時間たっていない人の通報は数えない', async () => {
	const { sqlite, db } = openMemoryDb();
	const now = Date.parse('2047-05-15T09:00:00+09:00');
	const run = (q: string, ...p: (string | number | null)[]) => sqlite.prepare(q).run(...p);
	for (const id of ['author', 'expert', 'supporter', 'r1', 'r2', 'r3', 'fresh']) run('INSERT INTO user (id, name, email, created_at, updated_at) VALUES (?, ?, ?, 0, 0)', id, id, `${id}@test.invalid`);
	const bill = Number(
		run(
			"INSERT INTO bills (user_id, committee_id, kind, status, rev, next_rev, proposed_rev, title, affected, side_effects, created_at, updated_at, proposed_at) VALUES ('author', 1, 'amend', 'proposed', 1, 2, 1, '法案', 'a', 's', 0, 0, ?)",
			now - 10 * DAY
		).lastInsertRowid
	);
	run("INSERT INTO bill_supports (bill_id, user_id, rev, created_at) VALUES (?, 'supporter', 1, 0)", bill);
	const id = await writeCommentary(db, { billId: bill, userId: 'expert', body: '解説の本文' }, now);
	const status = () => (sqlite.prepare('SELECT moderation_status AS s FROM expert_commentaries WHERE id = ?').get(id) as { s: string }).s;
	const report = (userId: string, registeredAt = 0) => reportCommentary(db, { userId, registeredAt, ipHash: `ip-${userId}` }, { id, billId: bill }, { reason: 'spam', note: null }, now);

	await report('supporter');
	await report('r1');
	await report('r2');
	await report('fresh', now - DAY / 2);
	expect(status()).toBe('visible');
	await report('r3');
	expect(status()).toBe('auto_hidden');
	// 運営の記録に、自動で非表示にしたことが残る
	expect(sqlite.prepare('SELECT action, actor FROM bill_moderation_logs WHERE commentary_id = ?').all(id)).toEqual([{ action: 'auto_hide', actor: 'auto' }]);
});
