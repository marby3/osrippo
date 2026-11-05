// Issue #67 基準5・6・7・8 の DB の側（設計書 docs/spec/67.md 決めたこと2・4・6・8）
import { beforeAll, expect, test } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { openMemoryDb } from './memory';
import type { Db } from '../server/law';
import { createPost, setStance } from '../server/posts';
import { evaluationTarget, recordViews, sessionPostScores, setEvaluation } from '../server/evaluations';

let sqlite: DatabaseSync;
let db: Db;
const SESSION = '2046-05';
const actor = (userId: string) => ({ userId, registeredAt: 0, ipHash: `ip-${userId}` });
const bill1 = { id: 1, sessionKey: SESSION };
const bill2 = { id: 2, sessionKey: SESSION };

/** 行を直接足す（立場は引数のとおり）。createPost の確かめは基準7のテストでだけ通す */
function addPost(billId: number, userId: string, kind: 'question' | 'answer' = 'question', parentId: number | null = null, status = 'visible') {
	const { lastInsertRowid } = sqlite
		.prepare('INSERT INTO posts (bill_id, session_key, kind, parent_id, user_id, role, body, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)')
		.run(billId, SESSION, kind, parentId, userId, kind === 'answer' ? 'author' : null, 'b', status);
	return Number(lastInsertRowid);
}
const view = (postId: number, userId: string) =>
	sqlite.prepare('SELECT stance FROM post_views WHERE post_id = ? AND user_id = ?').all(postId, userId).map((r) => (r as { stance: string }).stance);
const evaluation = (postId: number, userId: string, kind = 'reasonable') =>
	sqlite.prepare('SELECT stance, created_at FROM evaluations WHERE post_id = ? AND user_id = ? AND kind = ?').all(postId, userId, kind).map((r) => ({ ...r }));
const records = (userId: string, kind: string) => (sqlite.prepare('SELECT count(*) AS n FROM actions WHERE user_id = ? AND kind = ?').get(userId, kind) as { n: number }).n;
const stance = (userId: string, s: 'for' | 'against' | 'undecided', now = 1) => setStance(db, actor(userId), { id: 1 }, { key: SESSION }, s, now);

beforeAll(() => {
	({ sqlite, db } = openMemoryDb());
	for (const u of ['t', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'author', 'supporter']) {
		sqlite.exec(`INSERT INTO user (id, name, email, created_at, updated_at) VALUES ('${u}', '${u}', '${u}@test.invalid', 0, 0)`);
	}
	for (const id of [1, 2]) {
		sqlite.exec(`INSERT INTO bills (id, user_id, committee_id, kind, status, rev, next_rev, title, affected, side_effects, created_at, updated_at) VALUES (${id}, 'author', 1, 'amend', 'proposed', 1, 2, 't', 'a', 's', 0, 0)`);
	}
});

test('基準5：押した時点の立場が残り、考えを変えても変わらない。取り消して押し直すと押し直した時点の立場。読む前に押したら読んだことになる。記録は行が変わったときだけ', async () => {
	const post = { id: addPost(1, 't'), billId: 1, sessionKey: SESSION };
	await stance('a', 'against');
	expect(view(post.id, 'a')).toEqual([]);

	expect(await setEvaluation(db, actor('a'), post, 'reasonable', 'add', null, 10)).toEqual({ ok: true, changed: true });
	expect(evaluation(post.id, 'a')).toEqual([{ stance: 'against', created_at: 10 }]);
	expect(view(post.id, 'a')).toEqual(['against']);

	await stance('a', 'for', 11);
	expect(evaluation(post.id, 'a')).toEqual([{ stance: 'against', created_at: 10 }]);

	// 同じ操作は何も変えない
	expect(await setEvaluation(db, actor('a'), post, 'reasonable', 'add', null, 12)).toEqual({ ok: true, changed: false });
	expect(evaluation(post.id, 'a')).toEqual([{ stance: 'against', created_at: 10 }]);
	expect(records('a', 'evaluation_add')).toBe(1);

	expect(await setEvaluation(db, actor('a'), post, 'reasonable', 'remove', null, 13)).toEqual({ ok: true, changed: true });
	expect(evaluation(post.id, 'a')).toEqual([]);
	expect(await setEvaluation(db, actor('a'), post, 'reasonable', 'remove', null, 14)).toEqual({ ok: true, changed: false });
	expect(records('a', 'evaluation_remove')).toBe(1);
	// 取り消しても読んだ記録は残り、読んだ時点の立場のまま
	expect(view(post.id, 'a')).toEqual(['against']);

	await setEvaluation(db, actor('a'), post, 'reasonable', 'add', null, 15);
	expect(evaluation(post.id, 'a')).toEqual([{ stance: 'for', created_at: 15 }]);
	expect(view(post.id, 'a')).toEqual(['against']);

	// 「考えが変わった」は別の行
	await setEvaluation(db, actor('a'), post, 'changed', 'add', null, 16);
	expect(evaluation(post.id, 'a', 'changed')).toEqual([{ stance: 'for', created_at: 16 }]);
	expect(evaluation(post.id, 'a')).toEqual([{ stance: 'for', created_at: 15 }]);

	// 立場の行がない人は未定。提出者と賛同者は賛成寄り
	await setEvaluation(db, actor('b'), post, 'reasonable', 'add', null, 17);
	expect(evaluation(post.id, 'b')).toEqual([{ stance: 'undecided', created_at: 17 }]);
	await setEvaluation(db, actor('supporter'), post, 'reasonable', 'add', 'supporter', 18);
	expect(evaluation(post.id, 'supporter')).toEqual([{ stance: 'for', created_at: 18 }]);
	expect(view(post.id, 'supporter')).toEqual(['for']);
});

test('基準6：読んだ時点の立場で1行だけ残り、読み直しても変わらない。自分の投稿、ほかの法案、答弁のある質疑、非表示は記録しない', async () => {
	const open = addPost(1, 't');
	const answered = addPost(1, 't');
	const answer = addPost(1, 't', 'answer', answered);
	const own = addPost(1, 'c');
	const other = addPost(2, 't');
	const hidden = addPost(1, 't', 'question', null, 'hidden');
	const ids = [open, answered, answer, own, other, hidden];

	await stance('c', 'against');
	await recordViews(db, 'c', bill1, ids, null, 20);
	expect(view(open, 'c')).toEqual(['against']);
	expect(view(answer, 'c')).toEqual(['against']);
	expect(view(answered, 'c')).toEqual([]);
	expect(view(own, 'c')).toEqual([]);
	expect(view(other, 'c')).toEqual([]);
	expect(view(hidden, 'c')).toEqual([]);

	await stance('c', 'for', 21);
	await recordViews(db, 'c', bill1, ids, null, 22);
	expect(view(open, 'c')).toEqual(['against']);

	// 答弁がつく前に読んだ行は残す
	const before = addPost(1, 't');
	await recordViews(db, 'c', bill1, [before], null, 23);
	addPost(1, 't', 'answer', before);
	expect(view(before, 'c')).toEqual(['for']);

	// 読むだけでは今月の参加者に数えない（記録を足さない）
	expect((sqlite.prepare("SELECT count(*) AS n FROM actions WHERE user_id = 'c' AND kind NOT IN ('stance_set')").get() as { n: number }).n).toBe(0);

	// 立場の行のない人は未定。提出者と賛同者は賛成寄り
	await recordViews(db, 'd', bill1, [open], null, 24);
	expect(view(open, 'd')).toEqual(['undecided']);
	await recordViews(db, 'author', bill1, [open], 'author', 25);
	expect(view(open, 'author')).toEqual(['for']);
	// 提出者が選んだ立場はそのまま
	await setStance(db, actor('author'), { id: 1 }, { key: SESSION }, 'against', 26);
	await recordViews(db, 'author', bill1, [answer], 'author', 27);
	expect(view(answer, 'author')).toEqual(['against']);
});

test('基準7：投稿者の立場は書いた時点で固定する。提出者と賛同者は未定なら賛成寄り', async () => {
	const write = async (userId: string, writerRole: 'author' | 'supporter' | null) => {
		const result = await createPost(db, actor(userId), { billId: 1, sessionKey: SESSION, kind: 'question', parentId: null, role: null, body: 'b' }, 30, writerRole);
		if (!result.ok) throw new Error('断られた');
		return (sqlite.prepare('SELECT stance FROM posts WHERE id = ?').get(result.id) as { stance: string }).stance;
	};
	expect(await write('e', null)).toBe('undecided');
	expect(await write('supporter', 'supporter')).toBe('for');

	await stance('f', 'against');
	const first = await createPost(db, actor('f'), { billId: 1, sessionKey: SESSION, kind: 'question', parentId: null, role: null, body: 'b' }, 31, null);
	if (!first.ok) throw new Error('断られた');
	await stance('f', 'for', 32);
	expect(sqlite.prepare('SELECT stance FROM posts WHERE id = ?').get(first.id)).toMatchObject({ stance: 'against' });

	// 提出者が反対寄りを選んでいれば、そのまま
	await setStance(db, actor('author'), { id: 1 }, { key: SESSION }, 'against', 33);
	expect(await write('author', 'author')).toBe('against');
});

test('基準8：同じ相手の上限は法案をまたいで数え、スコアと考えが変わったを投稿ごとに返す。誰が押したかを返さない', async () => {
	const key = '2046-07';
	const add = (billId: number) => {
		const { lastInsertRowid } = sqlite.prepare("INSERT INTO posts (bill_id, session_key, kind, user_id, body, stance, created_at) VALUES (?, ?, 'question', 'g', 'b', 'for', 0)").run(billId, key);
		return { id: Number(lastInsertRowid), billId, sessionKey: key };
	};
	const ps = [add(1), add(1), add(2), add(2)];
	sqlite.exec(`INSERT INTO stances (session_key, bill_id, user_id, stance, changes, updated_at) VALUES ('${key}', 1, 'h', 'against', 0, 0), ('${key}', 2, 'h', 'against', 0, 0)`);
	for (const [i, p] of ps.entries()) {
		await setEvaluation(db, actor('h'), p, 'reasonable', 'add', null, 40 + i);
		await setEvaluation(db, actor('h'), p, 'changed', 'add', null, 50 + i);
	}
	// 読んだ人をそろえる（評価不足にしない）
	const insert = sqlite.prepare("INSERT INTO post_views (post_id, user_id, stance, created_at) VALUES (?, ?, 'against', 0)");
	for (const p of ps) for (const u of ['a', 'b', 'c']) insert.run(p.id, u);

	const scores = await sessionPostScores(db, key);
	expect(ps.map((p) => scores.get(p.id)?.changed)).toEqual([1, 1, 1, 0]);
	// 4件目（別の法案）は上限の外で、評価にも読んだ人にも数えない。同じ法案の3件目より低い
	const third = scores.get(ps[2].id)?.score as number;
	const fourth = scores.get(ps[3].id)?.score as number;
	expect(third).toBeGreaterThan(fourth);
	expect(Object.keys(scores.get(ps[0].id) ?? {}).sort()).toEqual(['changed', 'score']);
});

test('信頼の境界：評価できる投稿は、同じ法案の同じ会期の見える質疑と答弁だけ', async () => {
	const question = addPost(1, 't');
	const answer = addPost(1, 't', 'answer', question);
	const supplement = Number(sqlite.prepare("INSERT INTO posts (bill_id, session_key, kind, parent_id, user_id, body, created_at) VALUES (1, ?, 'supplement', ?, 't', 'b', 0)").run(SESSION, question).lastInsertRowid);
	const hidden = addPost(1, 't', 'question', null, 'hidden');
	expect(await evaluationTarget(db, question, bill1)).toMatchObject({ id: question, userId: 't' });
	expect(await evaluationTarget(db, answer, bill1)).toMatchObject({ id: answer });
	expect(await evaluationTarget(db, question, bill2)).toBeUndefined();
	expect(await evaluationTarget(db, question, { id: 1, sessionKey: '1999-01' })).toBeUndefined();
	expect(await evaluationTarget(db, supplement, bill1)).toBeUndefined();
	expect(await evaluationTarget(db, hidden, bill1)).toBeUndefined();
});
