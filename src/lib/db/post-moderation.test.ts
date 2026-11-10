// Issue #80 基準1〜7：質疑・答弁・補足の通報と非表示（設計書 docs/spec/80.md）。画面は e2e/shitsugi-tsuho.spec.ts
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { expect, test } from 'vitest';
import { HIDEABLE, RESTORABLE } from '../domain/reports';
import { sessionAt } from '../domain/session';
import { lastChairAction, staffRoleOf, standBlock } from '../server/chairs';
import { evaluationTarget, recordViews, sessionPostScores } from '../server/evaluations';
import { notificationPage } from '../server/notification-page';
import { billModerationLogPage, changePostStatus, hiddenPostsFor, postStaffAccess, reportedPostIds, reportedPosts, reportPost, staffOnBill } from '../server/post-moderation';
import { createPost, listQuestions, questionOf, questionTotal, waitingQuestions } from '../server/posts';
import { openMemoryDb, type MemoryDb } from './memory';

const SESSION = sessionAt(Date.parse('2030-05-10T00:00:00+09:00'), null);
const PREVIOUS = sessionAt(SESSION.startsAt - 1, null);
const NOW = SESSION.deliberationAt + 1000;
const DAY = 24 * 60 * 60 * 1000;
const STAFF = { userId: 'mod', role: 'moderator' as const };

function world() {
	const { sqlite, db } = openMemoryDb();
	sqlite.exec('INSERT OR IGNORE INTO committees (id, name) VALUES (1, \'第1\')');
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
				.prepare("INSERT INTO bills (user_id, committee_id, kind, status, rev, next_rev, proposed_rev, title, affected, side_effects, created_at, updated_at, proposed_at) VALUES (?, 1, 'amend', 'proposed', 1, 2, 1, ?, '人', '副作用', 0, 0, 0)")
				.run(author, title).lastInsertRowid
		);
	const addPost = (bill: number, userId: string, kind: 'question' | 'answer' | 'supplement' = 'question', parent: number | null = null, body = `本文${++counter}`) =>
		Number(
			sqlite
				.prepare('INSERT INTO posts (bill_id, session_key, kind, parent_id, user_id, role, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0)')
				.run(bill, SESSION.key, kind, parent, userId, kind === 'answer' ? 'author' : null, body).lastInsertRowid
		);
	const support = (bill: number, userId: string) => sqlite.prepare('INSERT INTO bill_supports (bill_id, rev, user_id, created_at) VALUES (?, 1, ?, 0)').run(bill, userId);
	const cosponsor = (bill: number, userId: string, status: string) => sqlite.prepare('INSERT INTO bill_cosponsors (bill_id, user_id, status, created_at, accepted_at) VALUES (?, ?, ?, 0, 0)').run(bill, userId, status);
	const actor = (userId: string, registeredAt = 0) => ({ userId, registeredAt, ipHash: `ip-${userId}` });
	const statusOf = (id: number) => (sqlite.prepare('SELECT status FROM posts WHERE id = ?').get(id) as { status: string }).status;
	/** 別々の n 人に通報させる */
	const reportBy = async (bill: number, post: number, n: number) => {
		for (let i = 0; i < n; i++) expect(await reportPost(db, actor(addUser()), { id: post, billId: bill }, { reason: 'attack', note: null }, NOW)).toEqual({ ok: true, already: false });
	};
	const hide = (post: number, staff: { userId: string; role: 'moderator' | 'operator' | 'chair' | 'director' } = STAFF, at = NOW) => changePostStatus(db, post, HIDEABLE, 'hidden', staff, 'attack', 'メモ', at);
	const restore = (post: number, at = NOW + 1) => changePostStatus(db, post, RESTORABLE, 'restored', STAFF, null, '問題なし', at);
	const inbox = (userId: string) => sqlite.prepare('SELECT kind, target_id AS target, ref_id AS ref FROM notifications WHERE user_id = ? ORDER BY id').all(userId).map((r) => ({ ...r }));
	return { sqlite, db: db as MemoryDb, addUser, addBill, addPost, support, cosponsor, actor, statusOf, reportBy, hide, restore, inbox };
}

test('基準1：0023 で列と表とトリガーが増え、既存の行は残る。status が変わると記録が1行入る', () => {
	const old = new DatabaseSync(':memory:');
	old.exec('PRAGMA foreign_keys = ON');
	const dir = new URL('../../../drizzle/', import.meta.url);
	const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
	for (const f of files.filter((f) => f < '0023')) old.exec(readFileSync(new URL(f, dir), 'utf8'));
	old.exec(`
		INSERT INTO user (id, name, email, created_at, updated_at) VALUES ('u', 'u', 'u@test.invalid', 0, 0);
		INSERT OR IGNORE INTO committees (id, name) VALUES (1, '第1');
		INSERT INTO bills (id, user_id, committee_id, kind, status, rev, next_rev, title, affected, side_effects, created_at, updated_at) VALUES (1, 'u', 1, 'amend', 'proposed', 1, 2, 't', 'a', 's', 0, 0);
		INSERT INTO posts (id, bill_id, session_key, kind, user_id, body, created_at) VALUES (7, 1, 'k', 'question', 'u', 'もとの本文', 0);
	`);
	const later = files.filter((f) => f >= '0023');
	expect(later.length).toBeGreaterThan(0);
	for (const f of later) old.exec(readFileSync(new URL(f, dir), 'utf8'));

	expect({ ...old.prepare('SELECT body, status, status_actor, status_reason FROM posts WHERE id = 7').get() }).toEqual({ body: 'もとの本文', status: 'visible', status_actor: null, status_reason: null });
	expect(old.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = 'posts_status_log'").all()).toHaveLength(1);

	// status を変えない更新では記録しない
	old.exec("UPDATE posts SET status_note = 'x' WHERE id = 7");
	expect(old.prepare('SELECT count(*) AS n FROM bill_moderation_logs').get()).toEqual({ n: 0 });
	old.exec("UPDATE posts SET status = 'hidden', status_actor = 'operator', status_actor_user_id = 'u', status_reason = 'attack', status_note = 'メモ', status_changed_at = 5 WHERE id = 7");
	expect({ ...old.prepare('SELECT bill_id, post_id, action, actor, actor_user_id, reason, note, created_at FROM bill_moderation_logs').get() }).toEqual({ bill_id: 1, post_id: 7, action: 'hide', actor: 'operator', actor_user_id: 'u', reason: 'attack', note: 'メモ', created_at: 5 });
	old.exec("UPDATE posts SET status = 'restored', status_actor = 'operator', status_reason = NULL, status_note = '戻す', status_changed_at = 6 WHERE id = 7");
	old.exec("UPDATE posts SET status = 'auto_hidden', status_actor = 'auto', status_actor_user_id = NULL, status_reason = 'reports', status_note = NULL, status_changed_at = 7 WHERE id = 7");
	expect(old.prepare('SELECT action FROM bill_moderation_logs ORDER BY id').all().map((r) => r.action)).toEqual(['hide', 'restore', 'auto_hide']);

	// 通報は理由を確かめ、同じ人の2件目は入らない
	const insert = (reason: string) => old.prepare("INSERT INTO post_reports (post_id, user_id, reason, counted, created_at) VALUES (7, 'u', ?, 1, 0)").run(reason);
	expect(() => insert('bad')).toThrow();
	insert('attack');
	expect(() => insert('spam')).toThrow();
});

test('基準2：別々の3人で自動で非表示になり、関わった人の通報は数に入らない。自分のもの、非表示、2回目、上限は断る', async () => {
	const w = world();
	const { db, sqlite } = w;
	const bill = w.addBill();
	const writer = w.addUser();
	const question = w.addPost(bill, writer);

	// 関わった人（提出者、賛同者、共同提出者、抜けた共同提出者）と、登録したばかりの人は数に入らない
	const [supporter, member, left, fresh] = [w.addUser(), w.addUser(), w.addUser(), w.addUser()];
	w.support(bill, supporter);
	w.cosponsor(bill, member, 'accepted');
	w.cosponsor(bill, left, 'left');
	const value = { reason: 'spam' as const, note: null };
	for (const id of ['author', supporter, member, left]) expect(await reportPost(db, w.actor(id), { id: question, billId: bill }, value, NOW)).toEqual({ ok: true, already: false });
	expect(await reportPost(db, w.actor(fresh, NOW - DAY + 1), { id: question, billId: bill }, value, NOW)).toEqual({ ok: true, already: false });
	expect(w.statusOf(question)).toBe('visible');
	const counted = sqlite.prepare('SELECT counted FROM post_reports WHERE post_id = ?').all(question).map((r) => r.counted);
	expect(counted).toEqual([0, 0, 0, 0, 0]);

	await w.reportBy(bill, question, 2);
	expect(w.statusOf(question)).toBe('visible');
	await w.reportBy(bill, question, 1);
	expect(w.statusOf(question)).toBe('auto_hidden');
	expect({ ...sqlite.prepare('SELECT status_actor AS actor, status_actor_user_id AS who, status_reason AS reason, status_note AS note FROM posts WHERE id = ?').get(question) }).toEqual({ actor: 'auto', who: null, reason: 'reports', note: null });

	// 答弁と補足も同じ。補足は「その他」の説明つき
	const open = w.addPost(bill, writer);
	const answer = w.addPost(bill, 'author', 'answer', open);
	const supplement = w.addPost(bill, writer, 'supplement', open);
	await w.reportBy(bill, answer, 3);
	expect(w.statusOf(answer)).toBe('auto_hidden');
	expect(await reportPost(db, w.actor(w.addUser()), { id: supplement, billId: bill }, { reason: 'other', note: '説明' }, NOW)).toEqual({ ok: true, already: false });
	await w.reportBy(bill, supplement, 2);
	expect(w.statusOf(supplement)).toBe('auto_hidden');

	// 表示に戻したあとは自動で消えない
	expect(await w.restore(answer)).toBe(true);
	await w.reportBy(bill, answer, 3);
	expect(w.statusOf(answer)).toBe('restored');

	// 自分のもの、ほかの法案とない番号、非表示の投稿、非表示の質疑の下の投稿
	const other = w.addUser();
	const under = w.addPost(bill, writer, 'supplement', question);
	expect(await reportPost(db, w.actor(writer), { id: open, billId: bill }, value, NOW)).toEqual({ ok: false, reason: 'own' });
	expect(await reportPost(db, w.actor(other), { id: open, billId: w.addBill() }, value, NOW)).toEqual({ ok: false, reason: 'missing' });
	expect(await reportPost(db, w.actor(other), { id: 99999, billId: bill }, value, NOW)).toEqual({ ok: false, reason: 'missing' });
	expect(await reportPost(db, w.actor(other), { id: question, billId: bill }, value, NOW)).toEqual({ ok: false, reason: 'hidden' });
	expect(await reportPost(db, w.actor(other), { id: under, billId: bill }, value, NOW)).toEqual({ ok: false, reason: 'hidden' });

	// 2回目は何もしない
	expect(await reportPost(db, w.actor(other), { id: open, billId: bill }, value, NOW)).toEqual({ ok: true, already: false });
	expect(await reportPost(db, w.actor(other), { id: open, billId: bill }, value, NOW)).toEqual({ ok: true, already: true });
	expect(sqlite.prepare('SELECT count(*) AS n FROM post_reports WHERE post_id = ? AND user_id = ?').get(open, other)).toEqual({ n: 1 });

	// 上限は課題と解決策と合わせて10件。超えると違反に数える
	const busy = w.addUser();
	sqlite.exec(`
		INSERT INTO issues (id, user_id, title, affected, example, topic_id, created_at) VALUES (1, 'author', '課題', '人', '例', NULL, 0);
		INSERT INTO solutions (id, issue_id, user_id, body, created_at) VALUES (1, 1, 'author', '解決策', 0);
		INSERT INTO reports (issue_id, user_id, reason, counted, created_at) VALUES (1, '${busy}', 'attack', 1, ${NOW - 1});
		INSERT INTO solution_reports (solution_id, user_id, reason, counted, created_at) VALUES (1, '${busy}', 'attack', 1, ${NOW - 1});
	`);
	for (let i = 0; i < 8; i++) expect(await reportPost(db, w.actor(busy), { id: w.addPost(bill, writer), billId: bill }, value, NOW)).toEqual({ ok: true, already: false });
	const over = await reportPost(db, w.actor(busy), { id: w.addPost(bill, writer), billId: bill }, value, NOW);
	expect(over).toMatchObject({ ok: false, reason: 'limit', refusal: { kind: 'report-day' } });
	expect(sqlite.prepare("SELECT count(*) AS n FROM actions WHERE user_id = ? AND kind = 'violation'").get(busy)).toEqual({ n: 1 });
});

test('基準3：非表示の質疑はカードごと出ず数に入らない。非表示の答弁は数えず答弁待ちに戻る。非表示の補足は出ない。表示に戻すと全部戻る', async () => {
	const w = world();
	const { db } = w;
	const bill = w.addBill();
	const writer = w.addUser();
	const shown = w.addPost(bill, writer);
	const question = w.addPost(bill, writer);
	const answer = w.addPost(bill, 'author', 'answer', question);
	const supplement = w.addPost(bill, w.addUser(), 'supplement', question);
	const read = async () => (await listQuestions(db, bill, null, false, 1, [], SESSION.key, 0)).rows;
	const waiting = async () => (await listQuestions(db, bill, null, true, 1, [], SESSION.key, 0)).rows.map((q) => q.id);

	expect(await questionTotal(db, bill)).toBe(2);
	expect(await waitingQuestions(db, bill, SESSION.key)).toBe(1);

	// 答弁を隠すと答弁待ちに戻る
	await w.hide(answer);
	expect((await read()).find((q) => q.id === question)?.answers).toEqual([]);
	expect(await waitingQuestions(db, bill, SESSION.key)).toBe(2);
	expect((await waiting()).sort()).toEqual([shown, question].sort());
	// 表示に戻すと（restored）答弁に数える
	await w.restore(answer);
	expect((await read()).find((q) => q.id === question)?.answers.map((a) => a.id)).toEqual([answer]);
	expect(await waitingQuestions(db, bill, SESSION.key)).toBe(1);

	// 補足を隠しても、数は変わらない
	await w.hide(supplement);
	expect((await read()).find((q) => q.id === question)?.supplements).toEqual([]);
	expect(await waitingQuestions(db, bill, SESSION.key)).toBe(1);
	await w.restore(supplement);
	expect((await read()).find((q) => q.id === question)?.supplements.map((s) => s.id)).toEqual([supplement]);

	// 質疑を隠すとカードごと出ず、「質疑 N」と「答弁待ち N」に入らない
	await w.hide(question);
	expect((await read()).map((q) => q.id)).toEqual([shown]);
	expect(await questionTotal(db, bill)).toBe(1);
	expect(await waitingQuestions(db, bill, SESSION.key)).toBe(1);

	// 表示に戻すと答弁と補足も一緒に戻る
	await w.restore(question);
	const back = (await read()).find((q) => q.id === question);
	expect(back?.answers.map((a) => a.id)).toEqual([answer]);
	expect(back?.supplements.map((s) => s.id)).toEqual([supplement]);
	expect(await questionTotal(db, bill)).toBe(2);
});

test('基準4：本人には自分の非表示の投稿が、運営にはその法案の分が出る。関わった法案では自分のものだけ。下の答弁の書き手には質疑の中身を出さない', async () => {
	const w = world();
	const { db } = w;
	const bill = w.addBill();
	const [writer, answerer, stranger, involvedMod] = [w.addUser(), w.addUser(), w.addUser(), w.addUser('imod', 'moderator')];
	w.support(bill, involvedMod);
	const question = w.addPost(bill, writer, 'question', null, '隠れた質疑の本文');
	const answer = w.addPost(bill, answerer, 'answer', question, '下の答弁の本文');
	const open = w.addPost(bill, writer);
	const hiddenSupplement = w.addPost(bill, answerer, 'supplement', open, '隠れた補足の本文');
	const ownOfMod = w.addPost(bill, involvedMod, 'answer', open, '運営自身の答弁');
	await w.hide(question);
	await w.hide(hiddenSupplement);
	await w.hide(ownOfMod);
	await w.reportBy(bill, w.addPost(bill, writer, 'question', null, '自動で隠れた本文'), 3);

	const staffHere = (userId: string) => staffOnBill(db, bill, userId, NOW, null);
	expect(await staffHere('mod')).toBe(true);
	expect(await staffHere(involvedMod)).toBe(false);
	expect(await staffHere(stranger)).toBe(false);

	// ほかの人とログインなしには何も出ない
	expect(await hiddenPostsFor(db, bill, stranger, false)).toEqual([]);
	expect(await hiddenPostsFor(db, bill, null, false)).toEqual([]);

	// 本人：自分のものだけ。理由が読める。user_id を渡さない
	const mine = await hiddenPostsFor(db, bill, writer, false);
	expect(mine.map((p) => p.body)).toEqual(['自動で隠れた本文', '隠れた質疑の本文']);
	expect(mine[0]).toMatchObject({ kind: 'question', status: 'auto_hidden', statusReason: 'reports', mine: true, parentHidden: false });
	expect(mine[1]).toMatchObject({ kind: 'question', status: 'hidden', statusReason: 'attack', mine: true, parentHidden: false });
	for (const row of mine) expect(Object.keys(row)).not.toContain('userId');

	// 下の答弁の書き手：自分の本文と parentHidden だけで、質疑の中身は渡さない
	const below = await hiddenPostsFor(db, bill, answerer, false);
	expect(below.map((p) => p.body)).toEqual(['隠れた補足の本文', '下の答弁の本文']);
	expect(below[1]).toMatchObject({ id: answer, status: 'visible', mine: true, parentHidden: true });
	expect(JSON.stringify(below)).not.toContain('隠れた質疑の本文');

	// 運営：その法案の非表示の投稿。下の答弁は出さない
	const staffRows = await hiddenPostsFor(db, bill, 'mod', true);
	expect(staffRows.map((p) => p.body)).toEqual(['自動で隠れた本文', '運営自身の答弁', '隠れた補足の本文', '隠れた質疑の本文']);
	for (const row of staffRows) expect(row.mine).toBe(false);

	// 関わった運営：自分のものだけ
	expect((await hiddenPostsFor(db, bill, involvedMod, await staffHere(involvedMod))).map((p) => p.body)).toEqual(['運営自身の答弁']);

	// 自分の答弁も非表示なら、自分の投稿の理由だけを出す
	await w.hide(answer);
	const both = await hiddenPostsFor(db, bill, answerer, false);
	expect(both.find((p) => p.id === answer)).toMatchObject({ status: 'hidden', parentHidden: false });
});

test('基準5：非表示と、その下の投稿には評価も読んだ記録も付かず、質疑の下に書けない。スコアと立候補の資格の数え方', async () => {
	const w = world();
	const { db, sqlite } = w;
	const bill = w.addBill();
	const target = { id: bill, sessionKey: SESSION.key };
	const writer = w.addUser();
	const reader = w.addUser();
	const question = w.addPost(bill, writer);
	const answer = w.addPost(bill, 'author', 'answer', question);
	const views = (post: number) => (sqlite.prepare('SELECT count(*) AS n FROM post_views WHERE post_id = ?').get(post) as { n: number }).n;

	// 表示中は評価と読んだ記録の対象
	expect(await evaluationTarget(db, answer, target)).toBeTruthy();
	await recordViews(db, reader, target, [answer], null, NOW);
	expect(views(answer)).toBe(1);

	// 質疑を隠すと、質疑にも下の答弁にも付かない（評価の取り消しもここで断る）
	await w.hide(question);
	expect(await evaluationTarget(db, question, target)).toBeUndefined();
	expect(await evaluationTarget(db, answer, target)).toBeUndefined();
	const lateReader = w.addUser();
	await recordViews(db, lateReader, target, [question, answer], null, NOW);
	expect(views(question)).toBe(0);
	expect(views(answer)).toBe(1);
	// 答弁のない質疑でも、非表示なら読んだ記録は付かない
	const lone = w.addPost(bill, writer);
	await w.hide(lone);
	await recordViews(db, lateReader, target, [lone], null, NOW);
	expect(views(lone)).toBe(0);

	// 親が隠れていれば答弁と補足は入らない（確かめたあとに隠れた場合も同じ文で止まる）。記録も足さない
	expect(await questionOf(db, question, bill, SESSION.key)).toMatchObject({ id: question, status: 'hidden' });
	const late = w.addUser();
	const refused = await createPost(db, w.actor(late), { billId: bill, sessionKey: SESSION.key, kind: 'supplement', parentId: question, role: null, body: '遅い補足' }, NOW, null);
	expect(refused).toEqual({ ok: true, id: null });
	expect(sqlite.prepare("SELECT count(*) AS n FROM posts WHERE body = '遅い補足'").get()).toEqual({ n: 0 });
	expect(sqlite.prepare('SELECT count(*) AS n FROM actions WHERE user_id = ?').get(late)).toEqual({ n: 0 });

	// 表示に戻すと付けられ、書ける（restored を見ている）
	await w.restore(question);
	expect(await evaluationTarget(db, answer, target)).toBeTruthy();
	const written = await createPost(db, w.actor(late), { billId: bill, sessionKey: SESSION.key, kind: 'supplement', parentId: question, role: null, body: '戻ったあとの補足' }, NOW, null);
	expect(written).toMatchObject({ ok: true, id: expect.any(Number) });
	expect(sqlite.prepare('SELECT count(*) AS n FROM actions WHERE user_id = ?').get(late)).toEqual({ n: 1 });

	// スコア：隠した投稿そのものは数えず、下の答弁は数える。戻すと数える
	const scores = () => sessionPostScores(db, SESSION.key);
	expect((await scores()).has(question)).toBe(true);
	await w.hide(question);
	expect((await scores()).has(question)).toBe(false);
	expect((await scores()).has(answer)).toBe(true);
	await w.restore(question);
	expect((await scores()).has(question)).toBe(true);
	await w.hide(answer);
	expect((await scores()).has(answer)).toBe(false);
	await w.restore(answer);
	expect((await scores()).has(answer)).toBe(true);

	// 「同じ相手との上限」：隠した投稿は枠を使わないので、4件目が数に入る
	const poster = w.addUser();
	const presser = w.addUser();
	const four = [0, 1, 2, 3].map(() => w.addPost(bill, poster));
	for (const [i, post] of four.entries()) sqlite.prepare("INSERT INTO evaluations (post_id, user_id, kind, stance, created_at) VALUES (?, ?, 'changed', 'undecided', ?)").run(post, presser, i + 1);
	expect((await scores()).get(four[3])?.changed).toBe(0);
	await w.hide(four[0]);
	expect((await scores()).get(four[3])?.changed).toBe(1);

	// 立候補の資格：自動、委員長、理事の非表示は数え、運営と運営協力者の非表示は数えない
	const stand = (userId: string) => standBlock(db, userId, 1, SESSION, PREVIOUS);
	const candidate = async (act: (post: number) => Promise<unknown>) => {
		const id = w.addUser();
		const post = w.addPost(bill, id);
		await act(post);
		return stand(id);
	};
	expect(await candidate(async () => {})).toBeNull();
	expect(await candidate((post) => w.reportBy(bill, post, 3))).toBeNull();
	expect(await candidate((post) => w.hide(post, { userId: 'x', role: 'chair' }))).toBeNull();
	expect(await candidate((post) => w.hide(post, { userId: 'x', role: 'director' }))).toBeNull();
	expect(await candidate((post) => w.hide(post, { userId: 'x', role: 'operator' }))).toBe('noPost');
	expect(await candidate((post) => w.hide(post, { userId: 'x', role: 'moderator' }))).toBe('noPost');
	// 運営が表示に戻してから隠し直すと数えない
	expect(
		await candidate(async (post) => {
			await w.hide(post, { userId: 'x', role: 'chair' });
			await w.restore(post);
			await w.hide(post, { userId: 'x', role: 'operator' });
		})
	).toBe('noPost');
	// 非表示の質疑の下の答弁は、書いた人の責任ではないので数える
	const below = w.addUser();
	const hiddenQuestion = w.addPost(bill, writer);
	w.addPost(bill, below, 'answer', hiddenQuestion);
	await w.hide(hiddenQuestion, { userId: 'x', role: 'operator' });
	expect(await stand(below)).toBeNull();
});

test('基準6：運営の画面に通報された投稿が出て、非表示と表示に戻すができる。自分のものと関わった法案は枠の外で除かれ、扱えない', async () => {
	const w = world();
	const { db, sqlite } = w;
	const bill = w.addBill(undefined, '扱える法案');
	const writer = w.addUser();
	const question = w.addPost(bill, writer, 'question', null, '通報された本文');
	const below = w.addPost(bill, w.addUser(), 'supplement', question, '下の補足');
	const reporters = [w.addUser(), w.addUser(), w.addUser()];
	await reportPost(db, w.actor(reporters[0]), { id: question, billId: bill }, { reason: 'other', note: '説明の文' }, NOW);
	await reportPost(db, w.actor(reporters[1]), { id: question, billId: bill }, { reason: 'spam', note: null }, NOW);
	await reportPost(db, w.actor('author'), { id: question, billId: bill }, { reason: 'attack', note: null }, NOW);
	await reportPost(db, w.actor(reporters[2]), { id: below, billId: bill }, { reason: 'attack', note: null }, NOW);

	const row = (await reportedPosts(db, STAFF, null)).find((r) => r.id === question);
	// 関わった人（提出者）の通報は「数に入らないもの」で、自動の非表示と同じ式
	expect(row).toMatchObject({ kind: 'question', body: '通報された本文', status: 'visible', billId: bill, billTitle: '扱える法案', total: 3, counted: 2, other: 1, spam: 1, attack: 1, notes: ['説明の文'], parentHidden: false });
	expect(Object.keys(row as object)).not.toContain('userId');
	expect(w.statusOf(question)).toBe('visible');

	// 状態の移り変わり
	expect(await changePostStatus(db, question, RESTORABLE, 'restored', STAFF, null, 'm', NOW)).toBe(false);
	expect(await w.hide(question)).toBe(true);
	expect(await w.hide(question)).toBe(false);
	expect(await w.restore(question)).toBe(true);
	expect(await w.restore(question)).toBe(false);
	expect(await w.hide(question)).toBe(true);
	const rows = await reportedPosts(db, STAFF, null);
	expect(rows.find((r) => r.id === below)).toMatchObject({ parentHidden: true });
	// 親が隠れていても下の投稿は操作できる
	expect(await w.hide(below)).toBe(true);

	// 通報されていない投稿は focus で出る
	const quiet = w.addPost(bill, writer, 'question', null, '通報のない本文');
	expect((await reportedPosts(db, STAFF, null)).some((r) => r.id === quiet)).toBe(false);
	expect((await reportedPosts(db, STAFF, quiet))[0]).toMatchObject({ id: quiet, total: 0 });

	// 委員長と代行の理事も扱える
	const [chair, director, recalledChair] = [w.addUser(), w.addUser(), w.addUser()];
	const addTerm = (userId: string, role: string, rank: number, recalledAt: number | null, session = SESSION.key) => sqlite.prepare('INSERT INTO chair_terms (committee_id, session_key, user_id, role, rank, votes, recalled_at, created_at) VALUES (1, ?, ?, ?, ?, 1, ?, 0)').run(session, userId, role, rank, recalledAt);
	addTerm(chair, 'chair', 0, null);
	expect(await staffRoleOf(db, chair, NOW, null)).toBe('chair');
	expect(await postStaffAccess(db, quiet, { userId: chair, role: 'chair' })).toBe('ok');
	sqlite.prepare('DELETE FROM chair_terms').run();
	addTerm(recalledChair, 'chair', 0, NOW - 1);
	addTerm(director, 'director', 1, null);
	expect(await staffRoleOf(db, director, NOW, null)).toBe('director');
	expect(await postStaffAccess(db, quiet, { userId: director, role: 'director' })).toBe('ok');

	// 扱えない人：ない番号、自分のもの、関わった法案。委員長と理事は投票した法案も
	const mine = w.addPost(bill, 'mod');
	expect(await postStaffAccess(db, 99999, STAFF)).toBe('missing');
	expect(await postStaffAccess(db, mine, STAFF)).toBe('own');
	expect(await postStaffAccess(db, quiet, STAFF)).toBe('ok');
	const involvedBill = w.addBill(undefined, '関わった法案');
	w.support(involvedBill, 'mod');
	const involvedPost = w.addPost(involvedBill, writer);
	expect(await postStaffAccess(db, involvedPost, STAFF)).toBe('involved');
	const votedBill = w.addBill(undefined, '投票した法案');
	const votedPost = w.addPost(votedBill, writer);
	sqlite.prepare("INSERT INTO votes (session_key, bill_id, user_id, choice, created_at, updated_at) VALUES (?, ?, 'mod', 'yes', 0, 0)").run(SESSION.key, votedBill);
	sqlite.prepare("INSERT INTO votes (session_key, bill_id, user_id, choice, created_at, updated_at) VALUES (?, ?, ?, 'yes', 0, 0)").run(SESSION.key, votedBill, director);
	expect(await postStaffAccess(db, votedPost, STAFF)).toBe('ok');
	expect(await postStaffAccess(db, votedPost, { userId: director, role: 'director' })).toBe('involved');

	// 除くのは100件に絞る前：関わった法案の新しい通報が100件あっても、扱える古い行が残る
	await w.reportBy(bill, mine, 1);
	const older = w.addPost(bill, writer, 'question', null, '古い通報の本文');
	sqlite.prepare("INSERT INTO post_reports (post_id, user_id, reason, counted, created_at) VALUES (?, ?, 'attack', 1, 1)").run(older, reporters[0]);
	for (let i = 0; i < 100; i++) sqlite.prepare("INSERT INTO post_reports (post_id, user_id, reason, counted, created_at) VALUES (?, ?, 'attack', 1, ?)").run(w.addPost(involvedBill, writer), reporters[0], NOW);
	const listed = await reportedPosts(db, STAFF, null);
	expect(listed.some((r) => r.id === older)).toBe(true);
	expect(listed.some((r) => r.id === mine)).toBe(false);
	expect(listed.some((r) => r.billId === involvedBill)).toBe(false);

	// 通報済みの判定は法案で引き、番号の数によらない
	expect((await reportedPostIds(db, reporters[0], bill)).sort()).toEqual([older, question].sort());
	expect(await reportedPostIds(db, reporters[0], w.addBill())).toEqual([]);
});

test('基準7：公開の記録に出て本文と書いた人を返さない。委員長の操作は最後の操作に数え、理事は数えない。書いた人に通知が届く', async () => {
	const w = world();
	const { db } = w;
	const bill = w.addBill(undefined, '記録の法案');
	const writer = w.addUser();
	const question = w.addPost(bill, writer, 'question', null, '記録に出ない本文');
	const reported = w.addPost(bill, writer, 'answer', question, '通報される答弁');

	await w.hide(question, { userId: 'mod', role: 'moderator' }, NOW);
	await w.restore(question, NOW + 1);
	await w.reportBy(bill, reported, 3);

	const { rows, hasNext } = await billModerationLogPage(db, 1);
	expect(hasNext).toBe(false);
	expect(rows.map((r) => [r.kind, r.action, r.actor, r.reason, r.note])).toEqual([
		['answer', 'auto_hide', 'auto', 'reports', null],
		['question', 'restore', 'moderator', null, '問題なし'],
		['question', 'hide', 'moderator', 'attack', 'メモ']
	]);
	expect(rows[0]).toMatchObject({ billId: bill, title: '記録の法案' });
	const text = JSON.stringify(rows);
	expect(text).not.toContain('記録に出ない本文');
	expect(text).not.toContain(writer);
	expect(Object.keys(rows[0])).not.toContain('actorUserId');
	expect(Object.keys(rows[0])).not.toContain('postId');

	// 委員長の役職の操作は「最後の操作」に数え、代行の理事の操作は数えない
	const [chair, director] = [w.addUser(), w.addUser()];
	const at = SESSION.deliberationAt + 5000;
	expect(await lastChairAction(db, chair, SESSION)).toBeNull();
	await w.hide(w.addPost(bill, writer), { userId: chair, role: 'chair' }, at);
	expect(await lastChairAction(db, chair, SESSION)).toBe(at);
	await w.hide(w.addPost(bill, writer), { userId: director, role: 'director' }, at + 1);
	expect(await lastChairAction(db, director, SESSION)).toBeNull();

	// 通知：非表示、表示に戻した、自動の非表示。繰り返すと届く
	const notified = w.addUser();
	const post = w.addPost(bill, notified);
	expect(await w.hide(post, STAFF, NOW)).toBe(true);
	expect(await w.restore(post, NOW + 1)).toBe(true);
	expect(await w.hide(post, STAFF, NOW + 2)).toBe(true);
	expect(w.inbox(notified)).toEqual([
		{ kind: 'post_hidden', target: post, ref: NOW },
		{ kind: 'post_restored', target: post, ref: NOW + 1 },
		{ kind: 'post_hidden', target: post, ref: NOW + 2 }
	]);
	// 失敗して状態が変わらなければ届かない
	expect(await w.hide(post, STAFF, NOW + 3)).toBe(false);
	expect(w.inbox(notified)).toHaveLength(3);
	expect(w.inbox(writer).map((r) => r.kind)).toContain('post_hidden');

	// 一覧では法案の題名と質疑のタブへのリンクになる（ほかの種類に落ちない）
	const page = await notificationPage(db, notified, NOW + 10, null, 1);
	const items = page.items.filter((i) => i.kind === 'post_hidden' || i.kind === 'post_restored');
	expect(items).toHaveLength(3);
	for (const item of items) expect(item).toMatchObject({ title: '記録の法案', href: `/houan/${bill}/shitsugi` });
});
