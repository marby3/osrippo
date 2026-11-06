// Issue #78 基準1〜8：アプリ内通知（設計書 docs/spec/78.md）。画面は e2e/tsuchi.spec.ts
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { expect, test } from 'vitest';
import { HIDEABLE, RESTORABLE } from '../domain/reports';
import { sessionAt, type Session } from '../domain/session';
import { billById, draftInputOf, proposeBill, saveDraft } from '../server/bills';
import { settleElection, signRecall, withdrawCandidacy } from '../server/chairs';
import { decideCosponsor, leaveCosponsor, requestCosponsor } from '../server/cosponsors';
import { setEvaluation } from '../server/evaluations';
import { notifyConflicts } from '../server/if-world';
import { consentMerge, createMerge } from '../server/merge';
import { timedNotices } from '../server/notification-page';
import { notifyBillOutcomes } from '../server/notifications';
import { changeStatus, mergeIssue, reportIssue } from '../server/reports';
import { decideReview, settleSession } from '../server/results';
import { changeSolutionStatus, react, reportSolution } from '../server/solutions';
import { consentWithdraw } from '../server/withdraw';
import { openMemoryDb, type MemoryDb } from './memory';

const jst = (s: string) => Date.parse(`${s}+09:00`);
const monthOf = (key: string) => sessionAt(jst(`${key}-10T00:00:00`), null);
const previousOf = (s: Session) => sessionAt(s.startsAt - 1, null);
const nextOf = (s: Session) => sessionAt(s.endsAt, null);
const COMMITTEE = 1;
const DAY = 24 * 60 * 60 * 1000;
const para = (text: string) => JSON.stringify([{ num: '1', text, items: [] }]);
const first = () => 0.1;

function world() {
	const { sqlite, db } = openMemoryDb();
	sqlite.exec("INSERT INTO user (id, name, email, created_at, updated_at) VALUES ('issuer', 'i', 'i@test.invalid', 0, 0); INSERT INTO issues (id, user_id, title, affected, example, topic_id, created_at) VALUES (1, 'issuer', '課題', '人', '例', NULL, 0); INSERT INTO solutions (id, issue_id, user_id, body, created_at) VALUES (1, 1, 'issuer', '解決策', 0); INSERT OR IGNORE INTO committees (id, name) VALUES (1, '第1');");
	let counter = 0;
	const addUser = () => {
		const id = `n${++counter}`;
		sqlite.prepare('INSERT INTO user (id, name, email, created_at, updated_at) VALUES (?, ?, ?, 0, 0)').run(id, id, `${id}@test.invalid`);
		return id;
	};
	const addLaw = () => {
		const n = ++counter;
		const lawId = `L${n}`;
		const revisionId = `R${n}`;
		sqlite.prepare("INSERT INTO laws (id, title, law_num) VALUES (?, ?, '番号')").run(lawId, `法令${n}`);
		sqlite.prepare("INSERT INTO law_revisions (id, law_id, branch, seq, enforcement_date, status) VALUES (?, ?, 'real', 0, '2020-01-01', 'enforced')").run(revisionId, lawId);
		const article = Number(sqlite.prepare("INSERT INTO provisions (law_id, kind) VALUES (?, 'article')").run(lawId).lastInsertRowid);
		sqlite.prepare("INSERT INTO provision_versions (provision_id, from_revision_id, num, caption, change) VALUES (?, ?, '1', '（見出し）', 'baseline')").run(article, revisionId);
		const paragraph = Number(sqlite.prepare("INSERT INTO provisions (law_id, kind, parent_id) VALUES (?, 'paragraph', ?)").run(lawId, article).lastInsertRowid);
		sqlite.prepare("INSERT INTO provision_versions (provision_id, from_revision_id, num, text, change) VALUES (?, ?, '1', '本文', 'baseline')").run(paragraph, revisionId);
		return { lawId, revisionId, article };
	};
	type Law = ReturnType<typeof addLaw>;
	const addBill = (law: Law, opts: { at?: number; user?: string; title?: string } = {}) => {
		const author = opts.user ?? addUser();
		const proposed = opts.at !== undefined;
		const id = Number(
			sqlite
				.prepare("INSERT INTO bills (user_id, committee_id, kind, status, rev, next_rev, proposed_rev, title, affected, side_effects, created_at, updated_at, proposed_at) VALUES (?, 1, 'amend', ?, 1, 2, ?, ?, '人', '副作用', 0, 0, ?)")
				.run(author, proposed ? 'proposed' : 'draft', proposed ? 1 : null, opts.title ?? `法案${++counter}`, opts.at ?? null).lastInsertRowid
		);
		sqlite.prepare("INSERT INTO bill_laws (bill_id, rev, seq, action, law_id, base_revision_id, base_if_seq) VALUES (?, 1, 0, 'amend', ?, ?, 0)").run(id, law.lawId, law.revisionId);
		sqlite.prepare('INSERT INTO bill_solutions (bill_id, rev, seq, solution_id) VALUES (?, 1, 0, 1)').run(id);
		sqlite.prepare("INSERT INTO bill_changes (bill_id, rev, law_seq, num, op, provision_id, caption, body) VALUES (?, 1, 0, '1', 'amend', ?, '（見出し）', ?)").run(id, law.article, para('本文を変える'));
		return { id, author };
	};
	const actorOf = (userId: string, ipHash = `ip-${userId}`) => ({ userId, registeredAt: 0, ipHash });
	const load = async (id: number) => (await billById(db, id)) as NonNullable<Awaited<ReturnType<typeof billById>>>;
	const inbox = (userId: string) => sqlite.prepare('SELECT kind, target_id AS target, ref_id AS ref FROM notifications WHERE user_id = ? ORDER BY id').all(userId).map((r) => ({ ...r })) as { kind: string; target: number; ref: number }[];
	const kinds = (userId: string) => inbox(userId).map((r) => r.kind);
	const clear = () => sqlite.exec('DELETE FROM notifications');
	const addCosponsor = (bill: number, userId: string, status = 'accepted') => Number(sqlite.prepare('INSERT INTO bill_cosponsors (bill_id, user_id, status, created_at, accepted_at) VALUES (?, ?, ?, 0, 0)').run(bill, userId, status).lastInsertRowid);
	const addResult = (key: string, bill: number, outcome: string, settledAt: number) =>
		sqlite.prepare('INSERT INTO bill_results (session_key, bill_id, outcome, yes, no, abstain, ref_yes, ref_no, ref_abstain, participants, quorum, rev, settled_at) VALUES (?, ?, ?, 5, 1, 0, 0, 0, 0, 10, 1, 1, ?)').run(key, bill, outcome, settledAt);
	const addReview = (key: string, bill: number, status: string) => sqlite.prepare("INSERT INTO vote_reviews (session_key, bill_id, signals, detail, status, created_at) VALUES (?, ?, '[]', '{}', ?, 0)").run(key, bill, status);
	const addIssue = (userId: string, status = 'visible') => Number(sqlite.prepare("INSERT INTO issues (user_id, title, affected, example, topic_id, status, created_at) VALUES (?, '課題', '人', '例', NULL, ?, 0)").run(userId, status).lastInsertRowid);
	const addSolution = (issue: number, userId: string) => Number(sqlite.prepare("INSERT INTO solutions (issue_id, user_id, body, created_at) VALUES (?, ?, '解決策', 0)").run(issue, userId).lastInsertRowid);
	const addTerm = (session: Session, userId: string, role: 'chair' | 'director', rank: number, recalledAt: number | null = null) =>
		sqlite.prepare('INSERT INTO chair_terms (committee_id, session_key, user_id, role, rank, votes, recalled_at, created_at) VALUES (1, ?, ?, ?, ?, 1, ?, 0)').run(session.key, userId, role, rank, recalledAt);
	const addCandidate = (session: Session, userId: string) => Number(sqlite.prepare('INSERT INTO chair_candidates (committee_id, session_key, user_id, created_at) VALUES (1, ?, ?, 0)').run(session.key, userId).lastInsertRowid);
	const addChairVote = (session: Session, userId: string, candidate: number) => sqlite.prepare("INSERT INTO chair_votes (committee_id, session_key, user_id, candidate_id, ip_hash, created_at, updated_at) VALUES (1, ?, ?, ?, 'x', 0, 0)").run(session.key, userId, candidate);
	const eligible = (session: Session, userId = addUser()) => {
		sqlite.prepare("INSERT INTO actions (kind, user_id, ip_hash, created_at) VALUES ('issue_post', ?, 'x', ?)").run(userId, session.startsAt - 1);
		return userId;
	};
	return { sqlite, db: db as MemoryDb, addUser, addLaw, addBill, actorOf, load, inbox, kinds, clear, addCosponsor, addResult, addReview, addIssue, addSolution, addTerm, addCandidate, addChairVote, eligible };
}

test('基準1：0022 で表が増え、既存の行は残り、同じ通知は2行にならない', () => {
	const old = new DatabaseSync(':memory:');
	old.exec('PRAGMA foreign_keys = ON');
	const dir = new URL('../../../drizzle/', import.meta.url);
	const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
	for (const f of files.filter((f) => f < '0022')) old.exec(readFileSync(new URL(f, dir), 'utf8'));
	old.exec("INSERT INTO user (id, name, email, created_at, updated_at) VALUES ('u', 'u', 'u@test.invalid', 0, 0)");
	const later = files.filter((f) => f >= '0022');
	expect(later.length).toBeGreaterThan(0);
	for (const f of later) old.exec(readFileSync(new URL(f, dir), 'utf8'));
	expect({ ...old.prepare('SELECT id FROM user').get() }).toEqual({ id: 'u' });
	const row = "INSERT INTO notifications (user_id, kind, target_id, ref_id, created_at) VALUES ('u', 'bill_passed', 1, 2, 3)";
	old.exec(row);
	expect(() => old.exec(row)).toThrow();
	old.exec("INSERT INTO notifications (user_id, kind, target_id, ref_id, created_at) VALUES ('u', 'bill_passed', 1, 3, 3)");
	old.exec("INSERT INTO notification_reads (user_id, read_at, read_id) VALUES ('u', 1, 1)");
	// 消した番号を使い回さない
	old.exec('DELETE FROM notifications WHERE ref_id = 3');
	old.exec("INSERT INTO notifications (user_id, kind, target_id, ref_id, created_at) VALUES ('u', 'bill_passed', 1, 4, 3)");
	expect(old.prepare('SELECT id FROM notifications ORDER BY id').all().map((r) => r.id)).toEqual([1, 3]);
	// ユーザーの行を消すと一緒に消える
	old.exec("DELETE FROM user WHERE id = 'u'");
	expect({ ...old.prepare('SELECT count(*) AS n FROM notifications').get() }).toEqual({ n: 0 });
	expect({ ...old.prepare('SELECT count(*) AS n FROM notification_reads').get() }).toEqual({ n: 0 });
});

test('基準2：会期の結果が提出者と共同提出者に届き、確認の間は結果を出さず、何度走っても1件', async () => {
	const w = world();
	const s = monthOf('2040-05');
	const law = w.addLaw();
	const outcome = (b: number, user: string) => w.inbox(user).filter((r) => r.target === b).map((r) => r.kind);

	const passed = w.addBill(law, { at: s.startsAt });
	const co = w.addUser();
	const declined = w.addUser();
	const stranger = w.addUser();
	w.addCosponsor(passed.id, co);
	w.addCosponsor(passed.id, declined, 'declined');
	w.addResult(s.key, passed.id, 'passed', 100);
	const rejected = w.addBill(law, { at: s.startsAt });
	w.addResult(s.key, rejected.id, 'rejected', 100);
	const held = w.addBill(law, { at: s.startsAt });
	w.addResult(s.key, held.id, 'passed', 100);
	w.addReview(s.key, held.id, 'open');
	const noted = w.addBill(law, { at: s.startsAt });
	w.addResult(s.key, noted.id, 'passed', 100);
	w.addReview(s.key, noted.id, 'noted');
	// 結果の行がない確認の行には届かない
	const early = w.addBill(law, { at: s.startsAt });
	w.addReview(s.key, early.id, 'open');
	// 要調整
	const adjusting = w.addBill(law, { at: s.startsAt });
	w.addResult(s.key, adjusting.id, 'passed', 100);
	w.sqlite.prepare("INSERT INTO bill_adjustments (bill_id, session_key, reason, due_at, proposed_at, created_at) VALUES (?, ?, 'article', 0, 0, 77)").run(adjusting.id, s.key);

	await notifyBillOutcomes(w.db, s.key, 1000);
	await notifyBillOutcomes(w.db, s.key, 2000);
	expect(w.inbox(passed.author)).toEqual([{ kind: 'bill_passed', target: passed.id, ref: 100 }]);
	expect(w.kinds(co)).toEqual(['bill_passed']);
	expect(w.kinds(declined)).toEqual([]);
	expect(w.kinds(stranger)).toEqual([]);
	expect(w.kinds(rejected.author)).toEqual(['bill_rejected']);
	expect(w.kinds(noted.author)).toEqual(['bill_passed']);
	expect(w.kinds(early.author)).toEqual([]);
	// 確認の間は結果を出さない
	expect(w.kinds(held.author)).toEqual(['bill_reviewing']);
	expect(w.kinds(adjusting.author).sort()).toEqual(['bill_adjustment', 'bill_passed']);

	// 確定すると結果が届く
	const staff = { userId: stranger, role: 'operator' as const };
	expect(await decideReview(w.db, staff, s.key, held.id, 'confirm', null, s.endsAt + 120_000, null)).toBe(true);
	expect(outcome(held.id, held.author)).toEqual(['bill_reviewing', 'bill_passed']);
	// 無効が届き、結果は出さない
	const voided = w.addBill(law, { at: s.startsAt });
	w.addResult(s.key, voided.id, 'passed', 100);
	w.addReview(s.key, voided.id, 'open');
	await notifyBillOutcomes(w.db, s.key, 3000);
	expect(await decideReview(w.db, staff, s.key, voided.id, 'void', '理由', s.endsAt + 120_000, null)).toBe(true);
	expect(outcome(voided.id, voided.author)).toEqual(['bill_reviewing', 'bill_voided']);

	// 発議し直して次の会期の結果が出ると、また届く
	const next = nextOf(s);
	w.addResult(next.key, passed.id, 'passed', 200);
	await notifyBillOutcomes(w.db, next.key, 4000);
	expect(w.inbox(passed.author).map((r) => r.ref)).toEqual([100, 200]);

	// 会期の処理を通っても届く（票がなければ廃案）
	const run = monthOf('2041-05');
	w.sqlite.prepare('INSERT INTO session_participants (committee_id, session_key, active_count, fixed_at) VALUES (1, ?, 0, 0)').run(run.key);
	const lapsed = w.addBill(law, { at: run.startsAt });
	await settleSession(w.db, run, previousOf(run), run.endsAt + 60_000, null);
	expect(w.kinds(lapsed.author)).toEqual(['bill_lapsed']);
});

test('基準3：発議のあとで条文がぶつかると1回届く。下書きと結果の出た法案には届かない', async () => {
	const w = world();
	const s = monthOf('2042-05');
	const law = w.addLaw();
	const now = s.startsAt + 1000;
	const previous = previousOf(s);
	// 先に可決した法案が同じ条を変えた
	const winner = w.addBill(law, { at: previous.startsAt });
	w.sqlite.prepare('INSERT INTO if_branches (law_id, revision_id, created_at) VALUES (?, ?, 0)').run(law.lawId, law.revisionId);
	w.sqlite.prepare('INSERT INTO if_revisions (law_id, seq, bill_id, bill_rev, law_seq, session_key, created_at) VALUES (?, 1, ?, 1, 0, ?, 0)').run(law.lawId, winner.id, previous.key);
	// いまの会期に採決する、結果の出ていない法案
	const open = w.addBill(law, { at: previous.deliberationAt + 1 });
	const co = w.addUser();
	w.addCosponsor(open.id, co);
	const draft = w.addBill(law);
	// 前の会期に採決した法案（結果が出ている）
	const settled = w.addBill(law, { at: previous.startsAt + 1 });
	w.addResult(previous.key, settled.id, 'rejected', 100);
	// 別の法令の法案
	const elsewhere = w.addBill(w.addLaw(), { at: previous.deliberationAt + 1 });

	await notifyConflicts(w.db, now);
	await notifyConflicts(w.db, now + 1);
	expect(w.inbox(open.author)).toEqual([{ kind: 'bill_conflict', target: open.id, ref: 1 }]);
	expect(w.kinds(co)).toEqual(['bill_conflict']);
	expect(w.kinds(draft.author)).toEqual([]);
	expect(w.kinds(settled.author)).toEqual([]);
	expect(w.kinds(elsewhere.author)).toEqual([]);
	expect(w.kinds(winner.author)).toEqual([]);
});

test('基準4：法案の操作が決まった人に届き、操作した人には届かない', async () => {
	const w = world();
	const s = monthOf('2043-05');
	const now = s.startsAt + 1000;
	const law = w.addLaw();
	const bill = w.addBill(law, { title: '法案' });
	const load = () => w.load(bill.id);

	// 申し出、承認、断り
	const asker = w.addUser();
	expect(await requestCosponsor(w.db, w.actorOf(asker), await load(), now)).toMatchObject({ ok: true });
	const rowOf = (u: string) => (w.sqlite.prepare('SELECT id FROM bill_cosponsors WHERE bill_id = ? AND user_id = ?').get(bill.id, u) as { id: number }).id;
	expect(w.inbox(bill.author)).toEqual([{ kind: 'cosponsor_requested', target: bill.id, ref: rowOf(asker) }]);
	expect(w.kinds(asker)).toEqual([]);
	expect(await decideCosponsor(w.db, w.actorOf(bill.author), await load(), rowOf(asker), 'accept', now)).toEqual({ ok: true });
	expect(w.inbox(asker)).toEqual([{ kind: 'cosponsor_accepted', target: bill.id, ref: rowOf(asker) }]);
	const refused = w.addUser();
	await requestCosponsor(w.db, w.actorOf(refused), await load(), now);
	expect(await decideCosponsor(w.db, w.actorOf(bill.author), await load(), rowOf(refused), 'decline', now)).toEqual({ ok: true });
	expect(w.kinds(refused)).toEqual(['cosponsor_declined']);
	// 外される、抜ける
	const removed = w.addUser();
	await requestCosponsor(w.db, w.actorOf(removed), await load(), now);
	await decideCosponsor(w.db, w.actorOf(bill.author), await load(), rowOf(removed), 'accept', now);
	expect(await leaveCosponsor(w.db, w.actorOf(bill.author), await load(), rowOf(removed))).toEqual({ ok: true });
	expect(w.kinds(removed)).toEqual(['cosponsor_accepted', 'cosponsor_removed']);
	const leaver = w.addUser();
	await requestCosponsor(w.db, w.actorOf(leaver), await load(), now);
	await decideCosponsor(w.db, w.actorOf(bill.author), await load(), rowOf(leaver), 'accept', now);
	w.clear();
	expect(await leaveCosponsor(w.db, w.actorOf(leaver), await load(), null)).toEqual({ ok: true });
	expect(w.inbox(bill.author)).toEqual([{ kind: 'cosponsor_left', target: bill.id, ref: rowOf(leaver) }]);
	expect(w.kinds(leaver)).toEqual([]);

	// 直された：その版に賛同した人に届き、直した人と古い版の賛同には届かない
	w.clear();
	const supporter = w.addUser();
	w.sqlite.prepare('INSERT INTO bill_supports (bill_id, rev, user_id, created_at) VALUES (?, 1, ?, 0)').run(bill.id, supporter);
	const oldSupporter = w.addUser();
	w.sqlite.prepare('INSERT INTO bill_supports (bill_id, rev, user_id, created_at) VALUES (?, 0, ?, 0)').run(bill.id, oldSupporter);
	expect(await saveDraft(w.db, bill.id, bill.author, 1, { ...draftInputOf(await load()), title: '直した' }, now)).toBe(true);
	expect(w.inbox(supporter)).toEqual([{ kind: 'bill_edited', target: bill.id, ref: 2 }]);
	expect(w.kinds(oldSupporter)).toEqual([]);
	expect(w.kinds(bill.author)).toEqual([]);

	// 発議：共同提出者に届き、発議した人には届かない
	w.clear();
	expect(await proposeBill(w.db, w.actorOf(bill.author), bill.id, 2, 0, now, null)).toEqual({ ok: true });
	expect(w.inbox(asker)).toEqual([{ kind: 'bill_proposed', target: bill.id, ref: 2 }]);
	expect(w.kinds(bill.author)).toEqual([]);

	// 撤回：最初の同意でほかの人に同意を求め、全員の同意で撤回された
	w.clear();
	expect(await consentWithdraw(w.db, w.actorOf(asker), await load(), now, null)).toEqual({ ok: true, withdrawn: false });
	expect(w.inbox(bill.author)).toEqual([{ kind: 'withdraw_requested', target: bill.id, ref: 2 }]);
	expect(w.kinds(asker)).toEqual([]);
	expect(await consentWithdraw(w.db, w.actorOf(bill.author), await load(), now, null)).toEqual({ ok: true, withdrawn: true });
	expect(w.kinds(asker)).toEqual(['bill_withdrawn']);
	expect(w.kinds(bill.author)).toEqual(['withdraw_requested']);

	// 統合案：作ると元の法案の人に同意を求め、発議で届く。作った人と発議した人には届かない
	w.clear();
	const a = w.addBill(law, { at: now - 300 });
	const b = w.addBill(law);
	const coB = w.addUser();
	w.addCosponsor(b.id, coB);
	const made = (await createMerge(w.db, w.actorOf(a.author), await w.load(a.id), b.id, now, null)) as { id: number };
	expect(w.inbox(b.author)).toEqual([{ kind: 'merge_requested', target: made.id, ref: 0 }]);
	expect(w.kinds(coB)).toEqual(['merge_requested']);
	expect(w.kinds(a.author)).toEqual([]);
	// 統合案が直されると、同意した人に届く
	for (const u of [a.author, b.author, coB]) expect(await consentMerge(w.db, w.actorOf(u), await w.load(made.id), 1, now)).toEqual({ ok: true });
	w.clear();
	expect(await saveDraft(w.db, made.id, a.author, 1, { ...draftInputOf(await w.load(made.id)), title: '統合案' }, now)).toBe(true);
	expect(w.inbox(b.author)).toEqual([{ kind: 'bill_edited', target: made.id, ref: 2 }]);
	expect(w.kinds(a.author)).toEqual([]);
	for (const u of [a.author, b.author, coB]) expect(await consentMerge(w.db, w.actorOf(u), await w.load(made.id), 2, now)).toEqual({ ok: true });
	w.clear();
	expect(await proposeBill(w.db, w.actorOf(a.author), made.id, 2, 0, now, null)).toEqual({ ok: true });
	expect(w.inbox(b.author)).toEqual([{ kind: 'merge_proposed', target: made.id, ref: 2 }]);
	expect(w.kinds(coB).sort()).toEqual(['bill_proposed', 'merge_proposed']);
	expect(w.kinds(a.author)).toEqual([]);
});

test('基準5：「考えが変わった」が書いた人に届き、付け外しを繰り返しても1回で、押した人が分かる値を持たない', async () => {
	const w = world();
	const s = monthOf('2044-05');
	const now = s.deliberationAt + 1000;
	const law = w.addLaw();
	const bill = w.addBill(law, { at: s.startsAt });
	const addPost = (userId: string) => Number(w.sqlite.prepare("INSERT INTO posts (bill_id, session_key, kind, user_id, body, created_at) VALUES (?, ?, 'question', ?, '質疑', 0)").run(bill.id, s.key, userId).lastInsertRowid);
	const author = w.addUser();
	const post = addPost(author);
	const presser = w.addUser();
	const target = { id: post, billId: bill.id, sessionKey: s.key };

	expect(await setEvaluation(w.db, w.actorOf(presser), target, 'changed', 'add', null, now)).toMatchObject({ changed: true });
	await setEvaluation(w.db, w.actorOf(presser), target, 'changed', 'remove', null, now + 1);
	await setEvaluation(w.db, w.actorOf(presser), target, 'changed', 'add', null, now + 2);
	const second = w.addUser();
	await setEvaluation(w.db, w.actorOf(second), target, 'changed', 'add', null, now + 3);
	expect(w.inbox(author)).toEqual([{ kind: 'mind_changed_post', target: post, ref: 0 }]);
	expect(w.kinds(presser)).toEqual([]);
	// 「なるほど」は届かない
	const other = addPost(w.addUser());
	const otherAuthor = (w.sqlite.prepare('SELECT user_id AS u FROM posts WHERE id = ?').get(other) as { u: string }).u;
	await setEvaluation(w.db, w.actorOf(presser), { id: other, billId: bill.id, sessionKey: s.key }, 'reasonable', 'add', null, now + 4);
	expect(w.kinds(otherAuthor)).toEqual([]);

	// 解決策
	const solutionAuthor = w.addUser();
	const issue = w.addIssue('issuer');
	const solution = w.addSolution(issue, solutionAuthor);
	await react(w.db, w.actorOf(presser), solution, 'changed', 'add', now);
	await react(w.db, w.actorOf(presser), solution, 'changed', 'remove', now + 1);
	await react(w.db, w.actorOf(presser), solution, 'changed', 'add', now + 2);
	expect(w.inbox(solutionAuthor)).toEqual([{ kind: 'mind_changed_solution', target: solution, ref: 0 }]);
	// 「わかる」は届かない
	const quiet = w.addUser();
	await react(w.db, w.actorOf(presser), w.addSolution(issue, quiet), 'support', 'add', now);
	expect(w.kinds(quiet)).toEqual([]);

	// 表に押した人の列がない
	const columns = w.sqlite.prepare("SELECT name FROM pragma_table_info('notifications')").all().map((r) => r.name);
	expect(columns).toEqual(['id', 'user_id', 'kind', 'target_id', 'ref_id', 'created_at']);
});

test('基準6：非表示、表示に戻す、統合が書いた人に届き、繰り返すと届く', async () => {
	const w = world();
	const now = jst('2045-05-10T00:00:00');
	const staff = { userId: w.addUser(), role: 'moderator' as const };

	// 課題：操作の非表示と表示に戻す。繰り返すと、また届く
	const author = w.addUser();
	const issue = w.addIssue(author);
	expect(await changeStatus(w.db, issue, HIDEABLE, 'hidden', staff, 'spam', 'メモ', now)).toBe(true);
	// 変わらなければ届かない
	expect(await changeStatus(w.db, issue, HIDEABLE, 'hidden', staff, 'spam', 'メモ', now + 1)).toBe(false);
	expect(await changeStatus(w.db, issue, RESTORABLE, 'restored', staff, null, 'メモ', now + 2)).toBe(true);
	expect(await changeStatus(w.db, issue, HIDEABLE, 'hidden', staff, 'spam', 'メモ', now + 3)).toBe(true);
	expect(w.inbox(author)).toEqual([
		{ kind: 'issue_hidden', target: issue, ref: now },
		{ kind: 'issue_restored', target: issue, ref: now + 2 },
		{ kind: 'issue_hidden', target: issue, ref: now + 3 }
	]);

	// 課題：通報で自動の非表示
	const autoAuthor = w.addUser();
	const auto = w.addIssue(autoAuthor);
	for (let i = 0; i < 3; i++) await reportIssue(w.db, w.actorOf(w.addUser()), auto, { reason: 'attack', note: null }, now);
	expect(w.inbox(autoAuthor)).toEqual([{ kind: 'issue_hidden', target: auto, ref: now }]);

	// 課題：統合
	const sourceAuthor = w.addUser();
	const source = w.addIssue(sourceAuthor);
	const mergedInto = w.addIssue(w.addUser());
	expect(await mergeIssue(w.db, source, mergedInto, staff, 'まとめる', now)).toBe(true);
	expect(w.inbox(sourceAuthor)).toEqual([{ kind: 'issue_merged', target: source, ref: now }]);

	// 解決策：操作と自動
	const solutionAuthor = w.addUser();
	const solution = w.addSolution(w.addIssue('issuer'), solutionAuthor);
	expect(await changeSolutionStatus(w.db, solution, HIDEABLE, 'hidden', staff, 'spam', 'メモ', now)).toBe(true);
	expect(await changeSolutionStatus(w.db, solution, RESTORABLE, 'restored', staff, null, 'メモ', now + 1)).toBe(true);
	expect(w.kinds(solutionAuthor)).toEqual(['solution_hidden', 'solution_restored']);
	const autoSolutionAuthor = w.addUser();
	const autoSolution = w.addSolution(w.addIssue('issuer'), autoSolutionAuthor);
	for (let i = 0; i < 3; i++) await reportSolution(w.db, w.actorOf(w.addUser()), autoSolution, { reason: 'attack', note: null }, now);
	expect(w.inbox(autoSolutionAuthor)).toEqual([{ kind: 'solution_hidden', target: autoSolution, ref: now }]);
});

test('基準7：当選、解任、取り下げが決まった人に届き、何度走っても1件', async () => {
	const w = world();
	const s = monthOf('2046-05');
	const term = nextOf(s);
	const [chair, director] = [w.addUser(), w.addUser()];
	const [cChair, cDirector] = [w.addCandidate(s, chair), w.addCandidate(s, director)];
	for (let i = 0; i < 2; i++) w.addChairVote(s, w.addUser(), cChair);
	w.addChairVote(s, w.addUser(), cDirector);
	const after = s.endsAt + 60_000;
	await settleElection(w.db, COMMITTEE, s, after, first, null);
	await settleElection(w.db, COMMITTEE, s, after + 1, first, null);
	expect(w.inbox(chair)).toEqual([{ kind: 'chair_elected', target: COMMITTEE, ref: term.startsAt }]);
	expect(w.inbox(director)).toEqual([{ kind: 'director_elected', target: COMMITTEE, ref: term.startsAt }]);

	// 解任：委員長と理事に届く。署名した人には届かない
	w.clear();
	w.sqlite.prepare('INSERT INTO session_participants (committee_id, session_key, active_count, fixed_at) VALUES (1, ?, 10, 0)').run(term.key);
	const signers: string[] = [];
	for (let i = 0; i < 10; i++) {
		const u = w.eligible(term);
		signers.push(u);
		await signRecall(w.db, w.actorOf(u), COMMITTEE, term, previousOf(term), term.startsAt + 1);
	}
	expect(w.inbox(chair)).toEqual([{ kind: 'chair_recalled', target: COMMITTEE, ref: term.startsAt }]);
	expect(w.inbox(director)).toEqual([{ kind: 'chair_recalled', target: COMMITTEE, ref: term.startsAt }]);
	expect(w.kinds(signers[9])).toEqual([]);

	// 取り下げ：その候補に入れた人に届く。別の候補に入れた人と本人には届かない。候補を指さない
	const e = monthOf('2047-05');
	const gone = w.addUser();
	const stay = w.addUser();
	const [cGone, cStay] = [w.addCandidate(e, gone), w.addCandidate(e, stay)];
	const [v1, v2] = [w.addUser(), w.addUser()];
	w.addChairVote(e, v1, cGone);
	w.addChairVote(e, gone, cGone);
	w.addChairVote(e, v2, cStay);
	const at = e.voteAt + 1;
	expect(await withdrawCandidacy(w.db, w.actorOf(gone), COMMITTEE, e, at)).toBe(true);
	expect(w.inbox(v1)).toEqual([{ kind: 'chair_vote_removed', target: COMMITTEE, ref: at }]);
	expect(w.kinds(v2)).toEqual([]);
	expect(w.kinds(gone)).toEqual([]);
});

test('基準8：時刻から求めるもの：採決と選挙の開始、自分の法案の質疑と採決の開始、代行', async () => {
	const w = world();
	const s = monthOf('2048-05');
	const previous = previousOf(s);
	const law = w.addLaw();
	const timed = async (userId: string, now: number) => (await timedNotices(w.db, userId, now, null)).map((n) => [n.kind, n.at, n.billId ?? null]);
	const someone = w.addUser();

	// 採決する法案がなければ採決の開始は出ず、選挙の開始は出る
	expect(await timed(someone, s.voteAt - 1)).toEqual([]);
	expect(await timed(someone, s.voteAt)).toEqual([['election_open', s.voteAt, null]]);
	// 運営と運営協力者に選挙は出さない
	const operator = w.addUser();
	w.sqlite.prepare("UPDATE user SET role = 'operator' WHERE id = ?").run(operator);
	expect(await timed(operator, s.voteAt)).toEqual([]);

	// 採決する法案があれば、全員に採決の開始が出る。自分の法案には質疑と採決の開始が出る
	const bill = w.addBill(law, { at: previous.deliberationAt + 1 });
	const co = w.addUser();
	w.addCosponsor(bill.id, co);
	expect(await timed(someone, s.voteAt)).toEqual([['vote_open', s.voteAt, null], ['election_open', s.voteAt, null]]);
	expect(await timed(bill.author, s.deliberationAt - 1)).toEqual([]);
	expect(await timed(bill.author, s.deliberationAt)).toEqual([['my_bill_deliberation', s.deliberationAt, bill.id]]);
	expect(await timed(co, s.voteAt)).toEqual([['vote_open', s.voteAt, null], ['election_open', s.voteAt, null], ['my_bill_deliberation', s.deliberationAt, bill.id], ['my_bill_vote', s.voteAt, bill.id]]);
	// 下書きと撤回は出ない
	const draft = w.addBill(law);
	expect(await timed(draft.author, s.deliberationAt)).toEqual([]);
	// 会期が変わると消える
	expect(await timed(co, nextOf(s).startsAt)).toEqual([]);

	// 代行：委員長が7日不在の理事に出る
	const t = monthOf('2049-05');
	const [chair, director] = [w.addUser(), w.addUser()];
	w.addTerm(t, chair, 'chair', 0);
	w.addTerm(t, director, 'director', 1);
	const acting = t.startsAt + 7 * DAY;
	expect(await timed(director, acting - 1)).toEqual([]);
	expect(await timed(director, acting)).toEqual([['acting', acting, null]]);
	// ほかの人には出ない。委員長にも出ない
	expect(await timed(chair, acting)).toEqual([]);
	expect(await timed(w.addUser(), acting)).toEqual([]);
	// 委員長が操作すると消える
	const issue = w.addIssue(w.addUser());
	expect(await changeStatus(w.db, issue, HIDEABLE, 'hidden', { userId: chair, role: 'chair' }, 'spam', 'メモ', acting + 1)).toBe(true);
	expect(await timed(director, acting + 1)).toEqual([]);
	expect(await timed(director, acting + 1 + 7 * DAY)).toEqual([['acting', acting + 1 + 7 * DAY, null]]);

	// 委員長の締め出しでは出さない。締め出された理事にも出さない
	const b = monthOf('2049-08');
	const [c2, d2, d3] = [w.addUser(), w.addUser(), w.addUser()];
	w.addTerm(b, c2, 'chair', 0);
	w.addTerm(b, d2, 'director', 1);
	w.addTerm(b, d3, 'director', 2);
	const at = b.startsAt + DAY;
	w.sqlite.prepare('INSERT INTO bans (user_id, until, created_at) VALUES (?, ?, 0)').run(c2, at + 1000);
	expect(await timed(d2, at)).toEqual([]);
	w.sqlite.prepare('INSERT INTO bans (user_id, until, created_at) VALUES (?, ?, 0)').run(d3, b.startsAt + 9 * DAY);
	expect(await timed(d3, b.startsAt + 8 * DAY)).toEqual([]);
	expect(await timed(d2, b.startsAt + 8 * DAY)).toEqual([['acting', b.startsAt + 7 * DAY, null]]);

	// 解任された任期には出さない（解任の通知が行で届く）
	const r = monthOf('2049-10');
	const d4 = w.addUser();
	w.addTerm(r, w.addUser(), 'chair', 0, r.startsAt + 1);
	w.addTerm(r, d4, 'director', 1);
	expect(await timed(d4, r.startsAt + 8 * DAY)).toEqual([]);
});
