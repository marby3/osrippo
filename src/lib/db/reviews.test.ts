// Issue #73 基準1・3・5 の DB の側（設計書 docs/spec/73.md）
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { beforeAll, expect, test, vi } from 'vitest';
import { openMemoryDb, type MemoryDb } from './memory';
import { sessionAt, type Session } from '../domain/session';
import { ifHeadOf } from '../server/if-world';
import { decideReview, involvedInBill, pendingReviews, resultOnRead, runSessionEnd, settleSession } from '../server/results';

let sqlite: DatabaseSync;
let db: MemoryDb;
const jst = (s: string) => Date.parse(`${s}+09:00`);
const monthOf = (key: string) => sessionAt(jst(`${key}-10T00:00:00`), null);
const previousOf = (s: Session) => sessionAt(s.startsAt - 1, null);
const nextOf = (s: Session) => sessionAt(s.endsAt, null);
const MINUTE = 60_000;
const after = (s: Session) => s.endsAt + MINUTE;
const para = (text: string) => JSON.stringify([{ num: '1', text, items: [] }]);

let counter = 0;
const unique = () => ++counter;
function addUser(createdAt = 0) {
	const id = `w${unique()}`;
	sqlite.prepare('INSERT INTO user (id, name, email, created_at, updated_at) VALUES (?, ?, ?, ?, 0)').run(id, id, `${id}@test.invalid`, createdAt);
	return id;
}
function voter(createdAt = 0) {
	const id = addUser(createdAt);
	sqlite.prepare("INSERT INTO actions (kind, user_id, ip_hash, created_at) VALUES ('issue_post', ?, 'x', 0)").run(id);
	return id;
}
function addLaw() {
	const n = unique();
	const lawId = `K${n}`;
	const revisionId = `Q${n}`;
	sqlite.prepare("INSERT INTO laws (id, title, law_num) VALUES (?, ?, '番号')").run(lawId, `法令${n}`);
	sqlite.prepare("INSERT INTO law_revisions (id, law_id, branch, seq, enforcement_date, status) VALUES (?, ?, 'real', 0, '2020-01-01', 'enforced')").run(revisionId, lawId);
	const article = Number(sqlite.prepare("INSERT INTO provisions (law_id, kind) VALUES (?, 'article')").run(lawId).lastInsertRowid);
	sqlite.prepare("INSERT INTO provision_versions (provision_id, from_revision_id, num, caption, change) VALUES (?, ?, '1', '（見出し）', 'baseline')").run(article, revisionId);
	const paragraph = Number(sqlite.prepare("INSERT INTO provisions (law_id, kind, parent_id) VALUES (?, 'paragraph', ?)").run(lawId, article).lastInsertRowid);
	sqlite.prepare("INSERT INTO provision_versions (provision_id, from_revision_id, num, text, change) VALUES (?, ?, '1', 'もとの本文', 'baseline')").run(paragraph, revisionId);
	return { lawId, revisionId, article };
}
function addBill(s: Session, law: ReturnType<typeof addLaw>, order = unique()) {
	const id = Number(
		sqlite
			.prepare("INSERT INTO bills (user_id, committee_id, kind, status, rev, next_rev, proposed_rev, title, affected, side_effects, created_at, updated_at, proposed_at) VALUES (?, 1, 'amend', 'proposed', 1, 2, 1, 't', 'a', 's', 0, 0, ?)")
			.run(addUser(), s.startsAt + order).lastInsertRowid
	);
	sqlite.prepare("INSERT INTO bill_laws (bill_id, rev, seq, action, law_id, base_revision_id) VALUES (?, 1, 0, 'amend', ?, ?)").run(id, law.lawId, law.revisionId);
	sqlite.prepare('INSERT INTO bill_solutions (bill_id, rev, seq, solution_id) VALUES (?, 1, 0, 1)').run(id);
	sqlite.prepare("INSERT INTO bill_changes (bill_id, rev, law_seq, num, op, provision_id, caption, body) VALUES (?, 1, 0, '1', 'amend', ?, '（見出し）', ?)").run(id, law.article, para(`法案${id}の本文`));
	return id;
}
/** 票を入れる。line を渡すと、その回線の記録も足す。時刻は3分おき */
function cast(s: Session, bill: number, choice: 'yes' | 'no' | 'abstain', n: number, line?: string) {
	for (let i = 0; i < n; i++) {
		const v = voter();
		const at = s.voteAt + unique() * 3 * MINUTE;
		sqlite.prepare('INSERT INTO votes (session_key, bill_id, user_id, choice, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(s.key, bill, v, choice, at, at);
		if (line) sqlite.prepare("INSERT INTO actions (kind, user_id, ip_hash, target_id, created_at) VALUES ('vote_cast', ?, ?, ?, ?)").run(v, line, bill, at);
	}
}
const fix = (s: Session) => sqlite.prepare('INSERT INTO session_participants (committee_id, session_key, active_count, fixed_at) VALUES (1, ?, 0, 0)').run(s.key);
const settle = (s: Session, at = after(s)) => settleSession(db, s, previousOf(s), at, null);
const reviewOf = (s: Session, bill: number) => {
	const row = sqlite.prepare('SELECT * FROM vote_reviews WHERE session_key = ? AND bill_id = ?').get(s.key, bill);
	return row ? { ...row } : undefined;
};
const staff = { userId: 'staff', role: 'operator' as const };

beforeAll(() => {
	({ sqlite, db } = openMemoryDb());
	sqlite.exec("INSERT INTO user (id, name, email, created_at, updated_at) VALUES ('issuer', 'i', 'i@test.invalid', 0, 0), ('staff', 's', 's@test.invalid', 0, 0); INSERT INTO issues (id, user_id, title, affected, example, topic_id, created_at) VALUES (1, 'issuer', '課題', '人', '例', NULL, 0); INSERT INTO solutions (id, issue_id, user_id, body, created_at) VALUES (1, 1, 'issuer', '解決策', 0);");
});

test('基準1：0017 で表が増え、既存の行は残る。状態は決まった値だけ', () => {
	const old = new DatabaseSync(':memory:');
	old.exec('PRAGMA foreign_keys = ON');
	const dir = new URL('../../../drizzle/', import.meta.url);
	const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
	for (const f of files.filter((f) => f < '0017')) old.exec(readFileSync(new URL(f, dir), 'utf8'));
	old.exec("INSERT INTO user (id, name, email, created_at, updated_at) VALUES ('u', 'u', 'u@test.invalid', 0, 0)");
	old.exec("INSERT INTO bills (id, user_id, committee_id, kind, title, affected, side_effects, created_at, updated_at) VALUES (1, 'u', 1, 'amend', 't', 'a', 's', 0, 0)");
	old.exec("INSERT INTO bill_results (session_key, bill_id, outcome, yes, no, abstain, ref_yes, ref_no, ref_abstain, participants, quorum, rev, settled_at) VALUES ('s', 1, 'passed', 10, 0, 0, 0, 0, 0, 0, 10, 1, 0)");
	const later = files.filter((f) => f >= '0017');
	expect(later.length).toBeGreaterThan(0);
	for (const f of later) old.exec(readFileSync(new URL(f, dir), 'utf8'));
	expect(old.prepare('SELECT outcome FROM bill_results').all().map((r) => ({ ...r }))).toEqual([{ outcome: 'passed' }]);
	const insert = (status: string) => old.exec(`INSERT INTO vote_reviews (session_key, bill_id, signals, detail, status, created_at) VALUES ('s', 1, '[]', '{}', '${status}', 0)`);
	expect(() => insert('nope')).toThrow();
	insert('open');
});

test('基準3：見つかると確認の行ができ、可決が絡むときだけ保留する。否決から廃案、廃案、見つからない法案は保留しない。何度走っても同じ', async () => {
	const s = monthOf('2241-05');
	fix(s);
	const law = addLaw();
	// 可決：同じ回線の5票を除くと定足数に届かない → 保留
	const held = addBill(s, law, 1);
	cast(s, held, 'yes', 5, 'held-line');
	cast(s, held, 'yes', 3, 'a');
	cast(s, held, 'no', 2, 'b');
	// 可決：除いても可決のまま → 保留しない
	const noted = addBill(s, addLaw(), 2);
	cast(s, noted, 'no', 5, 'noted-line');
	for (let i = 0; i < 15; i++) cast(s, noted, 'yes', 1, `line-${i}`);
	// 否決：除くと廃案（どちらも IF世界に入らない） → 保留しない
	const rejected = addBill(s, addLaw(), 3);
	cast(s, rejected, 'no', 5, 'rejected-line');
	cast(s, rejected, 'no', 5);
	// 廃案は見ない
	const lapsed = addBill(s, addLaw(), 4);
	cast(s, lapsed, 'yes', 5, 'lapsed-line');
	// 見つからない
	const plain = addBill(s, addLaw(), 5);
	for (let i = 0; i < 10; i++) cast(s, plain, 'yes', 1, `plain-${i}`);

	// 数えない票（前に行動していない人）が同じ回線に集まっても見ない
	const uncounted = addBill(s, addLaw(), 6);
	for (let i = 0; i < 10; i++) cast(s, uncounted, 'yes', 1, `uncounted-${i}`);
	for (let i = 0; i < 6; i++) {
		const v = addUser();
		const at = s.voteAt + unique() * 3 * MINUTE;
		sqlite.prepare("INSERT INTO votes (session_key, bill_id, user_id, choice, created_at, updated_at) VALUES (?, ?, ?, 'no', ?, ?)").run(s.key, uncounted, v, at, at);
		sqlite.prepare("INSERT INTO actions (kind, user_id, ip_hash, target_id, created_at) VALUES ('vote_cast', ?, 'uncounted-line', ?, ?)").run(v, uncounted, at);
	}

	await settle(s);
	expect(reviewOf(s, uncounted)).toBeUndefined();
	expect(reviewOf(s, held)).toMatchObject({ status: 'open', signals: '["same_line"]' });
	expect(JSON.parse((reviewOf(s, held) as unknown as { detail: string }).detail)).toMatchObject({ flagged: 5, without: 'lapsed' });
	expect(reviewOf(s, noted)).toMatchObject({ status: 'noted' });
	expect(reviewOf(s, rejected)).toMatchObject({ status: 'noted' });
	expect(reviewOf(s, lapsed)).toBeUndefined();
	expect(reviewOf(s, plain)).toBeUndefined();
	// 保留した法案は IF世界に入らず、保留しない法案は入る
	expect((await ifHeadOf(db, law.lawId)).seq).toBe(0);
	expect(sqlite.prepare('SELECT count(*) AS n FROM if_revisions WHERE bill_id = ?').get(noted)).toEqual({ n: 1 });

	const before = reviewOf(s, held);
	await settle(s, after(s) + MINUTE);
	expect(reviewOf(s, held)).toEqual(before);

	// 運営の画面：提出者と賛同者（どの版でも）には賛否の数と集計を渡さない
	const heldAuthor = (sqlite.prepare('SELECT user_id FROM bills WHERE id = ?').get(held) as { user_id: string }).user_id;
	const backer = addUser();
	sqlite.prepare('INSERT INTO bill_supports (bill_id, rev, user_id, created_at) VALUES (?, 0, ?, 0)').run(held, backer);
	const rowFor = async (userId: string) => (await pendingReviews(db, userId)).find((r) => r.billId === held);
	expect(await rowFor('staff')).toMatchObject({ involved: false, counts: { yes: 8, no: 2, abstain: 0 }, detail: { flagged: 5 }, signals: ['same_line'] });
	for (const who of [heldAuthor, backer]) {
		expect(await rowFor(who)).toMatchObject({ involved: true, counts: null, detail: null, signals: ['same_line'] });
		expect(await involvedInBill(db, held, who)).toBe(true);
	}
	expect(await involvedInBill(db, held, 'staff')).toBe(false);
	// 確認の行がない法案や保留しない法案は出ない
	expect((await pendingReviews(db, 'staff')).some((r) => r.billId === noted)).toBe(false);

	// 読むときは確認の状態も一緒に返す
	expect(await resultOnRead(db, { id: held, proposedAt: s.startsAt + 1 }, null, after(s))).toMatchObject({ outcome: 'passed', review: { status: 'open' } });
	expect(await resultOnRead(db, { id: plain, proposedAt: s.startsAt + 5 }, null, after(s))).toMatchObject({ outcome: 'passed', review: null });
});

test('前の会期の基準には、確認中と無効の法案の票を入れない。基準との差で新しいアカウントを見つける', async () => {
	const prev = monthOf('2243-05');
	fix(prev);
	// 前の会期：新しいアカウントが多い法案は確認中で、基準に入らない
	const heldBill = addBill(prev, addLaw(), 1);
	for (let i = 0; i < 40; i++) {
		const v = voter(prev.startsAt - 86_400_000);
		sqlite.prepare("INSERT INTO votes (session_key, bill_id, user_id, choice, created_at, updated_at) VALUES (?, ?, ?, 'yes', ?, ?)").run(prev.key, heldBill, v, prev.voteAt + i * 3 * MINUTE, prev.voteAt + i * 3 * MINUTE);
	}
	sqlite.prepare("INSERT INTO vote_reviews (session_key, bill_id, signals, detail, status, created_at) VALUES (?, ?, '[\"same_line\"]', '{}', 'open', 0)").run(prev.key, heldBill);
	const normal = addBill(prev, addLaw(), 2);
	cast(prev, normal, 'yes', 30);
	await settle(prev);

	const s = nextOf(prev);
	fix(s);
	const bill = addBill(s, addLaw(), 1);
	for (let i = 0; i < 12; i++) {
		const v = voter(s.startsAt - 86_400_000);
		const at = s.voteAt + i * 3 * MINUTE;
		sqlite.prepare("INSERT INTO votes (session_key, bill_id, user_id, choice, created_at, updated_at) VALUES (?, ?, ?, 'yes', ?, ?)").run(s.key, bill, v, at, at);
	}
	// 古いアカウントの票を足して、新しいアカウントの割合を 40%（12 / 30）にする
	for (let i = 0; i < 18; i++) cast(s, bill, i % 3 ? 'yes' : 'no', 1, `old-${i}`);
	await settle(s);
	// 基準は 0%（前の会期の通常の法案だけ）なので 40 ポイント高く、見つかる。確認中の法案を入れると基準は 57% になり、見つからない。
	// 除いても可決のままなので保留しない
	expect(reviewOf(s, bill)).toMatchObject({ signals: '["new_accounts"]', status: 'noted' });
});

test('基準5：確定すると反映される。次の会期にずれ込んでも、新しい変更と重なれば要調整。無効は反映しない。確定は1回だけ。Cron でもやり直せる', async () => {
	const s = monthOf('2245-05');
	fix(s);
	const law = addLaw();
	const held = addBill(s, law, 1);
	cast(s, held, 'yes', 5, 'L1');
	cast(s, held, 'yes', 3, 'L2');
	cast(s, held, 'no', 2, 'L3');
	await settle(s);

	// 次の会期に別の法案が同じ条を変える（保留の法案を待たない）
	const n = nextOf(s);
	fix(n);
	const later = addBill(n, law, 1);
	for (let i = 0; i < 10; i++) cast(n, later, 'yes', 1, `n-${i}`);
	await settle(n);
	expect((await ifHeadOf(db, law.lawId)).seq).toBe(1);

	expect(await decideReview(db, staff, s.key, held, 'confirm', null, after(n), null)).toBe(true);
	expect(reviewOf(s, held)).toMatchObject({ status: 'confirmed', decided_role: 'operator', decided_by: 'staff' });
	// 基にした版のあとで同じ条が変わったので要調整
	expect(sqlite.prepare('SELECT reason FROM bill_adjustments WHERE bill_id = ?').get(held)).toEqual({ reason: 'article' });
	// 確定は1回だけ
	expect(await decideReview(db, staff, s.key, held, 'void', '遅い', after(n), null)).toBe(false);

	// 無効は反映しない
	const s2 = monthOf('2247-05');
	fix(s2);
	const law2 = addLaw();
	const voided = addBill(s2, law2, 1);
	cast(s2, voided, 'yes', 5, 'V1');
	cast(s2, voided, 'yes', 3, 'V2');
	cast(s2, voided, 'no', 2, 'V3');
	await settle(s2);
	expect(await decideReview(db, staff, s2.key, voided, 'void', '組織的な票でした', after(s2), null)).toBe(true);
	expect(reviewOf(s2, voided)).toMatchObject({ status: 'voided', note: '組織的な票でした' });
	expect((await ifHeadOf(db, law2.lawId)).seq).toBe(0);
	expect(await resultOnRead(db, { id: voided, proposedAt: s2.startsAt + 1 }, null, after(s2))).toMatchObject({ review: { status: 'voided' } });

	// 確定の直後の反映に失敗しても確定は残り、次の Cron でやり直す。古い会期の失敗は直前の会期を止めない
	const s3 = monthOf('2249-05');
	fix(s3);
	const law3 = addLaw();
	const retried = addBill(s3, law3, 1);
	cast(s3, retried, 'yes', 5, 'R1');
	cast(s3, retried, 'yes', 3, 'R2');
	cast(s3, retried, 'no', 2, 'R3');
	await settle(s3);
	const log = vi.spyOn(console, 'error').mockImplementation(() => {});
	sqlite.exec(`CREATE TRIGGER fail_retried BEFORE INSERT ON if_revisions WHEN NEW.bill_id = ${retried} BEGIN SELECT RAISE(ABORT, 'だめ'); END;`);
	expect(await decideReview(db, staff, s3.key, retried, 'confirm', null, after(s3), null)).toBe(true);
	expect(reviewOf(s3, retried)).toMatchObject({ status: 'confirmed' });
	expect((await ifHeadOf(db, law3.lawId)).seq).toBe(0);

	// 直前の会期（2か月あと）の法案。古い会期が失敗し続けても処理される
	const s4 = nextOf(nextOf(s3));
	fix(s4);
	const law4 = addLaw();
	const current = addBill(s4, law4, 1);
	for (let i = 0; i < 10; i++) cast(s4, current, 'yes', 1, `c-${i}`);
	await expect(runSessionEnd(db, after(s4))).rejects.toThrow();
	expect((await ifHeadOf(db, law4.lawId)).seq).toBe(1);
	sqlite.exec('DROP TRIGGER fail_retried');
	await runSessionEnd(db, after(s4) + MINUTE);
	expect((await ifHeadOf(db, law3.lawId)).seq).toBe(1);
	log.mockRestore();
});
