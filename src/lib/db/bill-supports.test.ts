// Issue #49 基準5・7：発議要件と今月の参加者、賛同の持ち越し（設計書 docs/spec/49.md）。
// 60人以上の参加者は画面のテストでは作らず、ここで確かめる
import { beforeAll, describe, expect, test } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { openMemoryDb } from './memory';
import type { Db } from '../server/law';
import { billById, listBills, proposeBill, sessionParticipants, setBillSupport } from '../server/bills';
import { proposalRequirement } from '../domain/bills';
import { sessionAt } from '../domain/session';

let sqlite: DatabaseSync;
let db: Db;
const run = (sql: string, ...p: (string | number | null)[]) => sqlite.prepare(sql).run(...p);
const actor = (userId: string) => ({ userId, registeredAt: 0, ipHash: `ip-${userId}` });
const action = (kind: string, user: string, at: number) => run('INSERT INTO actions (kind, user_id, ip_hash, created_at) VALUES (?, ?, ?, ?)', kind, user, 'x', at);
/** 日本時間の2030年 m 月の会期（カレンダーの月） */
const month = (m: number) => sessionAt(Date.UTC(2030, m - 1, 10), null);

beforeAll(() => {
	({ sqlite, db } = openMemoryDb());
	for (let i = 0; i < 70; i++) run('INSERT INTO user (id, name, email, created_at, updated_at) VALUES (?, ?, ?, 0, 0)', `u${i}`, `u${i}`, `u${i}@test.invalid`);
});

let nextBill = 1;
const bill = (rev = 1, status = 'draft') => {
	const id = nextBill++;
	run("INSERT INTO bills (id, user_id, committee_id, kind, status, rev, next_rev, title, affected, side_effects, created_at, updated_at) VALUES (?, 'u0', 1, 'amend', ?, ?, ?, 't', 'a', 's', 0, 0)", id, status, rev, rev + 1);
	return id;
};

describe('発議要件', () => {
	test('基準5：5%を切り上げ、最低3人。一つ前の会期に行動した人を重ねずに数え、一度決まったら変わらない', async () => {
		for (const [n, required] of [[0, 3], [60, 3], [61, 4], [100, 5], [101, 6]]) expect(proposalRequirement(n), String(n)).toBe(required);

		const [prev, now] = [month(4), month(5)];
		// 数えるもの。u1 は2回行動しても1人
		const counted = ['issue_post', 'support_add', 'solution_post', 'reaction_add', 'bill_draft', 'bill_save', 'bill_support_add', 'bill_propose'];
		counted.forEach((kind, i) => action(kind, `u${i + 1}`, prev.startsAt + i));
		action('issue_post', 'u1', prev.startsAt + 100);
		// 数えないもの
		for (const kind of ['support_remove', 'reaction_remove', 'bill_support_remove', 'violation']) action(kind, 'u20', prev.startsAt + 1);
		// 範囲の端：前の会期の始まりは入り、前の会期の終わり（いまの会期の始まり）とその前の会期は入らない
		action('issue_post', 'u21', prev.startsAt);
		action('issue_post', 'u22', prev.endsAt);
		action('issue_post', 'u23', prev.startsAt - 1);

		expect(await sessionParticipants(db, 1, now, prev, now.startsAt)).toBe(counted.length + 1);
		// 一度決まったら、あとから行動の記録が増えても変わらない
		action('issue_post', 'u24', prev.startsAt + 200);
		expect(await sessionParticipants(db, 1, now, prev, now.startsAt + 1000)).toBe(counted.length + 1);
		// 前の会期に誰もいなければ0人（発議要件は最低の3人）
		const [before, empty] = [month(1), month(2)];
		expect(await sessionParticipants(db, 1, empty, before, empty.startsAt)).toBe(0);
	});
});

describe('賛同の持ち越し', () => {
	test('基準7：前の会期の賛同を次の会期でも数え、押した会期の発議要件と比べる', async () => {
		const id = bill();
		// 7月に3人が賛同する
		const [june, july, august] = [month(6), month(7), month(8)];
		for (const u of ['u1', 'u2', 'u3']) expect((await setBillSupport(db, actor(u), id, 1, 'add', july.startsAt + 1)).ok).toBe(true);
		// 8月の発議要件は、7月に行動した人の数で決まる（61人で4人）
		for (let i = 4; i < 62; i++) action('issue_post', `u${i}`, july.startsAt + 2);
		const required = proposalRequirement(await sessionParticipants(db, 1, august, july, august.startsAt));
		expect(required).toBe(4);
		// 7月の賛同3人は持ち越されるが、8月の4人には足りない
		expect(await proposeBill(db, actor('u0'), id, 1, required, august.startsAt + 1)).toEqual({ ok: false, reason: 'short' });
		expect((await setBillSupport(db, actor('u4'), id, 1, 'add', august.startsAt + 2)).ok).toBe(true);
		expect(await proposeBill(db, actor('u0'), id, 1, required, august.startsAt + 3)).toEqual({ ok: true });
		expect(sqlite.prepare('SELECT status, proposed_at FROM bills WHERE id = ?').get(id)).toMatchObject({ status: 'proposed', proposed_at: august.startsAt + 3 });
	});

	test('信頼の境界：作りかけ（rev = 0）の法案には賛同も発議もできない', async () => {
		const id = bill(0);
		expect(await setBillSupport(db, actor('u1'), id, 0, 'add', 1)).toEqual({ ok: false, reason: 'closed' });
		expect(await proposeBill(db, actor('u0'), id, 1, 0, 1)).toEqual({ ok: false, reason: 'closed' });
		// 送り先の 404 は billById が undefined を返すことに頼る
		expect(await billById(db, id)).toBeUndefined();
	});

	// Issue #49 のレビューの Blocker：一覧の数が古い版の賛同も数えていた
	test('基準6・9：一覧の賛同の数は、いまの版の賛同だけを数える', async () => {
		const id = bill(1);
		const count = async () => (await listBills(db, 'shitagaki', 1, 0)).rows.find((r) => r.id === id)?.supports;
		for (const u of ['u1', 'u2']) expect((await setBillSupport(db, actor(u), id, 1, 'add', 1)).ok).toBe(true);
		expect(await count()).toBe(2);
		// 保存して版が変わると0人に戻る
		run('UPDATE bills SET rev = 2, next_rev = 3 WHERE id = ?', id);
		expect(await count()).toBe(0);
		// 同じ人が賛同し直しても1人
		expect((await setBillSupport(db, actor('u1'), id, 2, 'add', 2)).ok).toBe(true);
		expect(await count()).toBe(1);
	});
});
