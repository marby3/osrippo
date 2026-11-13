// Issue #171 基準4：「委員長に立候補できるまで」の条件ごとの済んだ・まだが、立候補の確かめ（standBlock）と同じになる。
// 画面は e2e/watashi.spec.ts
import { expect, test } from 'vitest';
import { candidacyEnd, candidacyOpen, candidacySteps } from '../domain/chairs';
import { sessionAt, type Session } from '../domain/session';
import { candidacyChecks, standBlock } from '../server/chairs';
import { openMemoryDb } from './memory';

const jst = (s: string) => Date.parse(`${s}+09:00`);
const SESSION = sessionAt(jst('2030-05-10T00:00:00'), null);
const PREVIOUS = sessionAt(SESSION.startsAt - 1, null);
const COMMITTEE = 1;

type PostOpts = { kind?: 'question' | 'answer' | 'supplement'; session?: Session; committee?: number; status?: string; actor?: string | null };

function world() {
	const { sqlite, db } = openMemoryDb();
	sqlite.exec("INSERT INTO user (id, name, email, created_at, updated_at) VALUES ('issuer', 'i', 'i@test.invalid', 0, 0); INSERT OR IGNORE INTO committees (id, name) VALUES (1, '第1'), (2, '第2');");
	let counter = 0;
	const addUser = (role: string | null = null) => {
		const id = `w${++counter}`;
		sqlite.prepare('INSERT INTO user (id, name, email, role, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 0)').run(id, `名前${counter}`, `${id}@test.invalid`, role);
		return id;
	};
	const addBill = (committee: number) =>
		Number(
			sqlite
				.prepare(
					"INSERT INTO bills (user_id, committee_id, kind, status, rev, next_rev, proposed_rev, title, affected, side_effects, created_at, updated_at, proposed_at) VALUES ('issuer', ?, 'amend', 'proposed', 1, 2, 1, ?, '人', '副作用', 0, 0, 0)"
				)
				.run(committee, `法案${++counter}`).lastInsertRowid
		);
	const addPost = (userId: string, opts: PostOpts = {}) => {
		const session = opts.session ?? SESSION;
		const bill = addBill(opts.committee ?? COMMITTEE);
		const kind = opts.kind ?? 'question';
		let parent: number | null = null;
		if (kind !== 'question') parent = Number(sqlite.prepare("INSERT INTO posts (bill_id, session_key, kind, user_id, body, created_at) VALUES (?, ?, 'question', 'issuer', '質疑', 0)").run(bill, session.key).lastInsertRowid);
		sqlite
			.prepare('INSERT INTO posts (bill_id, session_key, kind, parent_id, user_id, role, body, status, status_actor, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)')
			.run(bill, session.key, kind, parent, userId, kind === 'answer' ? 'other' : null, '本文', opts.status ?? 'visible', opts.actor ?? null);
	};
	let rank = 0;
	const addChair = (userId: string, session: Session, recalledAt: number | null = null) =>
		sqlite.prepare("INSERT INTO chair_terms (committee_id, session_key, user_id, role, rank, votes, recalled_at, created_at) VALUES (1, ?, ?, 'chair', 0, 1, ?, 0)").run(session.key, userId, recalledAt);
	const addDirector = (userId: string, session: Session) =>
		sqlite.prepare("INSERT INTO chair_terms (committee_id, session_key, user_id, role, rank, votes, created_at) VALUES (1, ?, ?, 'director', ?, 1, 0)").run(session.key, userId, ++rank);
	return { db, addUser, addPost, addChair, addDirector };
}

test('基準4：立候補の条件ごとの済んだ・まだが、立候補の確かめ（standBlock）と同じになる', async () => {
	type World = ReturnType<typeof world>;
	type Make = (w: World) => string;
	/** 投稿した人。opts を省くと、いまの会期にこの委員会の法案へ質疑を書いた人 */
	const writer =
		(opts: PostOpts = {}, role: string | null = null): Make =>
		(w) => {
			const id = w.addUser(role);
			w.addPost(id, opts);
			return id;
		};
	/** 委員長と理事の行を足す */
	const withTerms =
		(make: Make, terms: (w: World, id: string) => void): Make =>
		(w) => {
			const id = make(w);
			terms(w, id);
			return id;
		};
	const nobody: Make = (w) => w.addUser();
	// [説明, 人を作る, 運営か, 質疑か答弁を書いた, 委員長を2会期続けていない]。委員長は会期に1人なので、DB は場合ごとに作る
	const cases: [string, Make, boolean, boolean, boolean][] = [
		['何もしていない', nobody, false, false, true],
		['質疑を書いた', writer(), false, true, true],
		['答弁を書いた', writer({ kind: 'answer' }), false, true, true],
		['補足だけ', writer({ kind: 'supplement' }), false, false, true],
		['前の会期に書いた', writer({ session: PREVIOUS }), false, false, true],
		['ほかの委員会の法案に書いた', writer({ committee: 2 }), false, false, true],
		['自動で非表示', writer({ status: 'auto_hidden', actor: 'auto' }), false, true, true],
		['委員長が非表示', writer({ status: 'hidden', actor: 'chair' }), false, true, true],
		['運営が非表示', writer({ status: 'hidden', actor: 'operator' }), false, false, true],
		['2会期続けて委員長', withTerms(writer(), (w, id) => (w.addChair(id, SESSION), w.addChair(id, PREVIOUS))), false, true, false],
		['2会期続けて委員長（前の会期は解任）・書いていない', withTerms(nobody, (w, id) => (w.addChair(id, SESSION), w.addChair(id, PREVIOUS, SESSION.startsAt))), false, false, false],
		['いまの会期だけ委員長', withTerms(writer(), (w, id) => w.addChair(id, SESSION)), false, true, true],
		['前の会期は委員長、いまは理事', withTerms(writer(), (w, id) => (w.addChair(id, PREVIOUS), w.addDirector(id, SESSION))), false, true, true],
		['運営', writer({}, 'operator'), true, true, true],
		['運営協力者', (w) => w.addUser('moderator'), true, false, true]
	];

	const times = [SESSION.startsAt, SESSION.voteAt - 1, SESSION.voteAt, candidacyEnd(SESSION) - 1, candidacyEnd(SESSION), SESSION.endsAt - 1];
	for (const [label, make, staff, post, consecutive] of cases) {
		const w = world();
		const id = make(w);
		const checks = await candidacyChecks(w.db, id, COMMITTEE, SESSION, PREVIOUS);
		const block = await standBlock(w.db, id, COMMITTEE, SESSION, PREVIOUS);
		expect(checks.staff, label).toBe(staff);
		for (const now of times) {
			// どの人も登録は時刻 0（7日たっている）
			const steps = candidacySteps(checks, SESSION, now, 0);
			const done = Object.fromEntries(steps.map((s) => [s.key, s.done]));
			expect(done, `${label} ${now}`).toEqual({
				registered: true,
				post,
				consecutive,
				period: candidacyOpen(SESSION, now)
			});
			// 全部が「済み」なのは、立候補できるときだけ
			expect(!checks.staff && steps.every((s) => s.done), `${label} ${now}`).toBe(block === null && candidacyOpen(SESSION, now));
		}
		// 立候補の確かめが断る理由は、「まだ」の条件になっている
		if (block === 'staff') expect(checks.staff, label).toBe(true);
		if (block === 'consecutive') expect(consecutive, label).toBe(false);
		if (block === 'noPost') expect(post, label).toBe(false);
		if (block === null) expect(!staff && post && consecutive, label).toBe(true);
		if (!staff && !consecutive) expect(block, label).toBe('consecutive');
		if (!staff && consecutive && !post) expect(block, label).toBe('noPost');
	}
});
