// Issue #25 基準7・8：レート制限と締め出し（設計書 docs/spec/25.md 決めたこと10・11）。
// D1 と同じ SQL を node:sqlite に流し、時刻を引数で動かして確かめる
import { beforeEach, expect, test } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { openMemoryDb } from '../db/memory';
import type { Db } from './law';
import { activeBan, createIssue, setSupport, type Actor } from './issues';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const T0 = Date.UTC(2026, 10, 3, 3, 0);

let sqlite: DatabaseSync;
let db: Db;
let users = 0;

beforeEach(() => {
	({ sqlite, db } = openMemoryDb());
	users = 0;
});

/** 登録した時刻を決めて利用者を作る（既定は2日前＝新しいアカウントの制限に当たらない） */
function actor(ipHash = 'ip-a', registeredAt = T0 - 2 * DAY): Actor {
	const id = `u${++users}`;
	sqlite.prepare('INSERT INTO user (id, name, email, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(
		id,
		`参加者${id}`,
		`${id}@test.invalid`,
		registeredAt,
		registeredAt
	);
	return { userId: id, registeredAt, ipHash };
}

const value = (n: number) => ({ title: `課題${n}`, affected: '困っている人', example: '具体例', topicId: 1 });
const post = (a: Actor, at: number, n = 0) => createIssue(db, a, value(n), at);
const count = (sql: string, ...p: string[]) => (sqlite.prepare(sql).get(...p) as { n: number }).n;

test('基準7：課題の投稿の上限（アカウント24時間5件、登録から24時間は1件、回線24時間20件）', async () => {
	// アカウント：5件まで。6件目は断る。最初の投稿から24時間たてば書ける
	const a = actor('ip-1');
	for (let i = 0; i < 5; i++) expect(await post(a, T0 + i * MIN, i)).toMatchObject({ ok: true });
	expect(await post(a, T0 + 10 * MIN)).toEqual({ ok: false, refusal: { kind: 'post-account' } });
	expect(await post(a, T0 + DAY + 1)).toMatchObject({ ok: true });

	// 登録から24時間：1件まで。断るときは次に書ける時刻（登録から24時間）を返す。違反には数えない
	const fresh = actor('ip-2', T0);
	expect(await post(fresh, T0 + HOUR)).toMatchObject({ ok: true });
	for (let i = 0; i < 3; i++) {
		expect(await post(fresh, T0 + 2 * HOUR + i)).toEqual({ ok: false, refusal: { kind: 'post-new', retryAt: T0 + DAY } });
	}
	expect(await activeBan(db, fresh.userId, T0 + 3 * HOUR)).toBeNull();
	expect(await post(fresh, T0 + DAY + 1)).toMatchObject({ ok: true });

	// 回線：20件まで。21件目は別のアカウントでも断る。違反には数えない
	const shared = Array.from({ length: 5 }, () => actor('ip-3'));
	for (const [i, s] of shared.slice(0, 4).entries()) {
		for (let j = 0; j < 5; j++) expect(await post(s, T0 + i * 10 * MIN + j)).toMatchObject({ ok: true });
	}
	for (let i = 0; i < 3; i++) {
		expect(await post(shared[4], T0 + HOUR + i)).toEqual({ ok: false, refusal: { kind: 'post-ip' } });
	}
	expect(await activeBan(db, shared[4].userId, T0 + 2 * HOUR)).toBeNull();
	expect(count("SELECT count(*) AS n FROM actions WHERE kind = 'violation'")).toBe(1);
});

test('基準7：「わかる」の上限（24時間50回・5分10回、付けるのも外すのも1回）と、同じ課題に同じ回線から3アカウント', async () => {
	const author = actor('ip-0');
	const created = await post(author, T0);
	if (!created.ok) throw new Error('課題を作れない');
	const id = created.id;

	// 5分に10回まで。11回目は断る。5分たてば押せる
	const a = actor('ip-a');
	for (let i = 0; i < 10; i++) {
		expect(await setSupport(db, a, id, i % 2 ? 'remove' : 'add', T0 + i * 1000)).toMatchObject({ ok: true });
	}
	expect(await setSupport(db, a, id, 'add', T0 + 20_000)).toEqual({ ok: false, refusal: { kind: 'support-burst' } });
	expect(await setSupport(db, a, id, 'add', T0 + 5 * MIN + 1)).toMatchObject({ ok: true, supported: true, count: 1 });

	// 同じ状態への操作は数えない（付いているのに add、付いていないのに remove）
	const before = count("SELECT count(*) AS n FROM actions WHERE user_id = ? AND kind LIKE 'support_%'", a.userId);
	expect(await setSupport(db, a, id, 'add', T0 + 6 * MIN)).toMatchObject({ ok: true, supported: true, count: 1 });
	expect(count("SELECT count(*) AS n FROM actions WHERE user_id = ? AND kind LIKE 'support_%'", a.userId)).toBe(before);

	// 24時間に50回まで（5分に10回を超えないよう31秒おきに押す）
	const b = actor('ip-b');
	for (let i = 0; i < 50; i++) {
		expect(await setSupport(db, b, id, i % 2 ? 'remove' : 'add', T0 + i * 31_000)).toMatchObject({ ok: true });
	}
	expect(await setSupport(db, b, id, 'add', T0 + 50 * 31_000)).toEqual({ ok: false, refusal: { kind: 'support-day' } });

	// 同じ課題に同じ回線から：3アカウントまで。4人目は断る（違反に数えない）。付けた本人の付け直しと取り消しは断らない
	const c = Array.from({ length: 4 }, () => actor('ip-c'));
	for (const x of c.slice(0, 3)) expect(await setSupport(db, x, id, 'add', T0)).toMatchObject({ ok: true });
	expect(await setSupport(db, c[3], id, 'add', T0 + 1)).toEqual({ ok: false, refusal: { kind: 'support-ip' } });
	expect(await setSupport(db, c[0], id, 'remove', T0 + 2)).toMatchObject({ ok: true, supported: false });
	expect(await setSupport(db, c[0], id, 'add', T0 + 3)).toMatchObject({ ok: true, supported: true });
	// 別の回線で付けていた人が、この回線から付け直すのも断らない
	const moved = { ...c[1], ipHash: 'ip-d' };
	expect(await setSupport(db, moved, id, 'remove', T0 + 4)).toMatchObject({ ok: true });
	expect(await setSupport(db, { ...moved, ipHash: 'ip-c' }, id, 'add', T0 + 5)).toMatchObject({ ok: true });
	expect(count("SELECT count(*) AS n FROM actions WHERE kind = 'violation' AND user_id = ?", c[3].userId)).toBe(0);
	// 24時間たてば4人目も付けられる
	expect(await setSupport(db, c[3], id, 'add', T0 + DAY + 10)).toMatchObject({ ok: true });
});

test('基準8：アカウントの違反が24時間に3回で、そのアカウントを24時間締め出す。期限が来たら解ける。回線は締め出さない', async () => {
	const a = actor('ip-x');
	for (let i = 0; i < 5; i++) await post(a, T0 + i, i);
	// 違反2回では締め出さない
	await post(a, T0 + HOUR);
	await post(a, T0 + 2 * HOUR);
	expect(await activeBan(db, a.userId, T0 + 2 * HOUR + 1)).toBeNull();
	// 3回目の時刻から24時間
	const third = T0 + 3 * HOUR;
	await post(a, third);
	expect(await activeBan(db, a.userId, third + 1)).toBe(third + DAY);
	expect(await activeBan(db, a.userId, third + DAY - 1)).toBe(third + DAY);
	expect(await activeBan(db, a.userId, third + DAY)).toBeNull();

	// 同じ回線の別のアカウントは締め出されない
	const neighbor = actor('ip-x');
	expect(await activeBan(db, neighbor.userId, third + 1)).toBeNull();
	expect(await post(neighbor, third + 1)).toMatchObject({ ok: true });

	// 24時間より前の違反は数えない
	const b = actor('ip-y');
	for (let i = 0; i < 5; i++) await post(b, T0 + i, i);
	await post(b, T0 + HOUR);
	await post(b, T0 + 2 * HOUR);
	for (let i = 0; i < 5; i++) expect(await post(b, T0 + DAY + 10 + i, i)).toMatchObject({ ok: true });
	// 3回目の違反。1回目（T0 + 1時間）から24時間を過ぎているので、数えるのは2回
	expect(await post(b, T0 + DAY + HOUR + 1)).toMatchObject({ ok: false });
	expect(await activeBan(db, b.userId, T0 + DAY + HOUR + 2)).toBeNull();

	// 「わかる」の違反も同じく数える
	const created = await post(neighbor, third + 2);
	if (!created.ok) throw new Error('課題を作れない');
	const c = actor('ip-z');
	for (let i = 0; i < 10; i++) await setSupport(db, c, created.id, i % 2 ? 'remove' : 'add', T0 + i);
	for (let i = 0; i < 3; i++) await setSupport(db, c, created.id, 'add', T0 + 10 + i);
	expect(await activeBan(db, c.userId, T0 + 20)).toBe(T0 + 12 + DAY);
});
