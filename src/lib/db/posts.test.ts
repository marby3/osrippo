// Issue #66 基準6・8：立場の回数と履歴、質疑の上限（設計書 docs/spec/66.md）
import { beforeAll, expect, test } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { openMemoryDb } from './memory';
import type { Db } from '../server/law';
import { isSupporter, setStance, stanceOf } from '../server/posts';
import { sessionAt } from '../domain/session';
import { checkBillPost, COUNTS_AS_VIOLATION, LIMITS } from '../domain/limits';

let sqlite: DatabaseSync;
let db: Db;
const session = sessionAt(Date.parse('2046-05-10T00:00:00+09:00'), null);
const actor = { userId: 'u1', registeredAt: 0, ipHash: 'ip' };

beforeAll(() => {
	({ sqlite, db } = openMemoryDb());
	sqlite.exec("INSERT INTO user (id, name, email, created_at, updated_at) VALUES ('u1', 'u1', 'u1@test.invalid', 0, 0)");
	sqlite.exec("INSERT INTO bills (id, user_id, committee_id, kind, status, rev, next_rev, title, affected, side_effects, created_at, updated_at) VALUES (1, 'u1', 1, 'amend', 'proposed', 1, 2, 't', 'a', 's', 0, 0)");
});

test('基準6：未定のままなら何も起きない。最初の選択は数えず2回変えられ、3回目は断る。変わったときだけ履歴と記録が残る', async () => {
	const set = (stance: 'for' | 'against' | 'undecided', now: number) => setStance(db, actor, { id: 1 }, session, stance, now);
	const log = () => sqlite.prepare('SELECT stance, created_at FROM stance_log ORDER BY id').all().map((r) => ({ ...r }));
	const records = () => (sqlite.prepare("SELECT count(*) AS n FROM actions WHERE kind = 'stance_set'").get() as { n: number }).n;

	expect(await stanceOf(db, session.key, 1, 'u1')).toEqual({ stance: 'undecided', left: 2 });
	expect(await set('undecided', 1)).toEqual({ ok: true, changed: false });
	expect(await stanceOf(db, session.key, 1, 'u1')).toEqual({ stance: 'undecided', left: 2 });
	expect(log()).toEqual([]);

	expect(await set('for', 2)).toEqual({ ok: true, changed: true });
	expect(await stanceOf(db, session.key, 1, 'u1')).toEqual({ stance: 'for', left: 2 });
	// 同じ立場は数えない
	expect(await set('for', 3)).toEqual({ ok: true, changed: false });

	expect(await set('against', 4)).toEqual({ ok: true, changed: true });
	expect(await stanceOf(db, session.key, 1, 'u1')).toEqual({ stance: 'against', left: 1 });
	expect(await set('undecided', 5)).toEqual({ ok: true, changed: true });
	expect(await stanceOf(db, session.key, 1, 'u1')).toEqual({ stance: 'undecided', left: 0 });

	expect(await set('for', 6)).toEqual({ ok: false, reason: 'limit' });
	expect(await set('undecided', 7)).toEqual({ ok: true, changed: false });
	expect(await stanceOf(db, session.key, 1, 'u1')).toEqual({ stance: 'undecided', left: 0 });

	expect(log()).toEqual([
		{ stance: 'for', created_at: 2 },
		{ stance: 'against', created_at: 4 },
		{ stance: 'undecided', created_at: 5 }
	]);
	expect(records()).toBe(3);
});

test('基準8：1アカウント24時間に質疑10・答弁30・補足10、合わせて5分に10回、1回線は24時間に60回。アカウントの上限は違反に数え、回線は数えない', () => {
	const ok = { accountDay: 0, accountBurst: 0, ipDay: 0 };
	const check = (kind: 'question' | 'answer' | 'supplement', c: Partial<typeof ok>) => checkBillPost(kind, { ...ok, ...c })?.kind ?? null;
	expect(LIMITS.billPostPerBurst).toBe(10);
	for (const [kind, limit, refusal] of [
		['question', 10, 'question-day'],
		['answer', 30, 'answer-day'],
		['supplement', 10, 'supplement-day']
	] as const) {
		expect(check(kind, { accountDay: limit - 1 })).toBeNull();
		expect(check(kind, { accountDay: limit })).toBe(refusal);
		expect(COUNTS_AS_VIOLATION[refusal]).toBe(true);
	}
	expect(check('answer', { accountBurst: 9 })).toBeNull();
	expect(check('answer', { accountBurst: 10 })).toBe('bill-post-burst');
	expect(COUNTS_AS_VIOLATION['bill-post-burst']).toBe(true);
	expect(check('answer', { ipDay: 59 })).toBeNull();
	expect(check('answer', { ipDay: 60 })).toBe('bill-post-ip');
	expect(COUNTS_AS_VIOLATION['bill-post-ip']).toBe(false);
});

test('基準3：賛同者は、いまの版に賛同した人だけ。直される前の版にだけ賛同した人は答弁できる賛同者にならない', async () => {
	sqlite.exec("INSERT INTO user (id, name, email, created_at, updated_at) VALUES ('u2', 'u2', 'u2@test.invalid', 0, 0), ('u3', 'u3', 'u3@test.invalid', 0, 0)");
	sqlite.exec("INSERT INTO bills (id, user_id, committee_id, kind, status, rev, next_rev, title, affected, side_effects, created_at, updated_at) VALUES (2, 'u1', 1, 'amend', 'proposed', 2, 3, 't', 'a', 's', 0, 0)");
	sqlite.exec("INSERT INTO bill_supports (bill_id, rev, user_id, created_at) VALUES (2, 1, 'u2', 0), (2, 2, 'u3', 0)");
	expect(await isSupporter(db, { id: 2, rev: 2 }, 'u2')).toBe(false);
	expect(await isSupporter(db, { id: 2, rev: 2 }, 'u3')).toBe(true);
});
