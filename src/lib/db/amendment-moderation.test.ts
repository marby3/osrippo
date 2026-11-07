// Issue #103 基準1〜7：修正案の通報と非表示（設計書 docs/spec/103.md）。画面は e2e/shusei-tsuho.spec.ts
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { expect, test } from 'vitest';
import { autoHideClosesAt } from '../domain/amendments';
import { HIDEABLE, RESTORABLE } from '../domain/reports';
import { sessionAt } from '../domain/session';
import { amendmentCloseOf, amendmentStaffAccess, changeAmendmentModeration, hiddenAmendmentsFor, reportAmendment, reportedAmendmentIds, reportedAmendments, staffOnAmendments } from '../server/amendment-moderation';
import { acceptAmendment, amendmentCount, amendmentOf, castAmendmentVote, coDrafters, createAmendment, listAmendments, myAmendmentVote, priorVoteCount, setAmendmentSupport, settleAmendments, updateAmendment } from '../server/amendments';
import { billById } from '../server/bills';
import { lastChairAction, staffRoleOf } from '../server/chairs';
import { notificationPage } from '../server/notification-page';
import { billModerationLogPage } from '../server/post-moderation';
import { castVote } from '../server/votes';
import { openMemoryDb, type MemoryDb } from './memory';

const VOTE_NOW = Date.parse('2046-05-25T00:00:00+09:00');
const session = sessionAt(VOTE_NOW, null);
const previous = sessionAt(session.startsAt - 1, null);
const NOW = session.deliberationAt + 1000;
const CLOSES = autoHideClosesAt(session.voteAt);
const STAFF = { userId: 'mod', role: 'moderator' as const };
const para = (text: string) => [{ num: '1', text, items: [] }];
const first = () => 0;

function world() {
	const { sqlite, db } = openMemoryDb();
	let counter = 0;
	const addUser = (id = `u${++counter}`, role: string | null = null) => {
		sqlite.prepare('INSERT INTO user (id, name, email, role, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 0)').run(id, `name-${id}`, `${id}@test.invalid`, role);
		// 投票資格：会期の前に今月の参加者に数える行動がある
		sqlite.prepare("INSERT INTO actions (kind, user_id, ip_hash, created_at) VALUES ('support_add', ?, 'x', 0)").run(id);
		return id;
	};
	addUser('issuer');
	addUser('author');
	addUser('mod', 'moderator');
	sqlite.exec("INSERT OR IGNORE INTO committees (id, name) VALUES (1, '第1'); INSERT INTO issues (id, user_id, title, affected, example, topic_id, created_at) VALUES (1, 'issuer', '課題', '人', '例', NULL, 0); INSERT INTO solutions (id, issue_id, user_id, body, created_at) VALUES (1, 1, 'issuer', '解決策', 0);");
	/** 発議した制定の法案（条は3つ）。版は 1 */
	const addBill = (author = 'author', title = `法案${++counter}`) => {
		const id = Number(
			sqlite
				.prepare("INSERT INTO bills (user_id, committee_id, kind, status, rev, next_rev, proposed_rev, title, affected, side_effects, created_at, updated_at, proposed_at) VALUES (?, 1, 'enact', 'proposed', 1, 2, 1, ?, 'a', 's', 0, 0, ?)")
				.run(author, title, previous.deliberationAt + 1).lastInsertRowid
		);
		sqlite.prepare("INSERT INTO bill_laws (bill_id, rev, seq, action, new_title) VALUES (?, 1, 0, 'enact', '新しい法律')").run(id);
		sqlite.prepare('INSERT INTO bill_solutions (bill_id, rev, seq, solution_id) VALUES (?, 1, 0, 1)').run(id);
		for (const num of ['1', '2', '3']) sqlite.prepare("INSERT INTO bill_changes (bill_id, rev, law_seq, num, op, caption, body) VALUES (?, 1, 0, ?, 'add', '（見出し）', ?)").run(id, num, JSON.stringify(para(`第${num}条のもとの本文`)));
		return id;
	};
	const actor = (userId: string, registeredAt = 0) => ({ userId, registeredAt, ipHash: `ip-${userId}` });
	/** レート制限に当たらないよう、出すたびに時刻を進める */
	let clock = 0;
	const addAmendment = async (bill: number, userId = addUser(), num = '1', text = `修正案の本文${++counter}`) => {
		clock += 2 * 86_400_000;
		const result = await createAmendment(db, actor(userId), { billId: bill, sessionKey: session.key, baseRev: 1, lawSeq: 0, num, provisionId: null, paragraphs: para(text), reason: '理由の欄' }, clock);
		if (!result.ok) throw new Error('断られた');
		return result.id;
	};
	const supportBy = (amendment: number, ...users: string[]) => {
		for (const u of users) sqlite.prepare('INSERT INTO amendment_supports (amendment_id, revision, user_id, created_at) VALUES (?, 1, ?, 0)').run(amendment, u);
	};
	const billSupport = (bill: number, userId: string) => sqlite.prepare('INSERT INTO bill_supports (bill_id, rev, user_id, created_at) VALUES (?, 1, ?, 0)').run(bill, userId);
	const cosponsor = (bill: number, userId: string, status: string) => sqlite.prepare('INSERT INTO bill_cosponsors (bill_id, user_id, status, created_at, accepted_at) VALUES (?, ?, ?, 0, 0)').run(bill, userId, status);
	const moderation = (id: number) => (sqlite.prepare('SELECT moderation_status AS s FROM amendments WHERE id = ?').get(id) as { s: string }).s;
	const statusOf = (id: number) => (sqlite.prepare('SELECT status AS s FROM amendments WHERE id = ?').get(id) as { s: string }).s;
	const report = (bill: number, id: number, userId: string, now = NOW, closesAt = CLOSES, registeredAt = 0) => reportAmendment(db, actor(userId, registeredAt), { id, billId: bill, closesAt }, { reason: 'attack', note: null }, now);
	/** 別々の n 人に通報させる */
	const reportBy = async (bill: number, id: number, n: number, now = NOW, closesAt = CLOSES) => {
		for (let i = 0; i < n; i++) expect(await report(bill, id, addUser(), now, closesAt)).toEqual({ ok: true, already: false });
	};
	const hide = (id: number, staff: { userId: string; role: 'moderator' | 'operator' | 'chair' | 'director' } = STAFF, at = NOW) => changeAmendmentModeration(db, id, HIDEABLE, 'hidden', staff, 'attack', 'メモ', at);
	const restore = (id: number, at = NOW + 1) => changeAmendmentModeration(db, id, RESTORABLE, 'restored', STAFF, null, '問題なし', at);
	const row = async (id: number, bill: number) => {
		const found = await amendmentOf(db, id, bill);
		if (!found) throw new Error('修正案がない');
		return found;
	};
	const loaded = async (id: number) => {
		const bill = await billById(db, id);
		if (!bill) throw new Error('法案がない');
		return bill;
	};
	const bodyOf = async (bill: number, num: string) => (await loaded(bill)).laws[0].changes.find((c) => c.num === num)?.paragraphs?.[0].text;
	const inbox = (userId: string) => sqlite.prepare('SELECT kind, target_id AS target, ref_id AS ref FROM notifications WHERE user_id = ? ORDER BY id').all(userId).map((r) => ({ ...r }));
	/** 修正案に投票し、割り当てられた本案すべてに投票する（本案の票がないと有効票にならない） */
	const voteFor = async (amendment: number, users: string[], choice: 'yes' | 'no') => {
		for (const u of users) {
			expect(await castAmendmentVote(db, actor(u), session, previous, amendment, 2, choice, VOTE_NOW, first)).toBe(true);
			for (const { bill_id } of sqlite.prepare('SELECT bill_id FROM vote_assignments WHERE user_id = ?').all(u) as { bill_id: number }[]) await castVote(db, actor(u), session, previous, bill_id, 'yes', VOTE_NOW, first);
		}
	};
	return { sqlite, db: db as MemoryDb, addUser, addBill, addAmendment, supportBy, billSupport, cosponsor, actor, moderation, statusOf, report, reportBy, hide, restore, row, loaded, bodyOf, inbox, voteFor };
}

test('基準1：0024 で列と表とトリガーが増え、既存の行は残り visible になる。moderation_status が変わると記録が1行入る', () => {
	const old = new DatabaseSync(':memory:');
	old.exec('PRAGMA foreign_keys = ON');
	const dir = new URL('../../../drizzle/', import.meta.url);
	const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
	for (const f of files.filter((f) => f < '0024')) old.exec(readFileSync(new URL(f, dir), 'utf8'));
	old.exec(`
		INSERT INTO user (id, name, email, created_at, updated_at) VALUES ('u', 'u', 'u@test.invalid', 0, 0);
		INSERT OR IGNORE INTO committees (id, name) VALUES (1, '第1');
		INSERT INTO bills (id, user_id, committee_id, kind, status, rev, next_rev, title, affected, side_effects, created_at, updated_at) VALUES (1, 'u', 1, 'enact', 'proposed', 1, 2, 't', 'a', 's', 0, 0);
		INSERT INTO amendments (id, bill_id, session_key, user_id, base_rev, law_seq, num, body, created_at, updated_at) VALUES (7, 1, 'k', 'u', 1, 0, '1', '[]', 0, 0);
	`);
	const later = files.filter((f) => f >= '0024');
	expect(later.length).toBeGreaterThan(0);
	for (const f of later) old.exec(readFileSync(new URL(f, dir), 'utf8'));

	expect({ ...old.prepare('SELECT body, status, moderation_status, moderation_actor FROM amendments WHERE id = 7').get() }).toEqual({ body: '[]', status: 'open', moderation_status: 'visible', moderation_actor: null });
	expect(old.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = 'amendments_moderation_log'").all()).toHaveLength(1);

	old.exec("UPDATE amendments SET moderation_note = 'x' WHERE id = 7");
	expect(old.prepare('SELECT count(*) AS n FROM bill_moderation_logs').get()).toEqual({ n: 0 });
	old.exec("UPDATE amendments SET moderation_status = 'hidden', moderation_actor = 'operator', moderation_actor_user_id = 'u', moderation_reason = 'attack', moderation_note = 'メモ', moderation_changed_at = 5 WHERE id = 7");
	expect({ ...old.prepare('SELECT bill_id, post_id, amendment_id, action, actor, actor_user_id, reason, note, created_at FROM bill_moderation_logs').get() }).toEqual({ bill_id: 1, post_id: null, amendment_id: 7, action: 'hide', actor: 'operator', actor_user_id: 'u', reason: 'attack', note: 'メモ', created_at: 5 });
	old.exec("UPDATE amendments SET moderation_status = 'restored', moderation_reason = NULL, moderation_note = '戻す', moderation_changed_at = 6 WHERE id = 7");
	old.exec("UPDATE amendments SET moderation_status = 'auto_hidden', moderation_actor = 'auto', moderation_actor_user_id = NULL, moderation_reason = 'reports', moderation_note = NULL, moderation_changed_at = 7 WHERE id = 7");
	expect(old.prepare('SELECT action FROM bill_moderation_logs ORDER BY id').all().map((r) => r.action)).toEqual(['hide', 'restore', 'auto_hide']);

	const insert = (reason: string) => old.prepare("INSERT INTO amendment_reports (amendment_id, user_id, reason, counted, revision, created_at) VALUES (7, 'u', ?, 1, 1, 0)").run(reason);
	expect(() => insert('bad')).toThrow();
	insert('attack');
	expect(() => insert('spam')).toThrow();
});

test('基準2：別々の3人で自動で非表示になる。関わった人は、あとから関わった場合も含めて数に入らない。更新しても通報は残る。断る場合と上限', async () => {
	const w = world();
	const { db, sqlite } = w;
	const bill = w.addBill();
	const writer = w.addUser();
	const target = await w.addAmendment(bill, writer);

	// 関わった人（提出者、賛同者、共同提出者、抜けた共同提出者、対抗案を出した人、どれかの修正案に賛同している人）と、登録したばかりの人は数に入らない
	const [supporter, member, left, rivalAuthor, rivalSupporter, ownSupporter, fresh] = [w.addUser(), w.addUser(), w.addUser(), w.addUser(), w.addUser(), w.addUser(), w.addUser()];
	w.billSupport(bill, supporter);
	w.cosponsor(bill, member, 'accepted');
	w.cosponsor(bill, left, 'left');
	const rival = await w.addAmendment(bill, rivalAuthor, '2');
	w.supportBy(rival, rivalSupporter);
	w.supportBy(target, ownSupporter);
	for (const id of ['author', supporter, member, left, rivalAuthor, rivalSupporter, ownSupporter]) expect(await w.report(bill, target, id)).toEqual({ ok: true, already: false });
	expect(await w.report(bill, target, fresh, NOW, CLOSES, NOW - 1)).toEqual({ ok: true, already: false });
	expect(w.moderation(target)).toBe('visible');

	await w.reportBy(bill, target, 2);
	expect(w.moderation(target)).toBe('visible');
	await w.reportBy(bill, target, 1);
	expect(w.moderation(target)).toBe('auto_hidden');
	expect({ ...sqlite.prepare('SELECT moderation_actor AS actor, moderation_actor_user_id AS who, moderation_reason AS reason, moderation_note AS note FROM amendments WHERE id = ?').get(target) }).toEqual({ actor: 'auto', who: null, reason: 'reports', note: null });

	// 先に通報してから対抗案を出しても抜けられない（数えるときに判定する）
	const later = await w.addAmendment(bill, undefined, '3');
	const sneaky = w.addUser();
	await w.report(bill, later, sneaky);
	await w.reportBy(bill, later, 1);
	await w.addAmendment(bill, sneaky, '2');
	await w.reportBy(bill, later, 1);
	expect(w.moderation(later)).toBe('visible');
	await w.reportBy(bill, later, 1);
	expect(w.moderation(later)).toBe('auto_hidden');

	// 更新しても通報は残る
	const otherBill = w.addBill();
	const updatedWriter = w.addUser();
	const updated = await w.addAmendment(otherBill, updatedWriter);
	await w.reportBy(otherBill, updated, 2);
	expect(await updateAmendment(db, w.actor(updatedWriter), { id: otherBill, rev: 2 }, await w.row(updated, otherBill), para('書き直した本文'), null, 99 * 86_400_000)).toEqual({ ok: true });
	await w.reportBy(otherBill, updated, 1);
	expect(w.moderation(updated)).toBe('auto_hidden');

	// 表示に戻したあとは自動で消えない
	expect(await w.restore(updated)).toBe(true);
	await w.reportBy(otherBill, updated, 3);
	expect(w.moderation(updated)).toBe('restored');

	// 自分のもの、ほかの法案とない番号、非表示の修正案
	const stranger = w.addUser();
	const open = await w.addAmendment(bill, writer, '1');
	expect(await w.report(bill, open, writer)).toEqual({ ok: false, reason: 'own' });
	expect(await w.report(otherBill, open, stranger)).toEqual({ ok: false, reason: 'missing' });
	expect(await w.report(bill, 99999, stranger)).toEqual({ ok: false, reason: 'missing' });
	expect(await w.report(bill, target, stranger)).toEqual({ ok: false, reason: 'hidden' });

	// 2回目は何もしない
	expect(await w.report(bill, open, stranger)).toEqual({ ok: true, already: false });
	expect(await w.report(bill, open, stranger)).toEqual({ ok: true, already: true });
	expect(sqlite.prepare('SELECT count(*) AS n FROM amendment_reports WHERE amendment_id = ? AND user_id = ?').get(open, stranger)).toEqual({ n: 1 });

	// 上限は課題、解決策、投稿と合わせて10件。超えると違反に数える
	const busy = w.addUser();
	const post = Number(sqlite.prepare("INSERT INTO posts (bill_id, session_key, kind, user_id, body, created_at) VALUES (?, 'k', 'question', 'author', 'b', 0)").run(bill).lastInsertRowid);
	sqlite.prepare("INSERT INTO reports (issue_id, user_id, reason, counted, created_at) VALUES (1, ?, 'attack', 1, ?)").run(busy, NOW - 1);
	sqlite.prepare("INSERT INTO solution_reports (solution_id, user_id, reason, counted, created_at) VALUES (1, ?, 'attack', 1, ?)").run(busy, NOW - 1);
	sqlite.prepare("INSERT INTO post_reports (post_id, user_id, reason, counted, created_at) VALUES (?, ?, 'attack', 1, ?)").run(post, busy, NOW - 1);
	for (let i = 0; i < 7; i++) expect(await w.report(otherBill, await w.addAmendment(otherBill), busy)).toEqual({ ok: true, already: false });
	const over = await w.report(otherBill, await w.addAmendment(otherBill), busy);
	expect(over).toMatchObject({ ok: false, reason: 'limit', refusal: { kind: 'report-day' } });
	expect(sqlite.prepare("SELECT count(*) AS n FROM actions WHERE user_id = ? AND kind = 'violation'").get(busy)).toEqual({ n: 1 });
});

test('基準3：open の修正案は採決の24時間前から処理の前まで3件でも隠れない。処理のあとは新しい通報で隠れる。24時間より前なら隠れる', async () => {
	const w = world();
	const { db } = w;
	// 境の時刻は法案の付託先の会期から求め、今の時計によらない
	const bill = w.addBill();
	expect(amendmentCloseOf(await w.loaded(bill), null)).toBe(session.voteAt - 24 * 60 * 60 * 1000);
	expect(CLOSES).toBe(session.voteAt - 24 * 60 * 60 * 1000);

	// 境の1ミリ秒前は隠れる
	const before = await w.addAmendment(bill);
	await w.reportBy(bill, before, 3, CLOSES - 1);
	expect(w.moderation(before)).toBe('auto_hidden');

	// 境からは隠れない
	const atClose = await w.addAmendment(bill, undefined, '2');
	await w.reportBy(bill, atClose, 3, CLOSES);
	expect(w.moderation(atClose)).toBe('visible');

	// 締切のあと、処理の前も隠れない（入っていた票が捨てられないように）
	const afterDeadline = await w.addAmendment(bill, undefined, '3');
	await w.reportBy(bill, afterDeadline, 3, session.endsAt + 1000);
	expect(w.moderation(afterDeadline)).toBe('visible');
	expect(w.statusOf(afterDeadline)).toBe('open');

	// 処理のあとは、たまった3件だけでは隠れず、新しい通報で隠れる
	await settleAmendments(db, session, bill, 0, session.endsAt);
	expect(w.statusOf(afterDeadline)).toBe('unvoted');
	expect(w.moderation(afterDeadline)).toBe('visible');
	await w.reportBy(bill, afterDeadline, 1, session.endsAt + 2000);
	expect(w.moderation(afterDeadline)).toBe('auto_hidden');

	// 結果の出たものは境のあとでも隠れる（取り込み済みの理由の欄の攻撃も隠せるように）
	const otherBill = w.addBill();
	const accepted = await w.addAmendment(otherBill);
	expect(await acceptAmendment(db, w.actor('author'), otherBill, accepted, 1, NOW)).toBe(true);
	await w.reportBy(otherBill, accepted, 3, CLOSES + 1);
	expect(w.moderation(accepted)).toBe('auto_hidden');
	expect(w.statusOf(accepted)).toBe('accepted');
});

test('基準4：非表示は数に入らず、賛同、取り消し、投票、取り込み、更新を断る。確かめたあとに隠れても書けない。戻すと戻る。本人と運営の欄', async () => {
	const w = world();
	const { db, sqlite } = w;
	const bill = w.addBill();
	const writer = w.addUser();
	const [s1, s2, voter, supporterOfHidden] = [w.addUser(), w.addUser(), w.addUser(), w.addUser()];
	const shown = await w.addAmendment(bill, undefined, '2');
	const target = await w.addAmendment(bill, writer, '1', '隠れる本文');
	w.supportBy(shown, s1, s2);
	w.supportBy(target, s1, supporterOfHidden);
	const rows = async () => (await listAmendments(db, await w.loaded(bill), null, session.key, 2, 1)).rows.map((r) => r.id);
	const count = () => priorVoteCount(db, session.key, { id: bill, rev: 1 }, 2);
	const supports = (id: number) => (sqlite.prepare('SELECT count(*) AS n FROM amendment_supports WHERE amendment_id = ?').get(id) as { n: number }).n;
	expect(await amendmentCount(db, bill)).toBe(2);
	expect(await rows()).toEqual([shown, target]);
	expect(await count()).toBe(2);

	const visibleRow = await w.row(target, bill);
	await w.hide(target);

	// 数と一覧に入らない
	expect(await amendmentCount(db, bill)).toBe(1);
	expect(await rows()).toEqual([shown]);
	expect(await count()).toBe(1);

	// 賛同と取り消しを断る（読み直した行で理由を返す）
	const hiddenRow = await w.row(target, bill);
	expect(await setAmendmentSupport(db, w.actor(w.addUser()), hiddenRow, 1, 1, 'add', NOW)).toEqual({ ok: false, reason: 'hidden' });
	expect(await setAmendmentSupport(db, w.actor(supporterOfHidden), hiddenRow, 1, 1, 'remove', NOW)).toEqual({ ok: false, reason: 'hidden' });
	expect(supports(target)).toBe(2);
	// 確かめたあとに隠れた場合（古い行を渡す）も、文の条件で入らず消えない
	const late = w.addUser();
	await setAmendmentSupport(db, w.actor(late), visibleRow, 1, 1, 'add', NOW);
	await setAmendmentSupport(db, w.actor(supporterOfHidden), visibleRow, 1, 1, 'remove', NOW);
	expect(supports(target)).toBe(2);

	// 投票を断る
	expect(await castAmendmentVote(db, w.actor(voter), session, previous, target, 2, 'yes', VOTE_NOW, first)).toBe(false);
	expect(await myAmendmentVote(db, session.key, target, voter)).toBeNull();

	// 取り込みを断る
	expect(await acceptAmendment(db, w.actor('author'), bill, target, 1, NOW)).toBe(false);
	expect(w.statusOf(target)).toBe('open');
	expect((await w.loaded(bill)).rev).toBe(1);

	// 更新を断る（古い行を渡しても文の条件で止まる）
	expect(await updateAmendment(db, w.actor(writer), { id: bill, rev: 2 }, visibleRow, para('書き直す'), null, NOW)).toEqual({ ok: false, reason: 'closed' });
	expect((await w.row(target, bill)).paragraphs[0].text).toBe('隠れる本文');

	// 本人と運営の欄。ほかの人には何も出ない
	expect(await hiddenAmendmentsFor(db, bill, null, false)).toEqual([]);
	expect(await hiddenAmendmentsFor(db, bill, w.addUser(), false)).toEqual([]);
	const mine = await hiddenAmendmentsFor(db, bill, writer, false);
	expect(mine).toHaveLength(1);
	expect(mine[0]).toMatchObject({ id: target, location: '第1条', reason: '理由の欄', status: 'hidden', statusReason: 'attack', mine: true });
	expect(mine[0].body).toContain('隠れる本文');
	expect(Object.keys(mine[0])).not.toContain('userId');
	expect(await hiddenAmendmentsFor(db, bill, 'mod', true)).toMatchObject([{ id: target, mine: false }]);

	// 表示に戻すと賛同と票が戻る
	expect(await w.restore(target)).toBe(true);
	expect(await amendmentCount(db, bill)).toBe(2);
	expect(await count()).toBe(2);
	expect(await hiddenAmendmentsFor(db, bill, writer, false)).toEqual([]);
	expect(await castAmendmentVote(db, w.actor(voter), session, previous, target, 2, 'yes', VOTE_NOW, first)).toBe(true);
	expect(await myAmendmentVote(db, session.key, target, voter)).toBe('yes');

	// 取り込みは、確かめたあとに隠れても版が進まず、本文が入らない（読んだあと、本文の行を書くときに隠れる）
	const racedBill = w.addBill();
	const raced = await w.addAmendment(racedBill, undefined, '1', '割り込まれる本文');
	sqlite.exec(`CREATE TRIGGER hide_during_accept AFTER INSERT ON bill_laws WHEN NEW.bill_id = ${racedBill} BEGIN UPDATE amendments SET moderation_status = 'hidden', moderation_actor = 'operator', moderation_changed_at = 1 WHERE id = ${raced}; END`);
	expect(await acceptAmendment(db, w.actor('author'), racedBill, raced, 1, NOW)).toBe(false);
	expect((await w.loaded(racedBill)).rev).toBe(1);
	expect(await w.bodyOf(racedBill, '1')).toBe('第1条のもとの本文');
	expect(w.statusOf(raced)).toBe('open');
	expect(await coDrafters(db, racedBill)).toEqual([]);
});

test('基準5：会期の処理で、非表示で open の修正案は票によらず採決されず本文に入らない。取り込み済みは変わらない。結果のあとに戻しても変わらない', async () => {
	const w = world();
	const { db } = w;
	const bill = w.addBill();
	const accepted = await w.addAmendment(bill, undefined, '3', '取り込まれた本文');
	expect(await acceptAmendment(db, w.actor('author'), bill, accepted, 1, NOW)).toBe(true);
	const billRev = (await w.loaded(bill)).rev;

	const hidden = await w.addAmendment(bill, undefined, '1', '隠れた本文');
	const shown = await w.addAmendment(bill, undefined, '2', '可決する本文');
	for (const a of [hidden, shown]) {
		w.sqlite.prepare('UPDATE amendments SET base_rev = ? WHERE id = ?').run(billRev, a);
		w.supportBy(a, w.addUser(), w.addUser());
	}
	const yes = Array.from({ length: 12 }, () => w.addUser());
	await w.voteFor(hidden, yes, 'yes');
	await w.voteFor(shown, yes, 'yes');

	// 採決の期間に、委員長か運営が理由を公開して外す。取り込み済みの修正案も隠す
	expect(await w.hide(hidden)).toBe(true);
	expect(await w.hide(accepted)).toBe(true);

	await settleAmendments(db, session, bill, 0, session.endsAt);
	expect(w.statusOf(hidden)).toBe('unvoted');
	expect(w.statusOf(shown)).toBe('passed');
	expect(w.statusOf(accepted)).toBe('accepted');
	expect(await w.bodyOf(bill, '1')).toBe('第1条のもとの本文');
	expect(await w.bodyOf(bill, '2')).toBe('可決する本文');
	expect(await w.bodyOf(bill, '3')).toBe('取り込まれた本文');
	// 書き手の名前は共同起草者に残る
	const names = await coDrafters(db, bill);
	expect(names).toHaveLength(2);

	// 結果のあとに表示に戻しても、採決はやり直さない
	expect(await w.restore(hidden)).toBe(true);
	await settleAmendments(db, session, bill, 0, session.endsAt + 1);
	expect(w.statusOf(hidden)).toBe('unvoted');
	expect(await w.bodyOf(bill, '1')).toBe('第1条のもとの本文');

	// 可決のあとに隠しても、本文と共同起草者は変わらない
	expect(await w.hide(shown)).toBe(true);
	expect(await w.bodyOf(bill, '2')).toBe('可決する本文');
	expect(await coDrafters(db, bill)).toEqual(names);
});

test('基準6：運営の画面に通報された修正案が出て、非表示と表示に戻すができる。更新が分かる。扱えない人は枠の外で除かれ、扱えない', async () => {
	const w = world();
	const { db, sqlite } = w;
	const bill = w.addBill(undefined, '扱える法案');
	const writer = w.addUser();
	const target = await w.addAmendment(bill, writer, '1', '通報された本文');
	const [r1, r2] = [w.addUser(), w.addUser()];
	await reportAmendment(db, w.actor(r1), { id: target, billId: bill, closesAt: CLOSES }, { reason: 'other', note: '説明の文' }, NOW);
	await reportAmendment(db, w.actor(r2), { id: target, billId: bill, closesAt: CLOSES }, { reason: 'spam', note: null }, NOW);
	await reportAmendment(db, w.actor('author'), { id: target, billId: bill, closesAt: CLOSES }, { reason: 'attack', note: null }, NOW);

	const row = (await reportedAmendments(db, STAFF, null)).find((r) => r.id === target);
	// 関わった人（提出者）の通報は「数に入らないもの」で、自動の非表示と同じ式
	expect(row).toMatchObject({ billId: bill, billTitle: '扱える法案', location: '第1条', reason: '理由の欄', moderationStatus: 'visible', status: 'open', total: 3, counted: 2, other: 1, spam: 1, attack: 1, notes: ['説明の文'], updatedAfterReport: false });
	expect(row?.body).toContain('通報された本文');
	expect(Object.keys(row as object)).not.toContain('userId');

	// あとから関わった人は「数に入るもの」からも外れる
	await w.addAmendment(bill, r2, '3');
	expect((await reportedAmendments(db, STAFF, null)).find((r) => r.id === target)?.counted).toBe(1);

	// 最後の通報のあとの更新が分かる
	expect(await updateAmendment(db, w.actor(writer), { id: bill, rev: 2 }, await w.row(target, bill), para('書き直した本文'), null, 99 * 86_400_000)).toEqual({ ok: true });
	expect((await reportedAmendments(db, STAFF, null)).find((r) => r.id === target)?.updatedAfterReport).toBe(true);

	// 状態の移り変わり
	expect(await changeAmendmentModeration(db, target, RESTORABLE, 'restored', STAFF, null, 'm', NOW)).toBe(false);
	expect(await w.hide(target)).toBe(true);
	expect(await w.hide(target)).toBe(false);
	expect(await w.restore(target)).toBe(true);
	expect(await w.restore(target)).toBe(false);

	// 通報されていない修正案は focus で出る
	const quiet = await w.addAmendment(bill, writer, '2', '通報のない本文');
	expect((await reportedAmendments(db, STAFF, null)).some((r) => r.id === quiet)).toBe(false);
	expect((await reportedAmendments(db, STAFF, quiet))[0]).toMatchObject({ id: quiet, total: 0 });

	// 委員長と代行の理事も扱える
	const [chair, director, recalledChair] = [w.addUser(), w.addUser(), w.addUser()];
	const addTerm = (userId: string, role: string, rank: number, recalledAt: number | null) => sqlite.prepare('INSERT INTO chair_terms (committee_id, session_key, user_id, role, rank, votes, recalled_at, created_at) VALUES (1, ?, ?, ?, ?, 1, ?, 0)').run(session.key, userId, role, rank, recalledAt);
	addTerm(chair, 'chair', 0, null);
	expect(await staffRoleOf(db, chair, NOW, null)).toBe('chair');
	expect(await amendmentStaffAccess(db, quiet, { userId: chair, role: 'chair' })).toBe('ok');
	sqlite.prepare('DELETE FROM chair_terms').run();
	addTerm(recalledChair, 'chair', 0, NOW - 1);
	addTerm(director, 'director', 1, null);
	expect(await staffRoleOf(db, director, NOW, null)).toBe('director');
	expect(await amendmentStaffAccess(db, quiet, { userId: director, role: 'director' })).toBe('ok');
	expect(await staffOnAmendments(db, bill, 'mod', NOW, null)).toBe(true);
	expect(await staffOnAmendments(db, bill, w.addUser(), NOW, null)).toBe(false);

	// 扱えない人：ない番号、自分のもの、関わった法案、同じ法案に修正案を出した人、どれかの修正案に賛同している人、委員長と理事は投票した人
	const staffOf = (userId: string, role: 'moderator' | 'chair' = 'moderator') => ({ userId, role });
	const rivalBill = w.addBill(undefined, '対抗案のある法案');
	const rivalTarget = await w.addAmendment(rivalBill, writer, '1', '対抗案を消される本文');
	expect(await amendmentStaffAccess(db, 99999, STAFF)).toBe('missing');
	const mine = w.addUser('mine-mod', 'moderator');
	const own = await w.addAmendment(rivalBill, mine, '2');
	expect(await amendmentStaffAccess(db, own, staffOf(mine))).toBe('own');
	expect(await amendmentStaffAccess(db, rivalTarget, staffOf(mine))).toBe('involved');
	const billSide = w.addUser('side-mod', 'moderator');
	w.billSupport(rivalBill, billSide);
	expect(await amendmentStaffAccess(db, rivalTarget, staffOf(billSide))).toBe('involved');
	const rivalSupporter = w.addUser('sup-mod', 'moderator');
	w.supportBy(own, rivalSupporter);
	expect(await amendmentStaffAccess(db, rivalTarget, staffOf(rivalSupporter))).toBe('involved');
	expect(await staffOnAmendments(db, rivalBill, rivalSupporter, NOW, null)).toBe(false);
	const votedChair = w.addUser();
	sqlite.prepare("INSERT INTO amendment_votes (session_key, amendment_id, user_id, choice, created_at, updated_at) VALUES (?, ?, ?, 'yes', 0, 0)").run(session.key, own, votedChair);
	expect(await amendmentStaffAccess(db, rivalTarget, staffOf(votedChair, 'chair'))).toBe('involved');
	expect(await amendmentStaffAccess(db, rivalTarget, staffOf(votedChair))).toBe('ok');

	// 除くのは100件に絞る前：扱えない法案の新しい通報が100件あっても、扱える古い行が残る
	const older = await w.addAmendment(bill, writer, '3', '古い通報の本文');
	sqlite.prepare("INSERT INTO amendment_reports (amendment_id, user_id, reason, counted, revision, created_at) VALUES (?, ?, 'attack', 1, 1, 1)").run(older, r1);
	for (let i = 0; i < 100; i++) sqlite.prepare("INSERT INTO amendment_reports (amendment_id, user_id, reason, counted, revision, created_at) VALUES (?, ?, 'attack', 1, 1, ?)").run(await w.addAmendment(rivalBill, undefined, '3'), r1, NOW);
	const listed = await reportedAmendments(db, staffOf(rivalSupporter), null);
	expect(listed.some((r) => r.id === older)).toBe(true);
	expect(listed.some((r) => r.billId === rivalBill)).toBe(false);

	// 通報済みの判定は法案で引く
	expect((await reportedAmendmentIds(db, r1, bill)).sort()).toEqual([older, target].sort());
	expect(await reportedAmendmentIds(db, r1, w.addBill())).toEqual([]);
});

test('基準7：公開の記録に修正案として出て本文と書いた人を返さない。委員長の操作は最後の操作に数え、理事は数えない。書いた人に通知が届く', async () => {
	const w = world();
	const { db } = w;
	const bill = w.addBill(undefined, '記録の法案');
	const writer = w.addUser();
	const target = await w.addAmendment(bill, writer, '1', '記録に出ない本文');
	const reported = await w.addAmendment(bill, writer, '2');

	await w.hide(target, { userId: 'mod', role: 'moderator' }, NOW);
	await w.restore(target, NOW + 1);
	await w.reportBy(bill, reported, 3);

	const { rows, hasNext } = await billModerationLogPage(db, 1);
	expect(hasNext).toBe(false);
	expect(rows.map((r) => [r.kind, r.action, r.actor, r.reason, r.note])).toEqual([
		['amendment', 'auto_hide', 'auto', 'reports', null],
		['amendment', 'restore', 'moderator', null, '問題なし'],
		['amendment', 'hide', 'moderator', 'attack', 'メモ']
	]);
	expect(rows[0]).toMatchObject({ billId: bill, title: '記録の法案' });
	const text = JSON.stringify(rows);
	expect(text).not.toContain('記録に出ない本文');
	expect(text).not.toContain(writer);

	const [chair, director] = [w.addUser(), w.addUser()];
	const at = session.deliberationAt + 5000;
	expect(await lastChairAction(db, chair, session)).toBeNull();
	await w.hide(await w.addAmendment(bill, writer, '3'), { userId: chair, role: 'chair' }, at);
	expect(await lastChairAction(db, chair, session)).toBe(at);
	await w.hide(await w.addAmendment(bill, writer, '3'), { userId: director, role: 'director' }, at + 1);
	expect(await lastChairAction(db, director, session)).toBeNull();

	const notified = w.addUser();
	const own = await w.addAmendment(bill, notified, '3');
	expect(await w.hide(own, STAFF, NOW)).toBe(true);
	expect(await w.restore(own, NOW + 1)).toBe(true);
	expect(await w.hide(own, STAFF, NOW + 2)).toBe(true);
	expect(w.inbox(notified)).toEqual([
		{ kind: 'amendment_hidden', target: own, ref: NOW },
		{ kind: 'amendment_restored', target: own, ref: NOW + 1 },
		{ kind: 'amendment_hidden', target: own, ref: NOW + 2 }
	]);
	expect(await w.hide(own, STAFF, NOW + 3)).toBe(false);
	expect(w.inbox(notified)).toHaveLength(3);
	expect(w.inbox(writer).map((r) => r.kind)).toContain('amendment_hidden');

	// 一覧では法案の題名と修正案のタブへのリンクになる（ほかの種類に落ちない）
	const page = await notificationPage(db, notified, NOW + 10, null, 1);
	const items = page.items.filter((i) => i.kind === 'amendment_hidden' || i.kind === 'amendment_restored');
	expect(items).toHaveLength(3);
	for (const item of items) expect(item).toMatchObject({ title: '記録の法案', href: `/houan/${bill}/shusei` });
});
