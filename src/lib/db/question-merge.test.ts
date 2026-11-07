// Issue #104 基準1〜6：似た質疑をまとめる（設計書 docs/spec/104.md）。画面は e2e/shitsugi-matome.spec.ts
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { expect, test } from 'vitest';
import { HIDEABLE, RESTORABLE } from '../domain/reports';
import { sessionAt } from '../domain/session';
import { lastChairAction, standBlock } from '../server/chairs';
import { evaluationTarget, recordViews, sessionPostScores } from '../server/evaluations';
import { notificationPage } from '../server/notification-page';
import { billModerationLogPage, changePostStatus, checkMerge, hiddenPostsFor, mergeCandidates, mergedPostsFor, mergeQuestion, postStaffAccess, reportedPosts, reportPost } from '../server/post-moderation';
import { createPost, listQuestions, questionOf, questionTotal, waitingQuestions } from '../server/posts';
import { openMemoryDb, type MemoryDb } from './memory';

const SESSION = sessionAt(Date.parse('2030-05-10T00:00:00+09:00'), null);
const PREVIOUS = sessionAt(SESSION.startsAt - 1, null);
const NOW = SESSION.deliberationAt + 1000;
const STAFF = { userId: 'mod', role: 'moderator' as const };

function world() {
	const { sqlite, db } = openMemoryDb();
	sqlite.exec("INSERT OR IGNORE INTO committees (id, name) VALUES (1, '第1')");
	let counter = 0;
	const addUser = (id = `u${++counter}`, role: string | null = null) => {
		sqlite.prepare('INSERT INTO user (id, name, email, role, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 0)').run(id, id, `${id}@test.invalid`, role);
		return id;
	};
	addUser('author');
	addUser('mod', 'moderator');
	const addBill = (author = 'author', title = `法案${++counter}`) =>
		Number(
			sqlite
				.prepare("INSERT INTO bills (user_id, committee_id, kind, status, rev, next_rev, proposed_rev, title, affected, side_effects, created_at, updated_at, proposed_at) VALUES (?, 1, 'amend', 'proposed', 1, 2, 1, ?, '人', '副作用', 0, 0, ?)")
				.run(author, title, PREVIOUS.deliberationAt + 1).lastInsertRowid
		);
	const addPost = (bill: number, userId: string, kind: 'question' | 'answer' | 'supplement' = 'question', parent: number | null = null, body = `本文${++counter}`, sessionKey = SESSION.key) =>
		Number(
			sqlite
				.prepare('INSERT INTO posts (bill_id, session_key, kind, parent_id, user_id, role, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0)')
				.run(bill, sessionKey, kind, parent, userId, kind === 'answer' ? 'author' : null, body).lastInsertRowid
		);
	const actor = (userId: string) => ({ userId, registeredAt: 0, ipHash: `ip-${userId}` });
	const rowOf = (id: number) => ({ ...(sqlite.prepare('SELECT status, merged_into AS mergedInto, parent_id AS parentId, status_note AS note, status_actor AS actor FROM posts WHERE id = ?').get(id) as object) }) as { status: string; mergedInto: number | null; parentId: number | null; note: string | null; actor: string | null };
	const merge = (source: number, target: number, staff: { userId: string; role: 'moderator' | 'operator' | 'chair' | 'director' } = STAFF, at = NOW) => mergeQuestion(db, source, target, staff, 'まとめた理由', at);
	const check = (source: number, target: number, staff: { userId: string; role: 'moderator' | 'operator' | 'chair' | 'director' } = STAFF, now = NOW) => checkMerge(db, source, target, staff, now, null);
	const hide = (post: number, staff = STAFF, at = NOW) => changePostStatus(db, post, HIDEABLE, 'hidden', staff, 'attack', 'メモ', at);
	const restore = (post: number, at = NOW + 1) => changePostStatus(db, post, RESTORABLE, 'restored', STAFF, null, '問題なし', at);
	const inbox = (userId: string) => sqlite.prepare('SELECT kind, target_id AS target, ref_id AS ref FROM notifications WHERE user_id = ? ORDER BY id').all(userId).map((r) => ({ ...r }));
	return { sqlite, db: db as MemoryDb, addUser, addBill, addPost, actor, rowOf, merge, check, hide, restore, inbox };
}

test('基準1：0025 で列とトリガーが変わり、既存の行は残る。まとめると記録が merge で1行入る', () => {
	const old = new DatabaseSync(':memory:');
	old.exec('PRAGMA foreign_keys = ON');
	const dir = new URL('../../../drizzle/', import.meta.url);
	const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
	for (const f of files.filter((f) => f < '0025')) old.exec(readFileSync(new URL(f, dir), 'utf8'));
	old.exec(`
		INSERT INTO user (id, name, email, created_at, updated_at) VALUES ('u', 'u', 'u@test.invalid', 0, 0);
		INSERT OR IGNORE INTO committees (id, name) VALUES (1, '第1');
		INSERT INTO bills (id, user_id, committee_id, kind, status, rev, next_rev, title, affected, side_effects, created_at, updated_at) VALUES (1, 'u', 1, 'amend', 'proposed', 1, 2, 't', 'a', 's', 0, 0);
		INSERT INTO posts (id, bill_id, session_key, kind, user_id, body, created_at) VALUES (7, 1, 'k', 'question', 'u', 'もとの本文', 0);
		INSERT INTO posts (id, bill_id, session_key, kind, user_id, body, created_at) VALUES (8, 1, 'k', 'question', 'u', '統合先', 0);
	`);
	old.exec("UPDATE posts SET status = 'hidden', status_actor = 'operator', status_note = '隠す', status_changed_at = 1 WHERE id = 8");
	const later = files.filter((f) => f >= '0025');
	expect(later.length).toBeGreaterThan(0);
	for (const f of later) old.exec(readFileSync(new URL(f, dir), 'utf8'));

	expect({ ...old.prepare('SELECT body, status, merged_into FROM posts WHERE id = 7').get() }).toEqual({ body: 'もとの本文', status: 'visible', merged_into: null });
	expect(old.prepare('SELECT action FROM bill_moderation_logs').all().map((r) => r.action)).toEqual(['hide']);
	expect(old.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = 'posts_status_log'").all()).toHaveLength(1);

	old.exec("UPDATE posts SET status = 'merged', merged_into = 8, status_actor = 'chair', status_actor_user_id = 'u', status_reason = NULL, status_note = 'まとめた', status_changed_at = 5 WHERE id = 7");
	expect({ ...old.prepare('SELECT post_id, action, actor, note, merged_into, created_at FROM bill_moderation_logs ORDER BY id DESC').get() }).toEqual({ post_id: 7, action: 'merge', actor: 'chair', note: 'まとめた', merged_into: 8, created_at: 5 });
	// ほかの状態の記録は今までどおり
	old.exec("UPDATE posts SET status = 'restored', status_actor = 'operator', status_note = '戻す', status_changed_at = 6 WHERE id = 8");
	expect(old.prepare('SELECT action FROM bill_moderation_logs ORDER BY id').all().map((r) => r.action)).toEqual(['hide', 'merge', 'restore']);
});

test('基準2：答弁と補足が統合先に移り、元は一覧と数に出ず、まとめた数が出る。さらにまとめても1段になり、循環しない', async () => {
	const w = world();
	const { db } = w;
	const bill = w.addBill();
	const writer = w.addUser();
	const source = w.addPost(bill, writer);
	const answer = w.addPost(bill, 'author', 'answer', source, '移る答弁');
	const hiddenAnswer = w.addPost(bill, 'author', 'answer', source, '隠れたまま移る答弁');
	const supplement = w.addPost(bill, w.addUser(), 'supplement', source, '移る補足');
	await w.hide(hiddenAnswer);
	const target = w.addPost(bill, w.addUser());
	const read = async () => (await listQuestions(db, bill, null, false, 1, [], SESSION.key)).rows;

	expect(await questionTotal(db, bill)).toBe(2);
	expect(await waitingQuestions(db, bill, SESSION.key)).toBe(1);
	expect(await w.merge(source, target)).toBe(true);

	expect(w.rowOf(source)).toMatchObject({ status: 'merged', mergedInto: target, note: 'まとめた理由', actor: 'moderator' });
	expect(w.rowOf(answer).parentId).toBe(target);
	expect(w.rowOf(hiddenAnswer)).toMatchObject({ parentId: target, status: 'hidden' });
	expect(w.rowOf(supplement).parentId).toBe(target);

	const rows = await read();
	expect(rows.map((q) => q.id)).toEqual([target]);
	expect(rows[0]).toMatchObject({ mergedCount: 1 });
	expect(rows[0].answers.map((a) => a.id)).toEqual([answer]);
	expect(rows[0].supplements.map((s) => s.id)).toEqual([supplement]);
	expect(JSON.stringify(rows)).not.toContain(w.sqlite.prepare('SELECT body FROM posts WHERE id = ?').get(source)?.body as string);
	expect(await questionTotal(db, bill)).toBe(1);
	// 統合先に答弁が移ったので、答弁待ちではない
	expect(await waitingQuestions(db, bill, SESSION.key)).toBe(0);

	// さらにまとめても1段になる（元にまとめられていた質疑も移る）。記録の統合先は当時のまま
	const final = w.addPost(bill, w.addUser());
	expect(await w.merge(target, final)).toBe(true);
	expect(w.rowOf(source).mergedInto).toBe(final);
	expect(w.rowOf(target).mergedInto).toBe(final);
	expect(w.rowOf(answer).parentId).toBe(final);
	expect((await read())[0]).toMatchObject({ id: final, mergedCount: 2 });
	const logs = w.sqlite.prepare('SELECT post_id AS post, merged_into AS into FROM bill_moderation_logs WHERE action = ? ORDER BY id').all('merge').map((r) => ({ ...r }));
	expect(logs).toEqual([
		{ post: source, into: target },
		{ post: target, into: final }
	]);

	// A→B のあとの B→A は当たらず、循環しない
	const a = w.addPost(bill, w.addUser());
	const b = w.addPost(bill, w.addUser());
	const child = w.addPost(bill, 'author', 'answer', b);
	expect(await w.merge(a, b)).toBe(true);
	expect(await w.merge(b, a)).toBe(false);
	expect(w.rowOf(b)).toMatchObject({ status: 'visible', mergedInto: null });
	expect(w.rowOf(child).parentId).toBe(b);
	// 同じ操作の繰り返しも当たらない
	expect(await w.merge(a, b)).toBe(false);
});

test('基準3：別の法案、別の会期、時期の外、非表示、同じ質疑、答弁と補足、未確認の通報のある統合先は断る。自分の質疑と関わった法案は扱えない。まとめられた質疑は扱えない', async () => {
	const w = world();
	const { db, sqlite } = w;
	const bill = w.addBill();
	const writer = w.addUser();
	const source = w.addPost(bill, writer);
	const target = w.addPost(bill, w.addUser());
	expect(await w.check(source, target)).toBe('ok');

	// ない元、ない統合先
	expect(await w.check(99999, target)).toBe('missing');
	expect(await w.check(source, 99999)).toBe('invalid');
	// 同じ質疑、別の法案、答弁と補足
	expect(await w.check(source, source)).toBe('invalid');
	expect(await w.check(source, w.addPost(w.addBill(), writer))).toBe('invalid');
	const answer = w.addPost(bill, 'author', 'answer', target);
	const supplement = w.addPost(bill, writer, 'supplement', target);
	expect(await w.check(source, answer)).toBe('invalid');
	expect(await w.check(supplement, target)).toBe('invalid');
	// 別の会期：統合先は状態の誤り、元は時期の外（前の会期の質疑は読むだけ）
	const pastPost = w.addPost(bill, writer, 'question', null, '前の会期', PREVIOUS.key);
	expect(await w.check(source, pastPost)).toBe('invalid');
	expect(await w.check(pastPost, target)).toBe('closed');
	// 3週目と4週目の外
	expect(await w.check(source, target, STAFF, SESSION.startsAt)).toBe('closed');
	expect(await w.check(source, target, STAFF, SESSION.endsAt + 1)).toBe('closed');
	expect(await w.check(source, target, STAFF, SESSION.voteAt + 1)).toBe('ok');
	// 非表示
	const hiddenTarget = w.addPost(bill, w.addUser());
	await w.hide(hiddenTarget);
	expect(await w.check(source, hiddenTarget)).toBe('invalid');
	expect(await w.check(hiddenTarget, target)).toBe('invalid');
	expect(await w.merge(source, hiddenTarget)).toBe(false);
	expect(await w.merge(hiddenTarget, target)).toBe(false);
	// 通報を受けていて未確認の質疑は統合先にできない。確認して戻せばできる
	const reported = w.addPost(bill, w.addUser());
	await reportPost(db, w.actor(w.addUser()), { id: reported, billId: bill }, { reason: 'spam', note: null }, NOW);
	expect(await w.check(source, reported)).toBe('invalid');
	expect(await w.merge(source, reported)).toBe(false);
	await w.hide(reported);
	await w.restore(reported);
	expect(await w.check(source, reported)).toBe('ok');
	// 通報を受けている質疑を元にはできる
	expect(await w.check(w.addPost(bill, w.addUser()), target)).toBe('ok');

	// 元か統合先が自分の質疑
	const own = w.addPost(bill, 'mod');
	expect(await w.check(own, target)).toBe('own');
	expect(await w.check(source, own)).toBe('ownTarget');
	// 関わった法案。委員長と理事は投票した法案も
	const supportedBill = w.addBill();
	sqlite.prepare("INSERT INTO bill_supports (bill_id, rev, user_id, created_at) VALUES (?, 1, 'mod', 0)").run(supportedBill);
	expect(await w.check(w.addPost(supportedBill, writer), w.addPost(supportedBill, writer))).toBe('involved');
	const chair = { userId: w.addUser(), role: 'chair' as const };
	const votedBill = w.addBill();
	sqlite.prepare("INSERT INTO votes (session_key, bill_id, user_id, choice, created_at, updated_at) VALUES (?, ?, ?, 'yes', 0, 0)").run(SESSION.key, votedBill, chair.userId);
	expect(await w.check(w.addPost(votedBill, writer), w.addPost(votedBill, writer), chair)).toBe('involved');

	// 候補：同じ法案と会期の表示中の質疑。元、見ている人の質疑、非表示、未確認の通報のある質疑は出ない
	const candidates = await mergeCandidates(db, source, STAFF);
	const ids = candidates.map((c) => c.id);
	expect(ids).toContain(target);
	expect(ids).not.toContain(source);
	expect(ids).not.toContain(own);
	expect(ids).not.toContain(hiddenTarget);
	expect(ids).not.toContain(pastPost);
	expect(candidates.find((c) => c.id === target)?.body).toBeTruthy();

	// まとめられた質疑：通報と ?post= は行がないのと同じ、答弁と補足と非表示と表示に戻すを断り、一覧に出ない
	await reportPost(db, w.actor(w.addUser()), { id: source, billId: bill }, { reason: 'spam', note: null }, NOW);
	expect((await reportedPosts(db, STAFF, null)).some((r) => r.id === source)).toBe(true);
	expect(await w.merge(source, target)).toBe(true);
	expect(await reportPost(db, w.actor(w.addUser()), { id: source, billId: bill }, { reason: 'spam', note: null }, NOW)).toEqual({ ok: false, reason: 'missing' });
	expect(await postStaffAccess(db, source, STAFF)).toBe('missing');
	expect((await reportedPosts(db, STAFF, null)).some((r) => r.id === source)).toBe(false);
	expect(await w.check(source, target)).toBe('missing');
	expect(await w.hide(source)).toBe(false);
	expect(await w.restore(source)).toBe(false);
	expect(await questionOf(db, source, bill, SESSION.key)).toMatchObject({ id: source, status: 'merged' });
	const late = w.addUser();
	expect(await createPost(db, w.actor(late), { billId: bill, sessionKey: SESSION.key, kind: 'supplement', parentId: source, role: null, body: '遅い補足' }, NOW, null)).toEqual({ ok: true, id: null });
	expect(sqlite.prepare("SELECT count(*) AS n FROM posts WHERE body = '遅い補足'").get()).toEqual({ n: 0 });
	expect(w.rowOf(source).status).toBe('merged');
});

test('基準4：元の本文は書いた本人にだけ、統合先へのリンクと一緒に出る。統合先が非表示なら案内になる。ほかの人と運営には渡さない', async () => {
	const w = world();
	const { db } = w;
	const bill = w.addBill();
	const writer = w.addUser();
	const source = w.addPost(bill, writer, 'question', null, 'まとめられる本文');
	const target = w.addPost(bill, w.addUser());
	// 統合先より新しい質疑を20件足すと、統合先は2ページ目になる
	for (let i = 0; i < 20; i++) w.addPost(bill, w.addUser());
	expect(await w.merge(source, target)).toBe(true);

	expect(await mergedPostsFor(db, bill, null)).toEqual([]);
	expect(await mergedPostsFor(db, bill, w.addUser())).toEqual([]);
	expect(await mergedPostsFor(db, bill, 'mod')).toEqual([]);
	const mine = await mergedPostsFor(db, bill, writer);
	expect(mine).toEqual([{ id: source, body: 'まとめられる本文', href: `/houan/${bill}/shitsugi?page=2#shitsugi-${target}` }]);
	expect(Object.keys(mine[0])).not.toContain('userId');

	// 1ページ目なら page を付けない
	const firstBill = w.addBill();
	const near = w.addPost(firstBill, writer);
	const nearTarget = w.addPost(firstBill, w.addUser());
	expect(await w.merge(near, nearTarget)).toBe(true);
	expect((await mergedPostsFor(db, firstBill, writer))[0].href).toBe(`/houan/${firstBill}/shitsugi#shitsugi-${nearTarget}`);

	// 統合先が非表示ならリンクを出さない。戻すと戻る
	await w.hide(target);
	expect((await mergedPostsFor(db, bill, writer))[0]).toEqual({ id: source, body: 'まとめられる本文', href: null });
	await w.restore(target);
	expect((await mergedPostsFor(db, bill, writer))[0].href).not.toBeNull();

	// 非表示の投稿の欄（運営の分も）にも、まとめられた本文は出ない
	expect(JSON.stringify(await hiddenPostsFor(db, bill, 'mod', true))).not.toContain('まとめられる本文');
	expect(JSON.stringify(await reportedPosts(db, STAFF, null))).not.toContain('まとめられる本文');
});

test('基準5：元の質疑の評価はスコアに残り、立候補の資格に数える。新しく評価と読んだ記録を付けられない', async () => {
	const w = world();
	const { db, sqlite } = w;
	const bill = w.addBill();
	const target = { id: bill, sessionKey: SESSION.key };
	const writer = w.addUser();
	const source = w.addPost(bill, writer);
	const into = w.addPost(bill, w.addUser());
	const presser = w.addUser();
	sqlite.prepare("INSERT INTO evaluations (post_id, user_id, kind, stance, created_at) VALUES (?, ?, 'changed', 'undecided', 1)").run(source, presser);
	expect((await sessionPostScores(db, SESSION.key)).get(source)?.changed).toBe(1);

	expect(await w.merge(source, into)).toBe(true);

	// スコアに残る
	expect((await sessionPostScores(db, SESSION.key)).get(source)?.changed).toBe(1);
	// 新しくは付けられない
	expect(await evaluationTarget(db, source, target)).toBeUndefined();
	const reader = w.addUser();
	await recordViews(db, reader, target, [source], null, NOW);
	expect(sqlite.prepare('SELECT count(*) AS n FROM post_views WHERE post_id = ?').get(source)).toEqual({ n: 0 });
	// 立候補の資格に数える
	expect(await standBlock(db, writer, 1, SESSION, PREVIOUS)).toBeNull();
	// 運営が非表示にしたものは今までどおり数えない
	const hiddenWriter = w.addUser();
	await w.hide(w.addPost(bill, hiddenWriter), { userId: 'x', role: 'operator' } as never);
	expect(await standBlock(db, hiddenWriter, 1, SESSION, PREVIOUS)).toBe('noPost');
});

test('基準6：公開の記録に本文も統合先の番号も出ない。委員長の操作は最後の操作に数え、理事は数えない。書いた人に通知が届く', async () => {
	const w = world();
	const { db } = w;
	const bill = w.addBill(undefined, '整理の法案');
	const writer = w.addUser();
	const [source, target] = [w.addPost(bill, writer, 'question', null, '記録に出ない本文'), w.addPost(bill, w.addUser())];
	const child = w.addPost(bill, w.addUser(), 'answer', source);
	const childWriter = (w.sqlite.prepare('SELECT user_id AS u FROM posts WHERE id = ?').get(child) as { u: string }).u;
	expect(await w.merge(source, target)).toBe(true);

	const { rows } = await billModerationLogPage(db, 1);
	expect(rows.map((r) => [r.kind, r.action, r.actor, r.reason, r.note])).toEqual([['question', 'merge', 'moderator', null, 'まとめた理由']]);
	expect(rows[0]).toMatchObject({ billId: bill, title: '整理の法案' });
	const text = JSON.stringify(rows);
	expect(text).not.toContain('記録に出ない本文');
	expect(text).not.toContain(writer);
	expect(Object.keys(rows[0])).not.toContain('mergedInto');

	// 委員長の操作は「最後の操作」に数え、代行の理事は数えない
	const [chair, director] = [w.addUser(), w.addUser()];
	const at = SESSION.deliberationAt + 5000;
	expect(await w.merge(w.addPost(bill, w.addUser()), target, { userId: chair, role: 'chair' }, at)).toBe(true);
	expect(await lastChairAction(db, chair, SESSION)).toBe(at);
	expect(await w.merge(w.addPost(bill, w.addUser()), target, { userId: director, role: 'director' }, at + 1)).toBe(true);
	expect(await lastChairAction(db, director, SESSION)).toBeNull();

	// 書いた人に届く。下の答弁を書いた人と、2段目で統合先が変わった人には届かない
	expect(w.inbox(writer)).toEqual([{ kind: 'question_merged', target: source, ref: NOW }]);
	expect(w.inbox(childWriter)).toEqual([]);
	expect(await w.merge(target, w.addPost(bill, w.addUser()), STAFF, NOW + 1)).toBe(true);
	expect(w.inbox(writer)).toHaveLength(1);
	// 当たらなければ届かない
	expect(await w.merge(source, target, STAFF, NOW + 2)).toBe(false);
	expect(w.inbox(writer)).toHaveLength(1);

	// 一覧では法案の題名と質疑のタブへのリンクになる
	const page = await notificationPage(db, writer, NOW + 10, null, 1);
	const items = page.items.filter((i) => i.kind === 'question_merged');
	expect(items).toHaveLength(1);
	expect(items[0]).toMatchObject({ title: '整理の法案', href: `/houan/${bill}/shitsugi` });
});
