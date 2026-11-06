// Issue #76 基準1〜5・7〜9：共同提出者、撤回、統合案（設計書 docs/spec/76.md）
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { expect, test } from 'vitest';
import { billProgress, withdrawableSince } from '../domain/bills';
import { canResubmit } from '../domain/votes';
import { scoredStance } from '../domain/evaluations';
import { LIMITS } from '../domain/limits';
import { sessionAt, type Session } from '../domain/session';
import { addSupportRow, billById, billSupportState, draftInputOf, listBills, proposeBill, relatedBills, saveDraft, setBillSupport } from '../server/bills';
import { billRoleOf, canEditDraft, cancelCosponsorRequest, cosponsorsOf, decideCosponsor, isBillSide, leaveCosponsor, requestCosponsor } from '../server/cosponsors';
import { saveAdjustedBill } from '../server/if-world';
import { cancelMerge, consentMerge, createMerge, mergeBlock, mergeLinksOf, revokeMerge } from '../server/merge';
import { billStageNow, involvedInBill, pendingReviews, settleSession } from '../server/results';
import { resubmitBill } from '../server/resubmit';
import { assignedBills, billsInVote, castVote } from '../server/votes';
import { cancelWithdraw, consentWithdraw, withdrawStateOf } from '../server/withdraw';
import { openMemoryDb, type MemoryDb } from './memory';

const jst = (s: string) => Date.parse(`${s}+09:00`);
const monthOf = (key: string) => sessionAt(jst(`${key}-10T00:00:00`), null);
const previousOf = (s: Session) => sessionAt(s.startsAt - 1, null);
const nextOf = (s: Session) => sessionAt(s.endsAt, null);
const after = (s: Session) => s.endsAt + 60_000;
const para = (text: string) => JSON.stringify([{ num: '1', text, items: [] }]);

function world() {
	const { sqlite, db } = openMemoryDb();
	sqlite.exec("INSERT INTO user (id, name, email, created_at, updated_at) VALUES ('issuer', 'i', 'i@test.invalid', 0, 0); INSERT INTO issues (id, user_id, title, affected, example, topic_id, created_at) VALUES (1, 'issuer', '課題', '人', '例', NULL, 0); INSERT INTO solutions (id, issue_id, user_id, body, created_at) VALUES (1, 1, 'issuer', '解決策', 0); INSERT OR IGNORE INTO committees (id, name) VALUES (1, '第1'), (2, '第2');");
	let counter = 0;
	const unique = () => ++counter;
	const addUser = () => {
		const id = `f${unique()}`;
		sqlite.prepare('INSERT INTO user (id, name, email, created_at, updated_at) VALUES (?, ?, ?, 0, 0)').run(id, `名前${id}`, `${id}@test.invalid`);
		return id;
	};
	function addLaw() {
		const n = unique();
		const lawId = `L${n}`;
		const revisionId = `R${n}`;
		sqlite.prepare("INSERT INTO laws (id, title, law_num) VALUES (?, ?, '番号')").run(lawId, `法令${n}`);
		sqlite.prepare("INSERT INTO law_revisions (id, law_id, branch, seq, enforcement_date, status) VALUES (?, ?, 'real', 0, '2020-01-01', 'enforced')").run(revisionId, lawId);
		const article = Number(sqlite.prepare("INSERT INTO provisions (law_id, kind) VALUES (?, 'article')").run(lawId).lastInsertRowid);
		sqlite.prepare("INSERT INTO provision_versions (provision_id, from_revision_id, num, caption, change) VALUES (?, ?, '1', '（見出し）', 'baseline')").run(article, revisionId);
		const paragraph = Number(sqlite.prepare("INSERT INTO provisions (law_id, kind, parent_id) VALUES (?, 'paragraph', ?)").run(lawId, article).lastInsertRowid);
		sqlite.prepare("INSERT INTO provision_versions (provision_id, from_revision_id, num, text, change) VALUES (?, ?, '1', '本文', 'baseline')").run(paragraph, revisionId);
		return { lawId, revisionId, article };
	}
	type Law = ReturnType<typeof addLaw>;
	/** 法案。at を渡すと発議した法案、渡さないと下書き */
	function addBill(law: Law, opts: { at?: number; user?: string; title?: string; committee?: number } = {}) {
		const author = opts.user ?? addUser();
		const proposed = opts.at !== undefined;
		const id = Number(
			sqlite
				.prepare("INSERT INTO bills (user_id, committee_id, kind, status, rev, next_rev, proposed_rev, title, affected, side_effects, created_at, updated_at, proposed_at) VALUES (?, ?, 'amend', ?, 1, 2, ?, ?, '困っている人', '副作用', 0, 0, ?)")
				.run(author, opts.committee ?? 1, proposed ? 'proposed' : 'draft', proposed ? 1 : null, opts.title ?? `法案${unique()}`, opts.at ?? null).lastInsertRowid
		);
		sqlite.prepare("INSERT INTO bill_laws (bill_id, rev, seq, action, law_id, base_revision_id, base_if_seq) VALUES (?, 1, 0, 'amend', ?, ?, 0)").run(id, law.lawId, law.revisionId);
		sqlite.prepare('INSERT INTO bill_solutions (bill_id, rev, seq, solution_id) VALUES (?, 1, 0, 1)').run(id);
		sqlite.prepare("INSERT INTO bill_changes (bill_id, rev, law_seq, num, op, provision_id, caption, body) VALUES (?, 1, 0, '1', 'amend', ?, '（見出し）', ?)").run(id, law.article, para('本文を変える'));
		return { id, author };
	}
	const actorOf = (userId: string) => ({ userId, registeredAt: 0, ipHash: `ip-${userId}` });
	const load = async (id: number) => (await billById(db, id)) as NonNullable<Awaited<ReturnType<typeof billById>>>;
	const rowOf = (bill: number, userId: string) => sqlite.prepare('SELECT id, status, accepted_at AS acceptedAt FROM bill_cosponsors WHERE bill_id = ? AND user_id = ?').get(bill, userId) as { id: number; status: string; acceptedAt: number | null } | undefined;
	const support = (bill: number, userId: string, rev = 1) => sqlite.prepare('INSERT INTO bill_supports (bill_id, rev, user_id, created_at) VALUES (?, ?, ?, 0)').run(bill, rev, userId);
	const supportsOf = (bill: number) => (sqlite.prepare('SELECT count(*) AS n FROM bill_supports WHERE bill_id = ?').get(bill) as { n: number }).n;
	const count = (kind: string, userId: string) => (sqlite.prepare('SELECT count(*) AS n FROM actions WHERE kind = ? AND user_id = ?').get(kind, userId) as { n: number }).n;
	/** 共同提出者にする（実際の操作を通す） */
	async function makeCosponsor(bill: { id: number; author: string }, userId = addUser(), now = 1000) {
		await requestCosponsor(db, actorOf(userId), await load(bill.id), now);
		const row = rowOf(bill.id, userId) as { id: number };
		const decided = await decideCosponsor(db as MemoryDb, actorOf(bill.author), await load(bill.id), row.id, 'accept', now);
		expect(decided).toEqual({ ok: true });
		return userId;
	}
	const statusOf = (bill: number) => (sqlite.prepare('SELECT status, withdrawn_at AS at FROM bills WHERE id = ?').get(bill) as { status: string; at: number | null });
	return { sqlite, db: db as MemoryDb, addUser, addLaw, addBill, actorOf, load, rowOf, support, supportsOf, count, makeCosponsor, statusOf };
}

test('基準1：0020 で表が増え、actions を作り直しても既存の行は残り、新しい種類を入れられる', () => {
	const old = new DatabaseSync(':memory:');
	old.exec('PRAGMA foreign_keys = ON');
	const dir = new URL('../../../drizzle/', import.meta.url);
	const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
	for (const f of files.filter((f) => f < '0020')) old.exec(readFileSync(new URL(f, dir), 'utf8'));
	old.exec("INSERT INTO user (id, name, email, created_at, updated_at) VALUES ('u', 'u', 'u@test.invalid', 0, 0)");
	old.exec("INSERT INTO actions (id, kind, user_id, ip_hash, target_id, created_at) VALUES (7, 'vote_cast', 'u', 'h', 9, 5)");
	old.exec("INSERT INTO bills (id, user_id, committee_id, kind, rev, next_rev, title, affected, side_effects, created_at, updated_at) VALUES (1, 'u', 1, 'amend', 1, 2, 't', 'a', 's', 0, 0)");
	const later = files.filter((f) => f >= '0020');
	expect(later.length).toBeGreaterThan(0);
	for (const f of later) old.exec(readFileSync(new URL(f, dir), 'utf8'));
	expect(old.prepare('SELECT id, kind, user_id, ip_hash, target_id, created_at FROM actions').all().map((r) => ({ ...r }))).toEqual([{ id: 7, kind: 'vote_cast', user_id: 'u', ip_hash: 'h', target_id: 9, created_at: 5 }]);
	expect({ ...old.prepare('SELECT status, withdrawn_at FROM bills').get() }).toEqual({ status: 'draft', withdrawn_at: null });
	for (const kind of ['bill_cosponsor', 'bill_withdraw']) old.exec(`INSERT INTO actions (kind, user_id, ip_hash, created_at) VALUES ('${kind}', 'u', 'h', 6)`);
	for (const table of ['bill_cosponsors', 'bill_withdraw_consents', 'bill_relations', 'bill_merge_consents']) expect({ ...old.prepare(`SELECT count(*) AS n FROM ${table}`).get() }).toEqual({ n: 0 });
	// 索引が張り直されている
	const indexes = old.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'actions'").all().map((r) => r.name);
	expect(indexes).toEqual(expect.arrayContaining(['actions_user', 'actions_ip', 'actions_target']));
});

test('基準2：申し出から抜けるまでの操作、上限、権限', async () => {
	const w = world();
	const now = 1000;
	const bill = w.addBill(w.addLaw());
	const load = () => w.load(bill.id);
	const x = w.addUser();

	// 申し出と取り下げ。同じ操作は何もしない。行が変わったときだけ記録する
	expect(await requestCosponsor(w.db, w.actorOf(x), await load(), now)).toEqual({ ok: true, changed: true });
	expect(await requestCosponsor(w.db, w.actorOf(x), await load(), now)).toEqual({ ok: true, changed: false });
	expect(w.count('bill_cosponsor', x)).toBe(1);
	expect(w.rowOf(bill.id, x)).toMatchObject({ status: 'requested', acceptedAt: null });
	// 申し出だけでは権限がない
	expect(await canEditDraft(w.db, await load(), x)).toBe(false);
	expect(await billRoleOf(w.db, await load(), x)).toBeNull();
	expect(await isBillSide(w.db, await load(), x)).toBe(false);
	expect(await saveDraft(w.db, bill.id, x, 1, draftInputOf(await load()), now)).toBe(false);
	expect(await cosponsorsOf(w.db, bill.id)).toEqual([]);
	expect(await cancelCosponsorRequest(w.db, w.actorOf(x), await load())).toBe(true);
	expect(w.rowOf(bill.id, x)).toBeUndefined();
	expect(await cancelCosponsorRequest(w.db, w.actorOf(x), await load())).toBe(false);
	expect(await requestCosponsor(w.db, w.actorOf(x), await load(), now)).toEqual({ ok: true, changed: true });

	// 提出者は申し出できない。提出者でない人は決められない
	expect(await requestCosponsor(w.db, w.actorOf(bill.author), await load(), now)).toEqual({ ok: false, reason: 'author' });
	const rowId = (w.rowOf(bill.id, x) as { id: number }).id;
	const other = w.addUser();
	expect(await decideCosponsor(w.db, w.actorOf(other), await load(), rowId, 'accept', now)).toEqual({ ok: false, reason: 'forbidden' });

	// 承認すると名前が出る
	expect(await decideCosponsor(w.db, w.actorOf(bill.author), await load(), rowId, 'accept', now)).toEqual({ ok: true });
	expect(w.rowOf(bill.id, x)).toMatchObject({ status: 'accepted', acceptedAt: now });
	expect(await cosponsorsOf(w.db, bill.id)).toEqual([`名前${x}`]);

	// 断られると再度できない
	const y = w.addUser();
	await requestCosponsor(w.db, w.actorOf(y), await load(), now);
	const yId = (w.rowOf(bill.id, y) as { id: number }).id;
	expect(await decideCosponsor(w.db, w.actorOf(bill.author), await load(), yId, 'decline', now)).toEqual({ ok: true });
	expect(w.rowOf(bill.id, y)).toMatchObject({ status: 'declined' });
	expect(await requestCosponsor(w.db, w.actorOf(y), await load(), now)).toEqual({ ok: false, reason: 'declined' });
	expect(await cancelCosponsorRequest(w.db, w.actorOf(y), await load())).toBe(false);

	// 抜ける。外す。再度の申し出はできない
	expect(await leaveCosponsor(w.db, w.actorOf(x), await load(), null)).toEqual({ ok: true });
	expect(w.rowOf(bill.id, x)).toMatchObject({ status: 'left' });
	expect(await requestCosponsor(w.db, w.actorOf(x), await load(), now)).toEqual({ ok: false, reason: 'left' });
	expect(await cosponsorsOf(w.db, bill.id)).toEqual([]);
	const z = await w.makeCosponsor(bill);
	expect(await leaveCosponsor(w.db, w.actorOf(other), await load(), (w.rowOf(bill.id, z) as { id: number }).id)).toEqual({ ok: false, reason: 'forbidden' });
	expect(await leaveCosponsor(w.db, w.actorOf(bill.author), await load(), (w.rowOf(bill.id, z) as { id: number }).id)).toEqual({ ok: true });
	expect(w.rowOf(bill.id, z)).toMatchObject({ status: 'left' });
	expect(await leaveCosponsor(w.db, w.actorOf(other), await load(), null)).toEqual({ ok: false, reason: 'forbidden' });

	// 6人目は承認できない
	for (let i = 0; i < 5; i++) await w.makeCosponsor(bill);
	const sixth = w.addUser();
	await requestCosponsor(w.db, w.actorOf(sixth), await load(), now);
	expect(await decideCosponsor(w.db, w.actorOf(bill.author), await load(), (w.rowOf(bill.id, sixth) as { id: number }).id, 'accept', now)).toEqual({ ok: false, reason: 'full' });
	expect(w.rowOf(bill.id, sixth)).toMatchObject({ status: 'requested' });
	expect(await cosponsorsOf(w.db, bill.id)).toHaveLength(5);

	// 別の法案の行は指せない
	const elsewhere = w.addBill(w.addLaw());
	expect(await decideCosponsor(w.db, w.actorOf(elsewhere.author), await w.load(elsewhere.id), (w.rowOf(bill.id, sixth) as { id: number }).id, 'accept', now)).toEqual({ ok: false, reason: 'closed' });

	// 発議のあとは何も変えられない
	const accepted = (await cosponsorsOf(w.db, bill.id)).length;
	w.sqlite.prepare("UPDATE bills SET status = 'proposed', proposed_at = 1, proposed_rev = rev WHERE id = ?").run(bill.id);
	const late = w.addUser();
	expect(await requestCosponsor(w.db, w.actorOf(late), await load(), now)).toEqual({ ok: false, reason: 'closed' });
	expect(await decideCosponsor(w.db, w.actorOf(bill.author), await load(), (w.rowOf(bill.id, sixth) as { id: number }).id, 'decline', now)).toEqual({ ok: false, reason: 'closed' });
	expect(await cancelCosponsorRequest(w.db, w.actorOf(sixth), await load())).toBe(false);
	const member = w.sqlite.prepare("SELECT id, user_id AS userId FROM bill_cosponsors WHERE bill_id = ? AND status = 'accepted' LIMIT 1").get(bill.id) as { id: number; userId: string };
	expect(await leaveCosponsor(w.db, w.actorOf(member.userId), await load(), null)).toEqual({ ok: false, reason: 'closed' });
	expect(await cosponsorsOf(w.db, bill.id)).toHaveLength(accepted);

	// 上限を超えると作らず、違反に数える
	const busy = w.addUser();
	const open = w.addBill(w.addLaw());
	for (let i = 0; i < LIMITS.billCosponsorPerDay; i++) w.sqlite.prepare("INSERT INTO actions (kind, user_id, ip_hash, created_at) VALUES ('bill_cosponsor', ?, 'x', ?)").run(busy, now - 1);
	expect(await requestCosponsor(w.db, w.actorOf(busy), await w.load(open.id), now)).toMatchObject({ ok: false, refusal: { kind: 'bill-cosponsor-day' } });
	expect(w.rowOf(open.id, busy)).toBeUndefined();
	expect(w.count('violation', busy)).toBe(1);
	// 今月の参加者に数えない
	const s = sessionAt(now, null);
	expect(w.sqlite.prepare("SELECT kind FROM actions WHERE kind = 'bill_cosponsor' AND created_at > ?").all(s.startsAt - 1e12).length).toBeGreaterThan(0);
}, 30_000);

test('基準3：共同提出者は下書きを編集できる。提出者だけの操作と、読んだ版の確かめ', async () => {
	const w = world();
	const now = 1000;
	const bill = w.addBill(w.addLaw());
	const load = () => w.load(bill.id);
	const co = await w.makeCosponsor(bill);
	const backer = w.addUser();
	w.support(bill.id, backer);

	// 編集でき、保存で賛同は集め直し
	expect(await canEditDraft(w.db, await load(), co)).toBe(true);
	const input = { ...draftInputOf(await load()), title: '共同提出者が直した題名' };
	expect(await saveDraft(w.db, bill.id, co, 1, input, now)).toBe(true);
	const saved = await load();
	expect(saved).toMatchObject({ title: '共同提出者が直した題名', rev: 2 });
	expect((await billSupportState(w.db, bill.id, saved.rev, null)).supports).toBe(0);
	// 古い版からの保存は上書きしない
	expect(await saveDraft(w.db, bill.id, bill.author, 1, input, now)).toBe(false);
	// 賛同者とほかの人は編集できない
	expect(await canEditDraft(w.db, saved, backer)).toBe(false);
	expect(await saveDraft(w.db, bill.id, backer, saved.rev, input, now)).toBe(false);

	// 発議は提出者だけ。読んだ版と違えば断る
	expect(await proposeBill(w.db, w.actorOf(co), bill.id, saved.rev, 0, now)).toEqual({ ok: false, reason: 'notAuthor' });
	expect(await proposeBill(w.db, w.actorOf(bill.author), bill.id, 1, 0, now)).toEqual({ ok: false, reason: 'stale' });
	expect(await load()).toMatchObject({ status: 'draft' });

	// 承認は提出者だけ
	const asker = w.addUser();
	await requestCosponsor(w.db, w.actorOf(asker), saved, now);
	expect(await decideCosponsor(w.db, w.actorOf(co), saved, (w.rowOf(bill.id, asker) as { id: number }).id, 'accept', now)).toEqual({ ok: false, reason: 'forbidden' });

	// 修正案を出せないのは共同提出者も同じで、抜けた人も同じ
	expect(await isBillSide(w.db, saved, co)).toBe(true);
	expect(await isBillSide(w.db, saved, backer)).toBe(false);

	// 要調整を直すのは提出者だけで、共同提出者の下書きの編集は発議のあとは効かない
	expect(await proposeBill(w.db, w.actorOf(bill.author), bill.id, saved.rev, 0, now)).toEqual({ ok: true });
	const proposed = await load();
	expect(await canEditDraft(w.db, proposed, co)).toBe(false);
	expect(await saveDraft(w.db, bill.id, co, proposed.rev, input, now)).toBe(false);
	expect(await saveAdjustedBill(w.db, w.actorOf(co), proposed, proposed.rev, input, now)).toEqual({ ok: true, saved: false });

	// 抜けると編集できない。出し直しに共同提出者は引き継がない
	const other = w.addBill(w.addLaw());
	const gone = await w.makeCosponsor(other);
	await leaveCosponsor(w.db, w.actorOf(gone), await w.load(other.id), null);
	expect(await canEditDraft(w.db, await w.load(other.id), gone)).toBe(false);
	expect(await saveDraft(w.db, other.id, gone, 1, draftInputOf(await w.load(other.id)), now)).toBe(false);
	const copy = await resubmitBill(w.db, w.actorOf(bill.author), proposed, now);
	expect(await cosponsorsOf(w.db, (copy as { id: number }).id)).toEqual([]);
}, 30_000);

test('基準4：共同提出者は賛同できず、承認で賛同が外れる。通らなかった承認では消えない', async () => {
	const w = world();
	const now = 1000;
	const bill = w.addBill(w.addLaw());
	const load = () => w.load(bill.id);

	const backer = w.addUser();
	w.support(bill.id, backer);
	w.support(bill.id, backer, 7);
	await requestCosponsor(w.db, w.actorOf(backer), await load(), now);
	expect(w.supportsOf(bill.id)).toBe(2);
	expect(await decideCosponsor(w.db, w.actorOf(bill.author), await load(), (w.rowOf(bill.id, backer) as { id: number }).id, 'accept', now)).toEqual({ ok: true });
	expect(w.supportsOf(bill.id)).toBe(0);
	expect(await proposeBill(w.db, w.actorOf(bill.author), bill.id, 1, 1, now)).toEqual({ ok: false, reason: 'short' });

	expect(await setBillSupport(w.db, w.actorOf(backer), bill.id, 1, 'add', now)).toEqual({ ok: false, reason: 'cosponsor' });
	expect(w.supportsOf(bill.id)).toBe(0);
	// 賛同を入れる文そのものが、共同提出者と抜けた人を入れない（確かめのあとに承認が走っても残らない）
	expect(await addSupportRow(w.db, bill.id, 1, backer, now)).toEqual([]);
	await leaveCosponsor(w.db, w.actorOf(backer), await load(), null);
	expect(await setBillSupport(w.db, w.actorOf(backer), bill.id, 1, 'add', now)).toEqual({ ok: false, reason: 'formerCosponsor' });
	expect(await addSupportRow(w.db, bill.id, 1, backer, now)).toEqual([]);
	// 申し出ているだけなら賛同できる
	const asker = w.addUser();
	await requestCosponsor(w.db, w.actorOf(asker), await load(), now);
	expect(await setBillSupport(w.db, w.actorOf(asker), bill.id, 1, 'add', now)).toEqual({ ok: true, changed: true });

	// 通らなかった承認（6人目）では賛同は消えない
	for (let i = 0; i < 5; i++) await w.makeCosponsor(bill);
	const before = w.supportsOf(bill.id);
	expect(await decideCosponsor(w.db, w.actorOf(bill.author), await load(), (w.rowOf(bill.id, asker) as { id: number }).id, 'accept', now)).toEqual({ ok: false, reason: 'full' });
	expect(w.supportsOf(bill.id)).toBe(before);
	// 発議と重なって通らなかった承認でも消えない
	w.sqlite.prepare("UPDATE bills SET status = 'proposed', proposed_at = 1, proposed_rev = rev WHERE id = ?").run(bill.id);
	const open = w.addBill(w.addLaw());
	const third = w.addUser();
	w.support(open.id, third);
	await requestCosponsor(w.db, w.actorOf(third), await w.load(open.id), now);
	const stale = await w.load(open.id);
	w.sqlite.prepare("UPDATE bills SET status = 'proposed', proposed_at = 1, proposed_rev = rev WHERE id = ?").run(open.id);
	expect(await decideCosponsor(w.db, w.actorOf(open.author), stale, (w.rowOf(open.id, third) as { id: number }).id, 'accept', now)).toEqual({ ok: false, reason: 'closed' });
	expect(w.supportsOf(open.id)).toBe(1);
}, 30_000);

test('基準5：答弁と評価の役割、票の割り当て、結果の確認。抜けた人は提出者の側のまま', async () => {
	const w = world();
	const s = monthOf('2030-05');
	const previous = previousOf(s);
	const now = 1000;
	const voteTime = s.voteAt + 1;
	const law = w.addLaw();
	const bill = w.addBill(law);
	const co = await w.makeCosponsor(bill);
	const gone = await w.makeCosponsor(bill);
	await leaveCosponsor(w.db, w.actorOf(gone), await w.load(bill.id), null);
	const backer = w.addUser();
	w.support(bill.id, backer);
	const stranger = w.addUser();
	const load = () => w.load(bill.id);

	expect(await billRoleOf(w.db, await load(), bill.author)).toBe('author');
	expect(await billRoleOf(w.db, await load(), co)).toBe('cosponsor');
	expect(await billRoleOf(w.db, await load(), backer)).toBe('supporter');
	expect(await billRoleOf(w.db, await load(), gone)).toBe('former');
	expect(await billRoleOf(w.db, await load(), stranger)).toBeNull();
	expect(await billRoleOf(w.db, await load(), null)).toBeNull();
	// 評価は提出者の側として数える（立場が未定の人として数えない）
	expect(scoredStance('undecided', 'cosponsor')).toBe('for');
	expect(scoredStance('undecided', 'former')).toBe('for');
	expect(scoredStance('undecided', null)).toBe('undecided');
	// 抜けた人は修正案も出せない
	expect(await isBillSide(w.db, await load(), gone)).toBe(true);
	// 名前は出ない
	expect(await cosponsorsOf(w.db, bill.id)).toEqual([`名前${co}`]);

	// 発議して採決の期間へ。票の割り当てから除く
	w.sqlite.prepare('UPDATE bills SET status = ?, proposed_at = ?, proposed_rev = rev WHERE id = ?').run('proposed', s.startsAt + 1, bill.id);
	const first = () => 0;
	expect(await assignedBills(w.db, co, s, previous, voteTime, first)).toEqual([]);
	expect(await assignedBills(w.db, gone, s, previous, voteTime, first)).toEqual([]);
	expect(await assignedBills(w.db, stranger, s, previous, voteTime, first)).toEqual([bill.id]);
	// 投票はできる
	expect(await castVote(w.db, w.actorOf(co), s, previous, bill.id, 'yes', voteTime, first)).toBe(true);
	expect(await castVote(w.db, w.actorOf(gone), s, previous, bill.id, 'yes', voteTime, first)).toBe(true);

	// 結果の確認では関わった人
	expect(await involvedInBill(w.db, bill.id, co)).toBe(true);
	expect(await involvedInBill(w.db, bill.id, gone)).toBe(true);
	expect(await involvedInBill(w.db, bill.id, stranger)).toBe(false);
	// 申し出だけの人は関わった人ではない
	const asker = w.addUser();
	const draft = w.addBill(w.addLaw());
	await requestCosponsor(w.db, w.actorOf(asker), await w.load(draft.id), now);
	expect(await involvedInBill(w.db, draft.id, asker)).toBe(false);

	w.sqlite.prepare('INSERT OR IGNORE INTO session_participants (committee_id, session_key, active_count, fixed_at) VALUES (1, ?, 0, 0)').run(s.key);
	await settleSession(w.db, s, previous, after(s), null);
	w.sqlite.prepare("INSERT INTO vote_reviews (session_key, bill_id, signals, detail, status, created_at) VALUES (?, ?, '[]', '{}', 'open', 0)").run(s.key, bill.id);
	const involvedFor = async (u: string) => (await pendingReviews(w.db, u)).find((r) => r.billId === bill.id)?.involved;
	expect(await involvedFor(co)).toBe(true);
	expect(await involvedFor(gone)).toBe(true);
	expect(await involvedFor(stranger)).toBe(false);
}, 30_000);

test('基準7：撤回は全員の同意で、採決の前まで。撤回された法案は審議から外れる', async () => {
	const w = world();
	const s = monthOf('2030-05');
	const previous = previousOf(s);
	const inSession = s.startsAt + 1000;
	const law = w.addLaw();
	const bill = w.addBill(law, { at: inSession - 500 });
	// 共同提出者は発議の前に決まる
	w.sqlite.prepare("UPDATE bills SET status = 'draft', proposed_at = NULL, proposed_rev = NULL WHERE id = ?").run(bill.id);
	const co = await w.makeCosponsor(bill);
	const gone = await w.makeCosponsor(bill);
	await leaveCosponsor(w.db, w.actorOf(gone), await w.load(bill.id), null);
	w.sqlite.prepare("UPDATE bills SET status = 'proposed', proposed_at = ?, proposed_rev = rev WHERE id = ?").run(inSession - 500, bill.id);
	const related = w.addBill(law, { at: inSession - 400 });
	const load = () => w.load(bill.id);
	const stranger = w.addUser();

	// 取り下げられる時刻と進みが同じになる
	for (const now of [s.startsAt + 1, s.deliberationAt - 1, s.deliberationAt, s.voteAt - 1, s.voteAt, s.endsAt - 1]) {
		const since = withdrawableSince(now, null);
		for (const proposedAt of [previous.deliberationAt - 1, previous.deliberationAt, s.startsAt + 1, s.deliberationAt - 1, s.deliberationAt, s.voteAt - 1, Math.min(now, s.endsAt - 1)]) {
			if (proposedAt > now) continue;
			const progress = billProgress({ status: 'proposed', proposedAt }, now, null);
			expect(proposedAt >= since, `${now} ${proposedAt}`).toBe(progress === 'proposed' || progress === 'deliberation');
		}
	}

	expect(await consentWithdraw(w.db, w.actorOf(stranger), await load(), inSession, null)).toEqual({ ok: false, reason: 'forbidden' });
	expect(await consentWithdraw(w.db, w.actorOf(gone), await load(), inSession, null)).toEqual({ ok: false, reason: 'forbidden' });
	expect(await consentWithdraw(w.db, w.actorOf(bill.author), await load(), inSession, null)).toEqual({ ok: true, withdrawn: false });
	expect(w.statusOf(bill.id).status).toBe('proposed');
	expect(await withdrawStateOf(w.db, await load())).toMatchObject({ total: 2, consented: 1, names: [expect.any(String)] });
	// 全員の前なら取り消せる
	expect(await cancelWithdraw(w.db, w.actorOf(bill.author), await load())).toBe(true);
	expect(await consentWithdraw(w.db, w.actorOf(co), await load(), inSession, null)).toEqual({ ok: true, withdrawn: false });
	expect(w.statusOf(bill.id).status).toBe('proposed');
	// 採決が始まると断る
	expect(await consentWithdraw(w.db, w.actorOf(bill.author), await load(), s.voteAt, null)).toEqual({ ok: false, reason: 'closed' });
	expect(w.statusOf(bill.id).status).toBe('proposed');
	// 最後の1人で撤回になる（抜けた人は入らない）
	expect(await consentWithdraw(w.db, w.actorOf(bill.author), await load(), inSession, null)).toEqual({ ok: true, withdrawn: true });
	expect(w.statusOf(bill.id)).toEqual({ status: 'withdrawn', at: inSession });
	expect(w.count('bill_withdraw', bill.author)).toBe(1);
	// 元に戻せない
	expect(await cancelWithdraw(w.db, w.actorOf(bill.author), await load())).toBe(false);
	expect(await consentWithdraw(w.db, w.actorOf(bill.author), await load(), inSession, null)).toEqual({ ok: false, reason: 'closed' });

	// 審議から外れる
	const withdrawn = await load();
	expect(billProgress(withdrawn, s.deliberationAt + 1, null)).toBe('withdrawn');
	expect((await billsInVote(w.db, s, previous)).map((b) => b.id)).not.toContain(bill.id);
	expect((await relatedBills(w.db, await w.load(related.id), null)).map((b) => b.id)).not.toContain(bill.id);
	const stage = (await billStageNow(w.db, withdrawn, after(s), null)).stage;
	expect(stage).toBe('withdrawn');
	expect(canResubmit(stage, false)).toBe(false);
	const owari = await listBills(w.db, 'owari', 1, s.deliberationAt);
	expect(owari.rows.find((r) => r.id === bill.id)).toMatchObject({ status: 'withdrawn' });
	const shingi = await listBills(w.db, 'shingi', 1, previous.deliberationAt);
	expect(shingi.rows.map((r) => r.id)).not.toContain(bill.id);
	w.sqlite.prepare('INSERT OR IGNORE INTO session_participants (committee_id, session_key, active_count, fixed_at) VALUES (1, ?, 0, 0)').run(s.key);
	await settleSession(w.db, s, previous, after(s), null);
	expect({ ...w.sqlite.prepare('SELECT count(*) AS n FROM bill_results WHERE bill_id = ?').get(bill.id) }).toEqual({ n: 0 });

	// 要調整を直して発議し直すと、前の同意は数えない
	const again = w.addBill(w.addLaw(), { at: inSession });
	await consentWithdraw(w.db, w.actorOf(again.author), await w.load(again.id), inSession, null);
	const single = w.addBill(w.addLaw());
	const member = await w.makeCosponsor(single);
	w.sqlite.prepare("UPDATE bills SET status = 'proposed', proposed_at = ?, proposed_rev = rev WHERE id = ?").run(inSession, single.id);
	await consentWithdraw(w.db, w.actorOf(single.author), await w.load(single.id), inSession, null);
	w.sqlite.prepare('UPDATE bills SET proposed_rev = 5, rev = 1 WHERE id = ?').run(single.id);
	expect(await consentWithdraw(w.db, w.actorOf(member), await w.load(single.id), inSession, null)).toEqual({ ok: true, withdrawn: false });
	expect(w.statusOf(single.id).status).toBe('proposed');
}, 30_000);

test('基準8：統合案を作る', async () => {
	const w = world();
	const s = monthOf('2030-05');
	const now = s.startsAt + 1000;
	const law = w.addLaw();
	const a = w.addBill(law, { at: now - 500, title: '法案A' });
	const b = w.addBill(law, { at: now - 400, title: '法案B' });
	w.support(a.id, w.addUser());
	const create = async (actor: string, from: number, other: number, at = now) => createMerge(w.db, w.actorOf(actor), await w.load(from), other, at, null);

	expect(await create(w.addUser(), a.id, b.id)).toEqual({ ok: false, reason: 'forbidden' });
	const made = await create(a.author, a.id, b.id);
	expect(made).toMatchObject({ ok: true, created: true });
	const id = (made as { id: number }).id;
	const merged = await w.load(id);
	expect(merged).toMatchObject({ status: 'draft', userId: a.author, title: '法案A', rev: 1 });
	expect(merged.laws[0]).toMatchObject({ lawId: law.lawId, baseRevisionId: law.revisionId, baseIfSeq: 0 });
	expect((await billSupportState(w.db, id, merged.rev, null)).supports).toBe(0);
	expect(w.sqlite.prepare('SELECT origin_bill_id AS o FROM bill_relations WHERE merged_bill_id = ? ORDER BY o').all(id).map((r) => r.o)).toEqual([a.id, b.id]);
	expect(w.count('bill_draft', a.author)).toBe(1);
	// 押した人の同意は入らない
	expect({ ...w.sqlite.prepare('SELECT count(*) AS n FROM bill_merge_consents WHERE merged_bill_id = ?').get(id) }).toEqual({ n: 0 });
	// 元の法案は変わらない
	expect(w.statusOf(a.id).status).toBe('proposed');
	expect(w.supportsOf(a.id)).toBe(1);

	// 同じ組があればそこへ移る
	expect(await create(a.author, a.id, b.id)).toEqual({ ok: true, id, created: false });
	expect(await create(b.author, b.id, a.id)).toEqual({ ok: true, id, created: false });

	// 作れない組
	const mine = w.addBill(law, { at: now - 300, user: a.author });
	expect(await create(a.author, a.id, mine.id)).toEqual({ ok: false, reason: 'closed' });
	expect(await create(a.author, a.id, a.id)).toEqual({ ok: false, reason: 'closed' });
	expect(await create(a.author, a.id, 99999)).toEqual({ ok: false, reason: 'closed' });
	const otherCommittee = w.addBill(law, { at: now - 300, committee: 2 });
	expect(await create(a.author, a.id, otherCommittee.id)).toEqual({ ok: false, reason: 'closed' });
	// 統合案（下書きも発議のあとも）は元にできない
	const c = w.addBill(law, { at: now - 200 });
	expect(await create(c.author, c.id, id)).toEqual({ ok: false, reason: 'closed' });
	expect(await create(a.author, id, c.id)).toEqual({ ok: false, reason: 'closed' });
	// 採決が始まった法案は元にできない
	expect(await create(a.author, a.id, c.id, s.voteAt)).toEqual({ ok: false, reason: 'closed' });
	// 合わせて上限を超える組は作れない
	const big = w.addBill(law);
	for (let i = 0; i < 5; i++) await w.makeCosponsor(big);
	expect(await create(c.author, c.id, big.id)).toEqual({ ok: false, reason: 'closed' });

	// 上限を超えると作らない
	const busy = w.addBill(law, { at: now - 100 });
	for (let i = 0; i < LIMITS.billDraftPerAccount; i++) w.sqlite.prepare("INSERT INTO actions (kind, user_id, ip_hash, created_at) VALUES ('bill_draft', ?, 'x', ?)").run(busy.author, now - 1);
	const before = (w.sqlite.prepare('SELECT count(*) AS n FROM bills').get() as { n: number }).n;
	expect(await create(busy.author, busy.id, c.id)).toMatchObject({ ok: false, refusal: { kind: 'bill-draft-account' } });
	expect((w.sqlite.prepare('SELECT count(*) AS n FROM bills').get() as { n: number }).n).toBe(before);
}, 30_000);

test('基準9：統合案の同意と発議', async () => {
	const w = world();
	const s = monthOf('2030-05');
	const now = s.startsAt + 1000;
	const law = w.addLaw();
	// A は下書きのときに共同提出者を決めてから発議。B は下書きのまま
	const a = w.addBill(law, { title: '法案A' });
	const coA = await w.makeCosponsor(a);
	w.sqlite.prepare("UPDATE bills SET status = 'proposed', proposed_at = ?, proposed_rev = rev WHERE id = ?").run(now - 500, a.id);
	const b = w.addBill(law, { title: '法案B' });
	const made = await createMerge(w.db, w.actorOf(a.author), await w.load(a.id), b.id, now, null);
	const id = (made as { id: number }).id;
	const load = () => w.load(id);
	const consent = async (u: string, rev = 1, at = now) => consentMerge(w.db, w.actorOf(u), await load(), rev, at);
	const propose = async (rev = 1, at = now) => proposeBill(w.db, w.actorOf(a.author), id, rev, 0, at, null);

	// 関係のない人は同意できない。統合案でない法案は断る
	expect(await consent(w.addUser())).toEqual({ ok: false, reason: 'forbidden' });
	expect(await consentMerge(w.db, w.actorOf(a.author), await w.load(a.id), 1, now)).toEqual({ ok: false, reason: 'closed' });

	// 全員の同意の前は発議できない
	expect(await mergeBlock(w.db, await load(), now, null)).toBe('merge');
	expect(await propose()).toEqual({ ok: false, reason: 'merge' });

	// 賛同していた人は同意で外れ、共同提出者になる。読んだ版と違えば、なにも変わらない
	w.support(id, b.author);
	expect(await consent(b.author, 9)).toEqual({ ok: false, reason: 'stale' });
	expect(w.rowOf(id, b.author)).toBeUndefined();
	expect(w.supportsOf(id)).toBe(1);
	expect(await consent(b.author)).toEqual({ ok: true });
	expect(w.rowOf(id, b.author)).toMatchObject({ status: 'accepted', acceptedAt: now });
	expect(w.supportsOf(id)).toBe(0);
	expect(await consent(a.author)).toEqual({ ok: true });
	expect(w.rowOf(id, a.author)).toBeUndefined();
	expect(await mergeBlock(w.db, await load(), now, null)).toBe('merge');
	expect(await consent(coA)).toEqual({ ok: true });
	expect(w.rowOf(id, coA)).toMatchObject({ status: 'accepted' });
	expect(await mergeBlock(w.db, await load(), now, null)).toBeNull();

	// 同意は取り消せる。共同提出者のまま
	expect(await revokeMerge(w.db, w.actorOf(coA), await load())).toBe(true);
	expect(w.rowOf(id, coA)).toMatchObject({ status: 'accepted' });
	expect(await mergeBlock(w.db, await load(), now, null)).toBe('merge');
	expect(await consent(coA)).toEqual({ ok: true });

	// 統合案を保存すると同意は集め直し
	const edit = await load();
	expect(await saveDraft(w.db, id, a.author, 1, { ...draftInputOf(edit), title: '統合案' }, now)).toBe(true);
	expect(await mergeBlock(w.db, await load(), now, null)).toBe('merge');
	expect(await propose(2)).toEqual({ ok: false, reason: 'merge' });
	for (const u of [a.author, b.author, coA]) expect(await consent(u, 2)).toEqual({ ok: true });
	expect(await mergeBlock(w.db, await load(), now, null)).toBeNull();

	// 同意した人が抜けると発議できない。抜けた人は同意できない
	expect(await leaveCosponsor(w.db, w.actorOf(b.author), await load(), null)).toEqual({ ok: true });
	expect(await mergeBlock(w.db, await load(), now, null)).toBe('merge');
	expect(await propose(2)).toEqual({ ok: false, reason: 'merge' });
	expect(await consent(b.author, 2)).toEqual({ ok: false, reason: 'closed' });
	expect(w.statusOf(a.id).status).toBe('proposed');

	// 新しい組で確かめる：発議すると2本とも撤回の状態になる
	const c = w.addBill(law, { at: now - 300, title: '法案C' });
	const d = w.addBill(law, { title: '法案D' });
	const pair = (await createMerge(w.db, w.actorOf(c.author), await w.load(c.id), d.id, now, null)) as { id: number };
	// 発議の前は、元の法案のページのリンクは関係者にだけ
	expect((await mergeLinksOf(w.db, await w.load(c.id), d.author)).merged).toEqual([]);
	expect((await mergeLinksOf(w.db, await w.load(c.id), c.author)).merged).toMatchObject([{ id: pair.id }]);
	expect((await mergeLinksOf(w.db, await w.load(d.id), d.author)).merged).toMatchObject([{ id: pair.id }]);
	expect((await mergeLinksOf(w.db, await w.load(pair.id), null)).origins).toMatchObject([{ id: c.id, waiting: true }, { id: d.id, waiting: true }]);
	const consentPair = async (u: string) => consentMerge(w.db, w.actorOf(u), await w.load(pair.id), 1, now);
	expect(await consentPair(c.author)).toEqual({ ok: true });
	expect(await consentPair(d.author)).toEqual({ ok: true });
	expect((await mergeLinksOf(w.db, await w.load(pair.id), null)).origins).toMatchObject([{ id: c.id, waiting: false }, { id: d.id, waiting: false }]);
	// 元の法案に共同提出者が増えると、確かめのあとでも発議の文で止まる
	const lateCo = await w.makeCosponsor(d);
	expect(await proposeBill(w.db, w.actorOf(c.author), pair.id, 1, 0, now, null)).toEqual({ ok: false, reason: 'merge' });
	expect(w.statusOf(c.id).status).toBe('proposed');
	expect(w.statusOf(d.id).status).toBe('draft');
	expect(await consentPair(lateCo)).toEqual({ ok: true });
	// 読んだ版と違えば発議しない。元の法案も変わらない
	expect(await proposeBill(w.db, w.actorOf(c.author), pair.id, 5, 0, now, null)).toEqual({ ok: false, reason: 'stale' });
	expect(w.statusOf(c.id).status).toBe('proposed');
	// 元の法案が採決に入ると発議できない
	expect(await mergeBlock(w.db, await w.load(pair.id), s.voteAt, null)).toBe('mergeClosed');
	expect(await proposeBill(w.db, w.actorOf(c.author), pair.id, 1, 0, s.voteAt, null)).toEqual({ ok: false, reason: 'mergeClosed' });
	expect(w.statusOf(d.id).status).toBe('draft');
	// 発議する
	expect(await proposeBill(w.db, w.actorOf(c.author), pair.id, 1, 0, now, null)).toEqual({ ok: true });
	expect(w.statusOf(pair.id).status).toBe('proposed');
	expect(w.statusOf(c.id)).toEqual({ status: 'withdrawn', at: now });
	expect(w.statusOf(d.id)).toEqual({ status: 'withdrawn', at: now });
	// 発議のあとはだれにでも出る
	expect((await mergeLinksOf(w.db, await w.load(c.id), null)).mergedInto).toMatchObject({ id: pair.id });
	expect((await mergeLinksOf(w.db, await w.load(c.id), null)).merged).toMatchObject([{ id: pair.id }]);
	// 発議していない元の法案も本文が読める
	const unproposed = await w.load(d.id);
	expect(unproposed.proposedAt).toBeNull();
	expect(unproposed.laws[0].changes[0].paragraphs?.[0].text).toBe('本文を変える');
	// 二重に送っても撤回の時刻を上書きしない
	await proposeBill(w.db, w.actorOf(c.author), pair.id, 1, 0, now + 5, null);
	expect(w.statusOf(c.id).at).toBe(now);

	// 同じ元の法案の、もう1つの統合案は発議できない
	const e = w.addBill(law, { at: now - 100, title: '法案E' });
	const f = w.addBill(law, { at: now - 90, title: '法案F' });
	const g = w.addBill(law, { at: now - 80, title: '法案G' });
	const first = (await createMerge(w.db, w.actorOf(e.author), await w.load(e.id), f.id, now, null)) as { id: number };
	const second = (await createMerge(w.db, w.actorOf(e.author), await w.load(e.id), g.id, now, null)) as { id: number };
	for (const u of [e.author, f.author]) await consentMerge(w.db, w.actorOf(u), await w.load(first.id), 1, now);
	for (const u of [e.author, g.author]) await consentMerge(w.db, w.actorOf(u), await w.load(second.id), 1, now);
	expect(await proposeBill(w.db, w.actorOf(e.author), first.id, 1, 0, now, null)).toEqual({ ok: true });
	expect(await mergeBlock(w.db, await w.load(second.id), now, null)).toBe('mergeClosed');
	expect(await proposeBill(w.db, w.actorOf(e.author), second.id, 1, 0, now, null)).toEqual({ ok: false, reason: 'mergeClosed' });
	expect(w.statusOf(g.id).status).toBe('proposed');

	// やめると普通の下書きに戻り、共同提出者はそのまま
	expect(await cancelMerge(w.db, w.actorOf(g.author), await w.load(second.id))).toBe(false);
	expect(await cancelMerge(w.db, w.actorOf(e.author), await w.load(second.id))).toBe(true);
	expect(w.rowOf(second.id, g.author)).toMatchObject({ status: 'accepted' });
	expect((await mergeLinksOf(w.db, await w.load(second.id), null)).origins).toEqual([]);
	expect(await mergeBlock(w.db, await w.load(second.id), now, null)).toBeNull();

	// 5人を超えると断る。同意の行も入らない
	const crowded = w.addBill(law, { title: '混んだ統合案のもと' });
	const h = w.addBill(law, { at: now - 70, title: '法案H' });
	const pairH = (await createMerge(w.db, w.actorOf(h.author), await w.load(h.id), crowded.id, now, null)) as { id: number };
	for (let i = 0; i < 5; i++) await w.makeCosponsor({ id: pairH.id, author: h.author });
	expect(await consentMerge(w.db, w.actorOf(crowded.author), await w.load(pairH.id), 1, now)).toEqual({ ok: false, reason: 'full' });
	expect({ ...w.sqlite.prepare('SELECT count(*) AS n FROM bill_merge_consents WHERE merged_bill_id = ? AND user_id = ?').get(pairH.id, crowded.author) }).toEqual({ n: 0 });

	// 両方の元の法案に属する人は1回で両方に同意になる
	const both = w.addUser();
	const i1 = w.addBill(law, { title: '法案I' });
	const i2 = w.addBill(law, { title: '法案J' });
	await w.makeCosponsor(i1, both);
	await w.makeCosponsor(i2, both);
	const pairI = (await createMerge(w.db, w.actorOf(i1.author), await w.load(i1.id), i2.id, now, null)) as { id: number };
	expect(await consentMerge(w.db, w.actorOf(both), await w.load(pairI.id), 1, now)).toEqual({ ok: true });
	expect({ ...w.sqlite.prepare('SELECT count(*) AS n FROM bill_merge_consents WHERE merged_bill_id = ? AND user_id = ?').get(pairI.id, both) }).toEqual({ n: 2 });

	// 発議のあとで要調整になった統合案は、直して発議し直せる（統合案の条件は下書きからの発議だけ）
	const passed = await w.load(first.id);
	const adjustments = () => w.sqlite.prepare("INSERT INTO bill_adjustments (bill_id, session_key, reason, due_at, proposed_at, created_at) VALUES (?, ?, 'article', ?, ?, 0)").run(first.id, s.key, now + 1000, passed.proposedAt);
	adjustments();
	const saved = await saveAdjustedBill(w.db, w.actorOf(e.author), passed, passed.rev, { ...draftInputOf(passed), summary: '直した要約' }, now + 10);
	expect(saved).toEqual({ ok: true, saved: true });
}, 60_000);
