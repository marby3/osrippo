// Issue #77 基準1〜7：委員長選挙と理事、解任動議（設計書 docs/spec/77.md）。受け付けの確かめと画面は e2e/iinkai.spec.ts
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { expect, test } from 'vitest';
import { ACTING_AFTER, candidacyOpen, CHAIR_ACCOUNTS_PER_IP, DIRECTOR_MAX, electionOpen, recallRequirement } from '../domain/chairs';
import { HIDEABLE } from '../domain/reports';
import { sessionAt, type Session } from '../domain/session';
import { castChairVote, chairPanelOf, chairPowerOf, electionPage, cancelRecallSignature, recallStateOf, settleElection, signRecall, staffRoleOf, standForChair, withdrawCandidacy } from '../server/chairs';
import { changeStatus, mergeIssue, reportedIssues, staffRows } from '../server/reports';
import { decideReview, involvedInBill, reviewLogPage, runSessionEnd } from '../server/results';
import { changeSolutionStatus, reportedSolutions } from '../server/solutions';
import { openMemoryDb, type MemoryDb } from './memory';

const jst = (s: string) => Date.parse(`${s}+09:00`);
const monthOf = (key: string) => sessionAt(jst(`${key}-10T00:00:00`), null);
const previousOf = (s: Session) => sessionAt(s.startsAt - 1, null);
const nextOf = (s: Session) => sessionAt(s.endsAt, null);
const COMMITTEE = 1;
const DAY = 24 * 60 * 60 * 1000;
const midOf = (s: Session) => s.voteAt + Math.floor((s.endsAt - s.voteAt) / 2);
const first = () => 0.1;

function world() {
	const { sqlite, db } = openMemoryDb();
	sqlite.exec("INSERT INTO user (id, name, email, created_at, updated_at) VALUES ('issuer', 'i', 'i@test.invalid', 0, 0); INSERT OR IGNORE INTO committees (id, name) VALUES (1, '第1'), (2, '第2');");
	let counter = 0;
	const addUser = (name?: string) => {
		const n = ++counter;
		const id = `c${n}`;
		sqlite.prepare('INSERT INTO user (id, name, email, created_at, updated_at) VALUES (?, ?, ?, 0, 0)').run(id, name ?? `名前${n}`, `${id}@test.invalid`);
		return id;
	};
	const addBill = (committee = COMMITTEE, userId = 'issuer') =>
		Number(
			sqlite
				.prepare("INSERT INTO bills (user_id, committee_id, kind, status, rev, next_rev, proposed_rev, title, affected, side_effects, created_at, updated_at, proposed_at) VALUES (?, ?, 'amend', 'proposed', 1, 2, 1, ?, '人', '副作用', 0, 0, 0)")
				.run(userId, committee, `法案${++counter}`).lastInsertRowid
		);
	const addPost = (userId: string, session: Session, opts: { kind?: 'question' | 'answer' | 'supplement'; status?: string; committee?: number } = {}) => {
		const bill = addBill(opts.committee ?? COMMITTEE);
		const kind = opts.kind ?? 'question';
		let parent: number | null = null;
		if (kind !== 'question') parent = Number(sqlite.prepare("INSERT INTO posts (bill_id, session_key, kind, user_id, body, created_at) VALUES (?, ?, 'question', 'issuer', '質疑', 0)").run(bill, session.key).lastInsertRowid);
		sqlite.prepare('INSERT INTO posts (bill_id, session_key, kind, parent_id, user_id, role, body, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)').run(bill, session.key, kind, parent, userId, kind === 'answer' ? 'other' : null, '本文', opts.status ?? 'visible');
	};
	const actorOf = (userId: string, ipHash = `ip-${userId}`) => ({ userId, registeredAt: 0, ipHash });
	/** 候補にする（実際の操作を通す） */
	async function stand(session: Session, userId = addUser()) {
		addPost(userId, session);
		expect(await standForChair(db, actorOf(userId), COMMITTEE, session, previousOf(session), session.voteAt)).toEqual({ ok: true });
		return userId;
	}
	const candidateId = (session: Session, userId: string) => (sqlite.prepare('SELECT id FROM chair_candidates WHERE session_key = ? AND user_id = ?').get(session.key, userId) as { id: number }).id;
	/** 投票資格のある人：会期の前に今月の参加者に数える行動がある */
	const voter = (session: Session, userId = addUser()) => {
		sqlite.prepare("INSERT INTO actions (kind, user_id, ip_hash, created_at) VALUES ('issue_post', ?, 'x', ?)").run(userId, session.startsAt - 1);
		return userId;
	};
	async function vote(session: Session, candidate: string, n: number) {
		for (let i = 0; i < n; i++) {
			const r = await castChairVote(db, actorOf(voter(session)), COMMITTEE, session, candidateId(session, candidate), session.voteAt + 1);
			expect(r).toEqual({ ok: true });
		}
	}
	const terms = (session: Session) => sqlite.prepare('SELECT user_id AS userId, role, rank FROM chair_terms WHERE committee_id = 1 AND session_key = ? ORDER BY rank').all(session.key).map((r) => ({ ...r })) as { userId: string; role: string; rank: number }[];
	const addTerm = (session: Session, userId: string, role: 'chair' | 'director', rank: number, recalledAt: number | null = null) =>
		sqlite.prepare('INSERT INTO chair_terms (committee_id, session_key, user_id, role, rank, votes, recalled_at, created_at) VALUES (1, ?, ?, ?, ?, 1, ?, 0)').run(session.key, userId, role, rank, recalledAt);
	const ban = (userId: string, until: number) => sqlite.prepare('INSERT INTO bans (user_id, until, created_at) VALUES (?, ?, 0)').run(userId, until);
	const setRole = (userId: string, role: string) => sqlite.prepare('UPDATE user SET role = ? WHERE id = ?').run(role, userId);
	const fixParticipants = (session: Session, n: number) => sqlite.prepare('INSERT INTO session_participants (committee_id, session_key, active_count, fixed_at) VALUES (1, ?, ?, 0)').run(session.key, n);
	const addIssue = (userId = 'issuer', status = 'visible') =>
		Number(sqlite.prepare("INSERT INTO issues (user_id, title, affected, example, topic_id, status, created_at) VALUES (?, '課題', '人', '例', NULL, ?, 0)").run(userId, status).lastInsertRowid);
	const addSolution = (issue: number, userId = 'issuer') => Number(sqlite.prepare("INSERT INTO solutions (issue_id, user_id, body, created_at) VALUES (?, ?, '解決策', 0)").run(issue, userId).lastInsertRowid);
	const addReview = (session: Session, billId: number) => {
		sqlite.prepare("INSERT INTO bill_results (session_key, bill_id, outcome, yes, no, abstain, ref_yes, ref_no, ref_abstain, participants, quorum, rev, settled_at) VALUES (?, ?, 'passed', 5, 1, 0, 0, 0, 0, 10, 1, 1, 0)").run(session.key, billId);
		sqlite.prepare("INSERT INTO vote_reviews (session_key, bill_id, signals, detail, status, created_at) VALUES (?, ?, '[]', '{}', 'open', 0)").run(session.key, billId);
	};
	return { sqlite, db: db as MemoryDb, addUser, addBill, addPost, actorOf, stand, candidateId, voter, vote, terms, addTerm, ban, setRole, fixParticipants, addIssue, addSolution, addReview };
}

test('基準1：0021 で表と索引が増え、既存の行は残り、委員長の行の決まりが効く', () => {
	const old = new DatabaseSync(':memory:');
	old.exec('PRAGMA foreign_keys = ON');
	const dir = new URL('../../../drizzle/', import.meta.url);
	const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
	for (const f of files.filter((f) => f < '0021')) old.exec(readFileSync(new URL(f, dir), 'utf8'));
	old.exec("INSERT INTO user (id, name, email, created_at, updated_at) VALUES ('u', 'u', 'u@test.invalid', 0, 0)");
	old.exec("INSERT INTO issues (id, user_id, title, affected, example, created_at) VALUES (1, 'u', 't', 'a', 'e', 0)");
	old.exec("INSERT INTO moderation_logs (id, issue_id, action, actor, actor_user_id, created_at) VALUES (9, 1, 'hide', 'operator', 'u', 5)");
	const later = files.filter((f) => f >= '0021');
	expect(later.length).toBeGreaterThan(0);
	for (const f of later) old.exec(readFileSync(new URL(f, dir), 'utf8'));
	expect({ ...old.prepare('SELECT id, actor, actor_user_id FROM moderation_logs').get() }).toEqual({ id: 9, actor: 'operator', actor_user_id: 'u' });
	for (const table of ['chair_candidates', 'chair_votes', 'chair_terms', 'chair_elections', 'recall_signatures']) expect({ ...old.prepare(`SELECT count(*) AS n FROM ${table}`).get() }).toEqual({ n: 0 });
	const indexes = (table: string) => old.prepare('SELECT name FROM sqlite_master WHERE type = ? AND tbl_name = ?').all('index', table).map((r) => r.name);
	expect(indexes('moderation_logs')).toEqual(expect.arrayContaining(['moderation_logs_actor_user']));
	expect(indexes('vote_reviews')).toEqual(expect.arrayContaining(['vote_reviews_decided_by']));
	// 委員長の順位は0だけ。同じ順位は入らない
	const term = (user: string, role: string, rank: number) => `INSERT INTO chair_terms (committee_id, session_key, user_id, role, rank, votes, created_at) VALUES (1, 's', '${user}', '${role}', ${rank}, 1, 0)`;
	old.exec("INSERT OR IGNORE INTO committees (id, name) VALUES (1, '第1'); INSERT INTO user (id, name, email, created_at, updated_at) VALUES ('v', 'v', 'v@test.invalid', 0, 0)");
	expect(() => old.exec(term('u', 'chair', 1))).toThrow();
	expect(() => old.exec(term('u', 'director', 0))).toThrow();
	expect(() => old.exec(term('u', 'other', 1))).toThrow();
	old.exec(term('u', 'chair', 0));
	expect(() => old.exec(term('v', 'chair', 0))).toThrow();
});

test('基準2：立候補の時期、資格、連続の制限、運営、取り下げ', async () => {
	const w = world();
	const s = monthOf('2030-05');
	const prev = previousOf(s);
	const stand = (userId: string, now: number) => standForChair(w.db, w.actorOf(userId), COMMITTEE, s, prev, now);

	// 時期：4週目の前半だけ
	const a = w.addUser();
	w.addPost(a, s);
	expect(candidacyOpen(s, s.voteAt - 1)).toBe(false);
	expect(candidacyOpen(s, s.voteAt)).toBe(true);
	expect(candidacyOpen(s, midOf(s) - 1)).toBe(true);
	expect(candidacyOpen(s, midOf(s))).toBe(false);
	expect(await stand(a, s.voteAt - 1)).toEqual({ ok: false, reason: 'closed' });
	expect(await stand(a, midOf(s))).toEqual({ ok: false, reason: 'closed' });
	expect(await stand(a, s.voteAt)).toEqual({ ok: true });
	// 同じ操作は何もしない
	expect(await stand(a, s.voteAt + 1)).toEqual({ ok: true });
	expect((w.sqlite.prepare('SELECT count(*) AS n FROM chair_candidates').get() as { n: number }).n).toBe(1);

	// 資格：その会期の、その委員会の質疑か答弁。非表示と補足と別の会期と別の委員会は数えない
	const none = w.addUser();
	expect(await stand(none, s.voteAt)).toEqual({ ok: false, reason: 'noPost' });
	const hidden = w.addUser();
	w.addPost(hidden, s, { status: 'hidden' });
	expect(await stand(hidden, s.voteAt)).toEqual({ ok: false, reason: 'noPost' });
	const lastMonth = w.addUser();
	w.addPost(lastMonth, prev);
	expect(await stand(lastMonth, s.voteAt)).toEqual({ ok: false, reason: 'noPost' });
	const otherCommittee = w.addUser();
	w.addPost(otherCommittee, s, { committee: 2 });
	expect(await stand(otherCommittee, s.voteAt)).toEqual({ ok: false, reason: 'noPost' });
	const supplement = w.addUser();
	w.addPost(supplement, s, { kind: 'supplement' });
	expect(await stand(supplement, s.voteAt)).toEqual({ ok: false, reason: 'noPost' });
	const answer = w.addUser();
	w.addPost(answer, s, { kind: 'answer' });
	expect(await stand(answer, s.voteAt)).toEqual({ ok: true });

	// 連続の制限：いまの会期と前の会期の両方で委員長。解任された任期も数える。片方だけや理事はできる
	const twice = w.addUser();
	w.addPost(twice, s);
	w.addTerm(s, twice, 'chair', 0, s.startsAt + 1);
	w.addTerm(prev, twice, 'chair', 0);
	expect(await stand(twice, s.voteAt)).toEqual({ ok: false, reason: 'consecutive' });
	const once = w.addUser();
	w.addPost(once, s);
	w.addTerm(prev, once, 'director', 1);
	expect(await stand(once, s.voteAt)).toEqual({ ok: true });

	// 運営と運営協力者はできない
	for (const role of ['moderator', 'operator']) {
		const staff = w.addUser();
		w.addPost(staff, s);
		w.setRole(staff, role);
		expect(await stand(staff, s.voteAt)).toEqual({ ok: false, reason: 'staff' });
	}

	// 取り下げ：前半だけ。票も消え、再び立候補しても戻らない
	await w.vote(s, a, 2);
	expect(await withdrawCandidacy(w.db, w.actorOf(a), COMMITTEE, s, midOf(s))).toBe(false);
	expect(await withdrawCandidacy(w.db, w.actorOf(a), COMMITTEE, s, s.voteAt + 2)).toBe(true);
	expect((w.sqlite.prepare('SELECT count(*) AS n FROM chair_votes').get() as { n: number }).n).toBe(0);
	expect(await stand(a, s.voteAt + 3)).toEqual({ ok: true });
	expect((w.sqlite.prepare('SELECT count(*) AS n FROM chair_votes').get() as { n: number }).n).toBe(0);
});

test('基準3：投票の期間、候補だけ、資格、運営、回線の上限、変更、入れた人を出さない', async () => {
	const w = world();
	const s = monthOf('2030-06');
	const a = await w.stand(s);
	const b = await w.stand(s);
	const idA = w.candidateId(s, a);
	const idB = w.candidateId(s, b);
	const cast = (userId: string, id: number, now: number, ip?: string) => castChairVote(w.db, w.actorOf(userId, ip), COMMITTEE, s, id, now);
	const v = w.voter(s, w.addUser('投票した人の名前'));

	// 4週目の間だけ
	expect(electionOpen(s, s.voteAt - 1)).toBe(false);
	expect(electionOpen(s, s.endsAt - 1)).toBe(true);
	expect(electionOpen(s, s.endsAt)).toBe(false);
	expect(await cast(v, idA, s.voteAt - 1)).toEqual({ ok: false, reason: 'closed' });
	expect(await cast(v, idA, s.endsAt)).toEqual({ ok: false, reason: 'closed' });

	// 候補にだけ入れられる：ない番号と、別の会期の候補
	expect(await cast(v, 99999, s.voteAt)).toEqual({ ok: false, reason: 'noCandidate' });
	const other = monthOf('2030-07');
	const elsewhere = await w.stand(other);
	expect(await cast(v, w.candidateId(other, elsewhere), s.voteAt)).toEqual({ ok: false, reason: 'noCandidate' });

	// 数えた票の資格の人だけ。運営と運営協力者はできない。自分に入れてもよい
	expect(await cast(w.addUser(), idA, s.voteAt)).toEqual({ ok: false, reason: 'ineligible' });
	for (const role of ['moderator', 'operator']) {
		const staff = w.voter(s);
		w.setRole(staff, role);
		expect(await cast(staff, idA, s.voteAt)).toEqual({ ok: false, reason: 'staff' });
	}
	w.voter(s, a);
	expect(await cast(a, idA, s.voteAt)).toEqual({ ok: true });

	// 締切まで変えられ、最後の票を数える
	expect(await cast(v, idA, s.voteAt)).toEqual({ ok: true });
	expect(await cast(v, idB, s.voteAt + 1)).toEqual({ ok: true });
	const mine = await electionPage(w.db, COMMITTEE, s, v, s.voteAt + 2, first);
	expect(mine.myVote).toBe(idB);
	expect((w.sqlite.prepare('SELECT count(*) AS n FROM chair_votes WHERE user_id = ?').get(v) as { n: number }).n).toBe(1);

	// 1回線から3アカウントまで。入れた票を変えるのは数えない
	for (let i = 0; i < CHAIR_ACCOUNTS_PER_IP; i++) expect(await cast(w.voter(s), idA, s.voteAt, 'same-line')).toEqual({ ok: true });
	const over = w.voter(s);
	expect(await cast(over, idA, s.voteAt, 'same-line')).toEqual({ ok: false, refusal: { kind: 'chair-vote-ip' } });
	const onLine = w.sqlite.prepare("SELECT user_id AS u FROM chair_votes WHERE ip_hash = 'same-line' LIMIT 1").get() as { u: string };
	expect(await cast(onLine.u, idB, s.voteAt + 1, 'same-line')).toEqual({ ok: true });
	// 回線の上限は違反に数えない
	expect((w.sqlite.prepare("SELECT count(*) AS n FROM actions WHERE kind = 'violation' AND user_id = ?").get(over) as { n: number }).n).toBe(0);

	// ページのデータに、入れた人、得票、回線、内部IDを出さない
	const seen = JSON.stringify(await electionPage(w.db, COMMITTEE, s, null, s.voteAt + 2, first));
	expect(seen).not.toContain('投票した人の名前');
	expect(seen).not.toContain(v);
	expect(seen).not.toContain('same-line');
	expect(seen).not.toContain('"votes"');
	expect(seen).not.toContain(a);
});

test('基準4：確定の順位、くじ、入らない候補、任期、何度走っても同じ、猶予、Cron', async () => {
	const w = world();
	const s = monthOf('2030-08');
	const next = nextOf(s);
	const after = s.endsAt + 60_000;

	// 5人の候補：最多が委員長、次の3人までが理事。5人目と0票は入らない
	const [a, b, c, d, e] = [await w.stand(s), await w.stand(s), await w.stand(s), await w.stand(s), await w.stand(s)];
	await w.stand(s);
	for (const [who, n] of [[a, 5], [b, 4], [c, 3], [d, 2], [e, 1]] as const) await w.vote(s, who, n);
	// 取り下げた候補は入らない
	const gone = await w.stand(s);
	await w.vote(s, gone, 9);
	await withdrawCandidacy(w.db, w.actorOf(gone), COMMITTEE, s, s.voteAt + 2);
	// 確定までに運営になった候補は入らない
	const promoted = await w.stand(s);
	await w.vote(s, promoted, 9);
	w.setRole(promoted, 'moderator');
	// 締め出されている候補は入る（締め出しは一時的なので除かない）
	w.ban(b, after + DAY);

	// 締切から1分は処理しない
	await settleElection(w.db, COMMITTEE, s, s.endsAt + 59_999, first, null);
	expect(w.terms(next)).toEqual([]);
	await settleElection(w.db, COMMITTEE, s, after, first, null);
	expect(DIRECTOR_MAX).toBe(3);
	expect(w.terms(next)).toEqual([
		{ userId: a, role: 'chair', rank: 0 },
		{ userId: b, role: 'director', rank: 1 },
		{ userId: c, role: 'director', rank: 2 },
		{ userId: d, role: 'director', rank: 3 }
	]);
	expect(w.terms(s)).toEqual([]);
	// 数えた票の合計（取り下げと運営になった候補の票は入らない）
	expect({ ...(w.sqlite.prepare('SELECT total_votes FROM chair_elections WHERE session_key = ?').get(s.key) as object) }).toEqual({ total_votes: 15 });

	// 何度走っても同じで、違うくじでも変わらない
	await settleElection(w.db, COMMITTEE, s, after + 1, () => 0.9, null);
	expect(w.terms(next).map((t) => t.userId)).toEqual([a, b, c, d]);

	// 同数はくじ：くじの小さい順に上に立つ
	const tie = monthOf('2030-10');
	const [x, y] = [await w.stand(tie), await w.stand(tie)];
	await w.vote(tie, x, 2);
	await w.vote(tie, y, 2);
	const draws = [0.9, 0.1];
	await settleElection(w.db, COMMITTEE, tie, tie.endsAt + 60_000, () => draws.shift() as number, null);
	expect(w.terms(nextOf(tie)).map((t) => [t.userId, t.role])).toEqual([[y, 'chair'], [x, 'director']]);

	// 候補がいなければ委員長なし。確定の印は入る
	const empty = monthOf('2031-01');
	await settleElection(w.db, COMMITTEE, empty, empty.endsAt + 60_000, first, null);
	expect(w.terms(nextOf(empty))).toEqual([]);
	expect((w.sqlite.prepare('SELECT count(*) AS n FROM chair_elections WHERE session_key = ?').get(empty.key) as { n: number }).n).toBe(1);
	// 候補がいても票がなければ委員長なし
	const novote = monthOf('2031-03');
	await w.stand(novote);
	await settleElection(w.db, COMMITTEE, novote, novote.endsAt + 60_000, first, null);
	expect(w.terms(nextOf(novote))).toEqual([]);

	// 短い会期でも次の会期が任期になる
	const short = sessionAt(jst('2031-06-10T00:00:00'), 8);
	const shortCandidate = w.addUser();
	w.addPost(shortCandidate, short);
	expect(await standForChair(w.db, w.actorOf(shortCandidate), COMMITTEE, short, sessionAt(short.startsAt - 1, 8), short.voteAt)).toEqual({ ok: true });
	await w.vote(short, shortCandidate, 1);
	await settleElection(w.db, COMMITTEE, short, short.endsAt + 60_000, first, 8);
	expect(w.sqlite.prepare('SELECT session_key AS k FROM chair_terms WHERE user_id = ?').all(shortCandidate).map((r) => r.k)).toEqual([sessionAt(short.endsAt, 8).key]);

	// Cron（会期の終わりの処理）でも確定する
	const cron = monthOf('2031-08');
	const winner = await w.stand(cron);
	await w.vote(cron, winner, 1);
	await runSessionEnd(w.db, cron.endsAt + 60_000);
	expect(w.terms(nextOf(cron)).map((t) => t.userId)).toEqual([winner]);
});

test('基準5：委員長の権限、任期の外、締め出し、関わり、記録、通報の文面、運営、初回', async () => {
	const w = world();
	const term = monthOf('2032-05');
	const chair = w.addUser();
	w.addTerm(term, chair, 'chair', 0);
	const at = term.startsAt + DAY;
	const power = (userId: string, now = at) => chairPowerOf(w.db, userId, now, null);

	// 任期の中だけ
	expect(await power(chair)).toBe('chair');
	expect(await power(chair, term.startsAt - 1)).toBe(null);
	expect(await power(chair, term.endsAt)).toBe(null);
	// 締め出されているあいだはできず、終わると戻る
	w.ban(chair, at + 1000);
	expect(await power(chair)).toBe(null);
	expect(await staffRoleOf(w.db, chair, at, null)).toBe(null);
	expect(await power(chair, at + 1000)).toBe('chair');
	const later = at + 2000;

	// 課題と解決策の対応、統合、結果の確認ができ、記録に委員長と出る
	const staff = { userId: chair, role: (await staffRoleOf(w.db, chair, later, null)) as 'chair' };
	expect(staff.role).toBe('chair');
	const issue = w.addIssue();
	expect(await changeStatus(w.db, issue, HIDEABLE, 'hidden', staff, 'spam', 'メモ', later)).toBe(true);
	expect((w.sqlite.prepare('SELECT actor, actor_user_id AS u FROM moderation_logs WHERE issue_id = ?').get(issue) as { actor: string; u: string })).toMatchObject({ actor: 'chair', u: chair });
	const solution = w.addSolution(w.addIssue());
	expect(await changeSolutionStatus(w.db, solution, HIDEABLE, 'hidden', staff, 'spam', 'メモ', later)).toBe(true);
	expect((w.sqlite.prepare('SELECT actor FROM moderation_logs WHERE solution_id = ?').get(solution) as { actor: string }).actor).toBe('chair');
	const [source, target] = [w.addIssue(), w.addIssue()];
	expect(await mergeIssue(w.db, source, target, staff, 'まとめる', later)).toBe(true);
	expect((w.sqlite.prepare("SELECT actor FROM moderation_logs WHERE action = 'merge' AND issue_id = ?").get(source) as { actor: string }).actor).toBe('chair');
	const reviewed = w.addBill();
	w.addReview(term, reviewed);
	expect(await decideReview(w.db, staff, term.key, reviewed, 'void', '理由', later, null)).toBe(true);
	const log = await reviewLogPage(w.db, 1);
	expect(log.rows.find((r) => r.billId === reviewed)?.role).toBe('chair');

	// 関わった法案は関わりの判定に当たる（確認の受け付けが断る）
	const ownBill = w.addBill(COMMITTEE, chair);
	expect(await involvedInBill(w.db, ownBill, chair)).toBe(true);

	// 自分の課題と解決策への通報の自由記述は読めない。ほかの人の課題の文面と数は読める
	const own = w.addIssue(chair);
	const others = w.addIssue();
	const ownSolution = w.addSolution(others, chair);
	const reporter = w.addUser();
	for (const id of [own, others]) w.sqlite.prepare("INSERT INTO reports (issue_id, user_id, reason, note, created_at) VALUES (?, ?, 'other', '通報の文面', 0)").run(id, reporter);
	w.sqlite.prepare("INSERT INTO solution_reports (solution_id, user_id, reason, note, created_at) VALUES (?, ?, 'other', '通報の文面', 0)").run(ownSolution, reporter);
	const rows = staffRows(await reportedIssues(w.db, null), chair);
	expect(rows.find((r) => r.id === own)).toMatchObject({ mine: true, notes: [], other: 1 });
	expect(rows.find((r) => r.id === others)).toMatchObject({ mine: false, notes: ['通報の文面'] });
	expect(rows.every((r) => !('userId' in r))).toBe(true);
	expect(staffRows(await reportedSolutions(w.db, null), chair).find((r) => r.id === ownSolution)).toMatchObject({ mine: true, notes: [] });

	// 運営の権限は変わらない。任期があっても運営の役職で動く
	const operator = w.addUser();
	w.setRole(operator, 'operator');
	expect(await staffRoleOf(w.db, operator, at, null)).toBe('operator');
	w.addTerm(term, operator, 'director', 1);
	expect(await staffRoleOf(w.db, operator, at, null)).toBe('operator');
	const promoted = w.addUser();
	const nextTerm = nextOf(term);
	w.addTerm(nextTerm, promoted, 'chair', 0);
	w.setRole(promoted, 'moderator');
	expect(await staffRoleOf(w.db, promoted, nextTerm.startsAt + 1, null)).toBe('moderator');
	// ふつうの人は権限がない
	expect(await staffRoleOf(w.db, w.addUser(), at, null)).toBe(null);

	// 初回の会期は委員長がいない
	const firstMonth = monthOf('2033-05');
	expect(await chairPanelOf(w.db, COMMITTEE, firstMonth, firstMonth.startsAt + 2 * 60_000)).toMatchObject({ chair: null, directors: [], settling: false });
});

test('基準6：解任の署名、最低10人、取り消し、できない人、回線の上限、解任のあと、署名した人を出さない', async () => {
	const w = world();
	const s = monthOf('2034-05');
	const prev = previousOf(s);
	const chair = w.addUser();
	const director = w.addUser();
	w.addTerm(s, chair, 'chair', 0);
	w.addTerm(s, director, 'director', 1);
	w.fixParticipants(s, 30);
	const at = s.startsAt + DAY;
	const sign = (userId: string, ip?: string, now = at) => signRecall(w.db, w.actorOf(userId, ip), COMMITTEE, s, prev, now);
	expect(recallRequirement(0)).toBe(10);
	expect(recallRequirement(50)).toBe(10);
	expect(recallRequirement(51)).toBe(11);
	expect(recallRequirement(100)).toBe(20);

	// できない人：本人、理事、運営と運営協力者、資格のない人
	w.voter(s, chair);
	w.voter(s, director);
	expect(await sign(chair)).toEqual({ ok: false, reason: 'forbidden' });
	expect(await sign(director)).toEqual({ ok: false, reason: 'forbidden' });
	for (const role of ['moderator', 'operator']) {
		const staff = w.voter(s);
		w.setRole(staff, role);
		expect(await sign(staff)).toEqual({ ok: false, reason: 'staff' });
	}
	expect(await sign(w.addUser())).toEqual({ ok: false, reason: 'ineligible' });

	// 1回線から3アカウントまで。超えても違反に数えない
	const lineSigners: string[] = [];
	for (let i = 0; i < 3; i++) {
		const u = w.voter(s);
		lineSigners.push(u);
		expect(await sign(u, 'same-line')).toEqual({ ok: true, recalled: false });
	}
	const over = w.voter(s);
	expect(await sign(over, 'same-line')).toEqual({ ok: false, refusal: { kind: 'recall-ip' } });
	expect((w.sqlite.prepare("SELECT count(*) AS n FROM actions WHERE kind = 'violation' AND user_id = ?").get(over) as { n: number }).n).toBe(0);

	// 届く前は取り消せる。取り消すと数えない
	expect(await cancelRecallSignature(w.db, w.actorOf(lineSigners[0]), COMMITTEE, s)).toBe(true);
	expect(await recallStateOf(w.db, COMMITTEE, s, prev, lineSigners[0], at)).toEqual({ required: 10, signatures: 2, signed: false, open: true });
	// 押し直しても数は増えない
	expect(await sign(lineSigners[1], 'same-line')).toEqual({ ok: true, recalled: false });
	expect((await recallStateOf(w.db, COMMITTEE, s, prev, lineSigners[1], at)).signatures).toBe(2);

	// 7人足して9人では解任にならず、10人目で解任される。権限を失う
	for (let i = 0; i < 7; i++) expect(await sign(w.voter(s))).toEqual({ ok: true, recalled: false });
	expect(await chairPowerOf(w.db, chair, at, null)).toBe('chair');
	const tenth = w.voter(s, w.addUser('十人目の署名者'));
	expect(await sign(tenth)).toEqual({ ok: true, recalled: true });
	expect(await chairPowerOf(w.db, chair, at, null)).toBe(null);

	// 解任のあとは署名も取り消しもできない
	expect(await sign(w.voter(s))).toEqual({ ok: false, reason: 'closed' });
	expect(await cancelRecallSignature(w.db, w.actorOf(tenth), COMMITTEE, s)).toBe(false);
	const state = await recallStateOf(w.db, COMMITTEE, s, prev, null, at);
	expect(state).toEqual({ required: 10, signatures: 10, signed: false, open: false });
	// 署名した人は出ない
	const seen = JSON.stringify([state, await chairPanelOf(w.db, COMMITTEE, s, at)]);
	expect(seen).not.toContain('十人目の署名者');
	expect(seen).not.toContain(tenth);
	expect(await chairPanelOf(w.db, COMMITTEE, s, at)).toMatchObject({ recalled: true });

	// 参加者の 20%：60人なら12人。委員長がいなければ署名できない
	const big = monthOf('2034-08');
	w.fixParticipants(big, 60);
	w.addTerm(big, w.addUser(), 'chair', 0);
	expect((await recallStateOf(w.db, COMMITTEE, big, previousOf(big), null, big.startsAt)).required).toBe(12);
	const none = monthOf('2034-10');
	expect(await signRecall(w.db, w.actorOf(w.voter(none)), COMMITTEE, none, previousOf(none), none.startsAt)).toEqual({ ok: false, reason: 'closed' });
});

test('基準7：代行の7日、操作で止まる、解任と締め出しはすぐ、統合も操作、理事がいなければ運営だけ', async () => {
	const w = world();
	const s = monthOf('2035-05');
	const chair = w.addUser();
	const director = w.addUser();
	const second = w.addUser();
	w.addTerm(s, chair, 'chair', 0);
	w.addTerm(s, director, 'director', 1);
	w.addTerm(s, second, 'director', 2);
	const power = (userId: string, now: number) => chairPowerOf(w.db, userId, now, null);
	expect(ACTING_AFTER).toBe(7 * DAY);

	// 任期の始まりから7日の前はできない。7日たつと理事の全員ができる。委員長の権限は残る
	expect(await power(director, s.startsAt + ACTING_AFTER - 1)).toBe(null);
	const acting = s.startsAt + ACTING_AFTER;
	expect(await power(director, acting)).toBe('director');
	expect(await power(second, acting)).toBe('director');
	expect(await power(chair, acting)).toBe('chair');
	expect(await staffRoleOf(w.db, director, acting, null)).toBe('director');
	expect(await chairPanelOf(w.db, COMMITTEE, s, acting)).toMatchObject({ acting: true });

	// 代行の操作の記録は理事
	const issue = w.addIssue();
	expect(await changeStatus(w.db, issue, HIDEABLE, 'hidden', { userId: director, role: 'director' }, 'spam', 'メモ', acting)).toBe(true);
	expect((w.sqlite.prepare('SELECT actor FROM moderation_logs WHERE issue_id = ?').get(issue) as { actor: string }).actor).toBe('director');

	// 委員長が操作すると止まり、そこから7日でまた代行できる（時刻から求める）
	const chairStaff = { userId: chair, role: 'chair' as const };
	const t1 = acting + DAY;
	expect(await changeStatus(w.db, w.addIssue(), HIDEABLE, 'hidden', chairStaff, 'spam', 'メモ', t1)).toBe(true);
	expect(await power(director, t1)).toBe(null);
	expect(await chairPanelOf(w.db, COMMITTEE, s, t1)).toMatchObject({ acting: false });
	expect(await power(director, t1 + ACTING_AFTER)).toBe('director');

	// 統合も操作に数える
	const t2 = t1 + ACTING_AFTER + 1;
	expect(await mergeIssue(w.db, w.addIssue(), w.addIssue(), chairStaff, 'まとめる', t2)).toBe(true);
	expect(await power(director, t2)).toBe(null);
	// 結果の確認も操作に数える
	const longer = monthOf('2035-07');
	const c2 = w.addUser();
	const d2 = w.addUser();
	w.addTerm(longer, c2, 'chair', 0);
	w.addTerm(longer, d2, 'director', 1);
	const reviewed = w.addBill();
	w.addReview(longer, reviewed);
	const t3 = longer.startsAt + 8 * DAY;
	expect(await power(d2, t3)).toBe('director');
	expect(await decideReview(w.db, { userId: c2, role: 'chair' }, longer.key, reviewed, 'void', '理由', t3, null)).toBe(true);
	expect(await power(d2, t3)).toBe(null);
	// 解決策の操作も数える
	const t4 = t3 + ACTING_AFTER;
	expect(await power(d2, t4)).toBe('director');
	expect(await changeSolutionStatus(w.db, w.addSolution(w.addIssue()), HIDEABLE, 'hidden', { userId: c2, role: 'chair' }, 'spam', 'メモ', t4)).toBe(true);
	expect(await power(d2, t4)).toBe(null);

	// 運営の役職で行った操作は、委員長の操作に数えない
	const third = monthOf('2035-09');
	const c3 = w.addUser();
	const d3 = w.addUser();
	w.addTerm(third, c3, 'chair', 0);
	w.addTerm(third, d3, 'director', 1);
	const t5 = third.startsAt + 8 * DAY;
	expect(await changeStatus(w.db, w.addIssue(), HIDEABLE, 'hidden', { userId: c3, role: 'moderator' }, 'spam', 'メモ', t5)).toBe(true);
	expect(await power(d3, t5)).toBe('director');

	// 委員長が締め出されているあいだはすぐ代行でき、終わると戻る。画面には代行と出さない
	const banned = monthOf('2035-11');
	const c4 = w.addUser();
	const d4 = w.addUser();
	w.addTerm(banned, c4, 'chair', 0);
	w.addTerm(banned, d4, 'director', 1);
	const t6 = banned.startsAt + DAY;
	expect(await power(d4, t6)).toBe(null);
	w.ban(c4, t6 + 1000);
	expect(await power(d4, t6)).toBe('director');
	expect(await chairPanelOf(w.db, COMMITTEE, banned, t6)).toMatchObject({ acting: false });
	expect(await power(d4, t6 + 1000)).toBe(null);

	// 締め出された理事に権限はない
	const banned2 = monthOf('2036-01');
	const c5 = w.addUser();
	const d5 = w.addUser();
	w.addTerm(banned2, c5, 'chair', 0);
	w.addTerm(banned2, d5, 'director', 1);
	const t7 = banned2.startsAt + 8 * DAY;
	w.ban(d5, t7 + 1000);
	expect(await power(d5, t7)).toBe(null);

	// 解任のあとはすぐ代行できる
	const recall = monthOf('2036-03');
	const c6 = w.addUser();
	const d6 = w.addUser();
	w.addTerm(recall, c6, 'chair', 0);
	w.addTerm(recall, d6, 'director', 1);
	w.fixParticipants(recall, 10);
	const t8 = recall.startsAt + DAY;
	expect(await power(d6, t8)).toBe(null);
	for (let i = 0; i < 10; i++) await signRecall(w.db, w.actorOf(w.voter(recall)), COMMITTEE, recall, previousOf(recall), t8);
	expect(await power(d6, t8)).toBe('director');
	expect(await chairPanelOf(w.db, COMMITTEE, recall, t8)).toMatchObject({ recalled: true, acting: true });

	// 理事がいなければ運営だけ：解任のあと、ほかの人に権限はない
	const alone = monthOf('2036-05');
	const c7 = w.addUser();
	w.addTerm(alone, c7, 'chair', 0);
	w.fixParticipants(alone, 10);
	const t9 = alone.startsAt + DAY;
	for (let i = 0; i < 10; i++) await signRecall(w.db, w.actorOf(w.voter(alone)), COMMITTEE, alone, previousOf(alone), t9);
	expect(await staffRoleOf(w.db, c7, t9, null)).toBe(null);
	expect(await staffRoleOf(w.db, w.addUser(), t9, null)).toBe(null);
	expect(await chairPanelOf(w.db, COMMITTEE, alone, t9)).toMatchObject({ directors: [], acting: false, recalled: true });
});
