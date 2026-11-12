// Issue #181：答弁イベントの質問と答弁のルール（通報で見えなくなる条件、「わたしも聞きたい」の回数の上限）。画面は e2e/toben-shitsumon.spec.ts
import { expect, test } from 'vitest';
import { openMemoryDb } from './memory';
import { askQuestion, reportToben, tobenEventFor, wantQuestion } from '../server/toben-questions';

const DAY = 24 * 60 * 60 * 1000;

function setup() {
	const { sqlite, db } = openMemoryDb();
	const now = Date.parse('2050-03-04T09:00:00+09:00');
	const run = (q: string, ...p: (string | number | null)[]) => sqlite.prepare(q).run(...p);
	for (const id of ['legislator', 'author', 'r1', 'r2', 'r3', 'fresh', 'v1', 'v2', 'v3', 'v4']) run('INSERT INTO user (id, name, email, created_at, updated_at) VALUES (?, ?, ?, 0, 0)', id, id, `${id}@test.invalid`);
	const event = Number(
		run(
			"INSERT INTO toben_events (user_id, target_kind, target_id, title, starts_at, ends_at, created_at) VALUES ('legislator', 'issue', 1, '回', ?, ?, ?)",
			now + 6 * DAY,
			now + 6 * DAY + 3600_000,
			now - DAY
		).lastInsertRowid
	);
	return { sqlite, db, now, event };
}

test('質問は別々の3人の通報で一時的に見えなくなる。登録から24時間たっていない人の通報は数えない。運営の記録に残る', async () => {
	const { sqlite, db, now, event } = setup();
	const asked = await askQuestion(db, { eventId: event, userId: 'author', body: '質問の本文' }, now);
	expect(asked.ok).toBe(true);
	const id = asked.ok ? asked.id : 0;
	const status = () => (sqlite.prepare('SELECT moderation_status AS s FROM toben_questions WHERE id = ?').get(id) as { s: string }).s;
	const report = (userId: string, registeredAt = 0) => reportToben(db, { userId, registeredAt, ipHash: `ip-${userId}` }, { kind: 'question', id, eventId: event }, { reason: 'spam', note: null }, now);

	await report('r1');
	await report('r2');
	await report('fresh', now - DAY / 2);
	expect(status()).toBe('visible');
	await report('r3');
	expect(status()).toBe('auto_hidden');
	expect(sqlite.prepare('SELECT target_kind AS kind, action, actor FROM toben_moderation_logs WHERE target_id = ?').all(id)).toEqual([{ kind: 'question', action: 'auto_hide', actor: 'auto' }]);
	// 自分の質問は通報できない
	expect(await report('author')).toMatchObject({ ok: false, reason: 'own' });
});

test('「わたしも聞きたい」は「わかる」と同じ上限：同じ回線から3つのアカウントまで', async () => {
	const { db, now, event } = setup();
	const asked = await askQuestion(db, { eventId: event, userId: 'author', body: '質問の本文' }, now);
	const id = asked.ok ? asked.id : 0;
	const want = (userId: string) => wantQuestion(db, { userId, registeredAt: 0, ipHash: 'same-ip' }, { eventId: event, questionId: id }, 'add', now);
	for (const v of ['v1', 'v2', 'v3']) expect(await want(v)).toEqual({ ok: true });
	expect(await want('v4')).toMatchObject({ ok: false, refusal: { kind: 'want-ip' } });
});

test('関係のない時期の選挙があっても、回は中止にならない（選挙の期間にかかる回だけが中止）', async () => {
	const { sqlite, db, now, event } = setup();
	const run = (q: string, ...p: (string | number | null)[]) => sqlite.prepare(q).run(...p);
	run("INSERT INTO elections (name, notice_date, vote_date, starts_at, ends_at, created_by, created_at) VALUES ('遠い選挙', 'x', 'x', ?, ?, 'legislator', 0)", now + 60 * DAY, now + 70 * DAY);
	expect((await tobenEventFor(db, event, now))?.state).toBe('upcoming');
	run("INSERT INTO elections (name, notice_date, vote_date, starts_at, ends_at, created_by, created_at) VALUES ('かかる選挙', 'x', 'x', ?, ?, 'legislator', 0)", now + 5 * DAY, now + 7 * DAY);
	expect((await tobenEventFor(db, event, now))?.state).toBe('stopped');
});
