// Issue #75 基準1・2・3・5：廃案・否決の法案からの出し直し（設計書 docs/spec/75.md）
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { expect, test } from 'vitest';
import { LIMITS } from '../domain/limits';
import { sessionAt, type Session } from '../domain/session';
import { coDrafters } from '../server/amendments';
import { billById, billSupportState, createUnconfirmedDraft, draftInputOf } from '../server/bills';
import { proposeBlock, staleArticles } from '../server/if-world';
import { billStageNow, settleSession } from '../server/results';
import { confirmResubmit, resubmitBill, resubmitStateOf } from '../server/resubmit';
import { openMemoryDb, type MemoryDb } from './memory';
/** 名前だけを比べる（認証のバッジは docs/spec/157.md） */
const names = (ps: { name: string }[]) => ps.map((p) => p.name);

const jst = (s: string) => Date.parse(`${s}+09:00`);
const monthOf = (key: string) => sessionAt(jst(`${key}-10T00:00:00`), null);
const previousOf = (s: Session) => sessionAt(s.startsAt - 1, null);
const nextOf = (s: Session) => sessionAt(s.endsAt, null);
const after = (s: Session) => s.endsAt + 60_000;
const para = (text: string) => JSON.stringify([{ num: '1', text, items: [] }]);

function world() {
	const { sqlite, db } = openMemoryDb();
	sqlite.exec("INSERT INTO user (id, name, email, created_at, updated_at) VALUES ('issuer', 'i', 'i@test.invalid', 0, 0); INSERT INTO issues (id, user_id, title, affected, example, topic_id, created_at) VALUES (1, 'issuer', '課題', '人', '例', NULL, 0); INSERT INTO solutions (id, issue_id, user_id, body, created_at) VALUES (1, 1, 'issuer', '解決策', 0);");
	let counter = 0;
	const unique = () => ++counter;
	const addUser = () => {
		const id = `f${unique()}`;
		sqlite.prepare('INSERT INTO user (id, name, email, created_at, updated_at) VALUES (?, ?, ?, 0, 0)').run(id, id, `${id}@test.invalid`);
		return id;
	};
	function addLaw() {
		const n = unique();
		const lawId = `L${n}`;
		const revisionId = `R${n}`;
		sqlite.prepare("INSERT INTO laws (id, title, law_num) VALUES (?, ?, '番号')").run(lawId, `法令${n}`);
		sqlite.prepare("INSERT INTO law_revisions (id, law_id, branch, seq, enforcement_date, status) VALUES (?, ?, 'real', 0, '2020-01-01', 'enforced')").run(revisionId, lawId);
		const ids: Record<string, number> = {};
		for (const num of ['1', '2']) {
			const article = Number(sqlite.prepare("INSERT INTO provisions (law_id, kind) VALUES (?, 'article')").run(lawId).lastInsertRowid);
			sqlite.prepare("INSERT INTO provision_versions (provision_id, from_revision_id, num, caption, change) VALUES (?, ?, ?, '（見出し）', 'baseline')").run(article, revisionId, num);
			const paragraph = Number(sqlite.prepare("INSERT INTO provisions (law_id, kind, parent_id) VALUES (?, 'paragraph', ?)").run(lawId, article).lastInsertRowid);
			sqlite.prepare("INSERT INTO provision_versions (provision_id, from_revision_id, num, text, change) VALUES (?, ?, '1', ?, 'baseline')").run(paragraph, revisionId, `第${num}条のもとの本文`);
			ids[num] = article;
		}
		return { lawId, revisionId, ids };
	}
	type Law = ReturnType<typeof addLaw>;
	/** 発議した法案（opts.draft なら下書き）。第1条を書きかえる */
	function addBill(s: Session, law: Law, opts: { action?: 'amend' | 'repeal'; draft?: boolean; baseIfSeq?: number; user?: string; text?: string } = {}) {
		const action = opts.action ?? 'amend';
		const author = opts.user ?? addUser();
		const id = Number(
			sqlite
				.prepare('INSERT INTO bills (user_id, committee_id, kind, status, rev, next_rev, proposed_rev, title, affected, side_effects, summary, supplementary, created_at, updated_at, proposed_at) VALUES (?, 1, ?, ?, 1, 2, ?, ?, ?, ?, ?, ?, 0, 0, ?)')
				.run(author, action, opts.draft ? 'draft' : 'proposed', opts.draft ? null : 1, `法案${unique()}`, '困っている人', '副作用', '要約', '附則', opts.draft ? null : s.startsAt + unique()).lastInsertRowid
		);
		sqlite.prepare('INSERT INTO bill_laws (bill_id, rev, seq, action, law_id, base_revision_id, base_if_seq) VALUES (?, 1, 0, ?, ?, ?, ?)').run(id, action, law.lawId, law.revisionId, opts.baseIfSeq ?? 0);
		sqlite.prepare('INSERT INTO bill_solutions (bill_id, rev, seq, solution_id) VALUES (?, 1, 0, 1)').run(id);
		if (action === 'amend') sqlite.prepare("INSERT INTO bill_changes (bill_id, rev, law_seq, num, op, provision_id, caption, body) VALUES (?, 1, 0, '1', 'amend', ?, '（見出し）', ?)").run(id, law.ids['1'], para(opts.text ?? '本文'));
		return { id, author };
	}
	function vote(s: Session, bill: number, choice: 'yes' | 'no') {
		for (let i = 0; i < 10; i++) {
			const voter = addUser();
			sqlite.prepare("INSERT INTO actions (kind, user_id, ip_hash, created_at) VALUES ('issue_post', ?, 'x', 0)").run(voter);
			sqlite.prepare('INSERT INTO votes (session_key, bill_id, user_id, choice, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 0)').run(s.key, bill, voter, choice);
		}
	}
	const settle = async (s: Session) => {
		sqlite.prepare('INSERT OR IGNORE INTO session_participants (committee_id, session_key, active_count, fixed_at) VALUES (1, ?, 0, 0)').run(s.key);
		await settleSession(db, s, previousOf(s), after(s), null);
	};
	const review = (s: Session, bill: number, status: 'open' | 'voided') => sqlite.prepare("INSERT INTO vote_reviews (session_key, bill_id, signals, detail, status, created_at) VALUES (?, ?, '[]', '{}', ?, 0)").run(s.key, bill, status);
	const can = async (bill: number, now: number) => {
		const loaded = await billById(db, bill);
		const view = await billStageNow(db, loaded as NonNullable<typeof loaded>, now, null);
		return (await resubmitStateOf(db, view.bill, view.stage)).can;
	};
	const actorOf = (userId: string, ipHash = `ip-${userId}`) => ({ userId, registeredAt: 0, ipHash });
	const load = async (id: number) => (await billById(db, id)) as NonNullable<Awaited<ReturnType<typeof billById>>>;
	return { sqlite, db: db as MemoryDb, addUser, addLaw, addBill, vote, settle, review, can, actorOf, load };
}

test('基準1：0019 で bills に列が増え、既存の行は残り NULL', () => {
	const old = new DatabaseSync(':memory:');
	old.exec('PRAGMA foreign_keys = ON');
	const dir = new URL('../../../drizzle/', import.meta.url);
	const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
	for (const f of files.filter((f) => f < '0019')) old.exec(readFileSync(new URL(f, dir), 'utf8'));
	old.exec("INSERT INTO user (id, name, email, created_at, updated_at) VALUES ('u', 'u', 'u@test.invalid', 0, 0)");
	old.exec("INSERT INTO bills (id, user_id, committee_id, kind, rev, next_rev, title, affected, side_effects, created_at, updated_at) VALUES (1, 'u', 1, 'amend', 1, 2, 't', 'a', 's', 0, 0)");
	const later = files.filter((f) => f >= '0019');
	expect(later.length).toBeGreaterThan(0);
	for (const f of later) old.exec(readFileSync(new URL(f, dir), 'utf8'));
	expect(old.prepare('SELECT title, resubmitted_from AS origin FROM bills WHERE id = 1').get()).toEqual({ title: 't', origin: null });
});

test('基準2：否決と廃案は出し直せて、ほかの段階と、対象の法令が IF世界で廃止された法案は出し直せない', async () => {
	const w = world();
	const s = monthOf('2030-05');
	const next = nextOf(s);
	const now = after(s);

	const rejected = w.addBill(s, w.addLaw());
	w.vote(s, rejected.id, 'no');
	const noQuorum = w.addBill(s, w.addLaw());
	const passed = w.addBill(s, w.addLaw());
	w.vote(s, passed.id, 'yes');
	const voided = w.addBill(s, w.addLaw());
	w.vote(s, voided.id, 'no');
	const reviewing = w.addBill(s, w.addLaw());
	w.vote(s, reviewing.id, 'no');
	const shared = w.addLaw();
	const winner = w.addBill(s, shared);
	w.vote(s, winner.id, 'yes');
	const adjusting = w.addBill(s, shared);
	w.vote(s, adjusting.id, 'yes');
	const gone = w.addLaw();
	const repeal = w.addBill(s, gone, { action: 'repeal' });
	w.vote(s, repeal.id, 'yes');
	const onRepealed = w.addBill(s, gone);
	w.vote(s, onRepealed.id, 'no');
	await w.settle(s);
	w.review(s, voided.id, 'voided');
	w.review(s, reviewing.id, 'open');

	expect(await w.can(rejected.id, now), '否決').toBe(true);
	expect(await w.can(noQuorum.id, now), '定足数に届かない廃案').toBe(true);
	expect(await w.can(voided.id, now), '無効').toBe(true);
	expect(await w.can(passed.id, now), '可決').toBe(false);
	expect(await w.can(reviewing.id, now), '確認中').toBe(false);
	expect(await w.can(adjusting.id, now), '要調整の期限の前').toBe(false);
	expect(await w.can(adjusting.id, next.deliberationAt + 1), '要調整の期限切れ').toBe(true);
	expect(await w.can(onRepealed.id, now), '対象の法令が廃止された').toBe(false);

	const open = monthOf('2031-05');
	const inProgress = w.addBill(open, w.addLaw());
	expect(await w.can(inProgress.id, open.startsAt + 86_400_000), '発議').toBe(false);
	expect(await w.can(inProgress.id, open.deliberationAt + 1), '質疑').toBe(false);
	expect(await w.can(inProgress.id, open.voteAt + 1), '採決').toBe(false);
	const draft = w.addBill(open, w.addLaw(), { draft: true });
	expect(await w.can(draft.id, after(open)), '下書き').toBe(false);
}, 60_000);

test('基準3：読む版の中身を複製した下書きを作り、賛同は0で、1つの法案からは1本だけ', async () => {
	const w = world();
	const s = monthOf('2030-05');
	const now = after(s);
	const law = w.addLaw();
	const origin = w.addBill(s, law, { text: '発議した本文' });
	w.vote(s, origin.id, 'no');
	// 修正案を取り込んで版が進んだ法案
	w.sqlite.prepare("INSERT INTO bill_laws (bill_id, rev, seq, action, law_id, base_revision_id, base_if_seq) VALUES (?, 2, 0, 'amend', ?, ?, 0)").run(origin.id, law.lawId, law.revisionId);
	w.sqlite.prepare('INSERT INTO bill_solutions (bill_id, rev, seq, solution_id) VALUES (?, 2, 0, 1)').run(origin.id);
	w.sqlite.prepare("INSERT INTO bill_changes (bill_id, rev, law_seq, num, op, provision_id, caption, body) VALUES (?, 2, 0, '1', 'amend', ?, '（見出し）', ?)").run(origin.id, law.ids['1'], para('修正案を取り込んだ本文'));
	w.sqlite.prepare('UPDATE bills SET rev = 2, next_rev = 3 WHERE id = ?').run(origin.id);
	const backer = w.addUser();
	w.sqlite.prepare('INSERT INTO bill_supports (bill_id, rev, user_id, created_at) VALUES (?, 1, ?, 0)').run(origin.id, backer);
	// 質疑、立場、取り込まれた修正案（提案者は共同起草者になる）
	const proposer = w.addUser();
	w.sqlite.prepare("INSERT INTO amendments (bill_id, session_key, user_id, base_rev, law_seq, num, provision_id, body, status, created_at, updated_at) VALUES (?, ?, ?, 1, 0, '1', ?, ?, 'accepted', 0, 0)").run(origin.id, s.key, proposer, law.ids['1'], para('修正案を取り込んだ本文'));
	w.sqlite.prepare("INSERT INTO posts (bill_id, session_key, user_id, kind, body, created_at) VALUES (?, ?, ?, 'question', '質疑', 0)").run(origin.id, s.key, backer);
	w.sqlite.prepare("INSERT INTO stances (session_key, bill_id, user_id, stance, updated_at) VALUES (?, ?, ?, 'for', 0)").run(s.key, origin.id, backer);
	await w.settle(s);
	expect(names(await coDrafters(w.db, origin.id, 0))).toHaveLength(1);
	const before = w.sqlite.prepare('SELECT * FROM bills WHERE id = ?').get(origin.id);
	const issueBefore = w.sqlite.prepare('SELECT * FROM issues WHERE id = 1').get();
	const actor = w.actorOf(origin.author);

	const made = await resubmitBill(w.db, actor, await w.load(origin.id), now);
	expect(made).toMatchObject({ ok: true, created: true });
	const id = (made as { id: number }).id;
	expect(id).not.toBe(origin.id);
	const copy = await w.load(id);
	expect(copy).toMatchObject({ status: 'draft', proposedAt: null, userId: origin.author, title: (await w.load(origin.id)).title, affected: '困っている人', sideEffects: '副作用', summary: '要約', supplementary: '附則', resubmittedFrom: origin.id, solutionIds: [1] });
	expect(copy.laws[0]).toMatchObject({ lawId: law.lawId, baseRevisionId: law.revisionId, baseIfSeq: 0 });
	expect(copy.laws[0].changes[0].paragraphs?.[0].text).toBe('修正案を取り込んだ本文');
	expect((await billSupportState(w.db, id, copy.rev, null)).supports).toBe(0);
	for (const table of ['votes', 'amendments', 'posts', 'stances', 'bill_results']) expect(w.sqlite.prepare(`SELECT count(*) AS n FROM ${table} WHERE bill_id = ?`).get(id), table).toEqual({ n: 0 });
	expect(w.sqlite.prepare('SELECT * FROM bills WHERE id = ?').get(origin.id)).toEqual(before);
	expect(w.sqlite.prepare('SELECT * FROM issues WHERE id = 1').get()).toEqual(issueBefore);
	const drafts = () => (w.sqlite.prepare("SELECT count(*) AS n FROM actions WHERE kind = 'bill_draft' AND user_id = ?").get(origin.author) as { n: number }).n;
	expect(drafts()).toBe(1);

	// すでに出し直した法案があれば作らず、数えない（発議のあとも）
	expect(await resubmitBill(w.db, actor, await w.load(origin.id), now)).toEqual({ ok: true, id, created: false });
	const next = nextOf(s);
	w.sqlite.prepare('UPDATE bills SET status = ?, proposed_at = ?, proposed_rev = rev WHERE id = ?').run('proposed', next.startsAt + 1, id);
	expect(await resubmitBill(w.db, actor, await w.load(origin.id), next.startsAt + 2)).toEqual({ ok: true, id, created: false });
	expect(drafts()).toBe(1);
	expect((await resubmitStateOf(w.db, await w.load(origin.id), 'rejected')).next).toMatchObject({ id });

	// 同時に押したとき：2つの作りかけを順に確定すると2つ目は確定せず、作りかけの行は探す条件に当たらない
	const race = w.addBill(s, w.addLaw());
	const input = draftInputOf(await w.load(race.id));
	const first = await createUnconfirmedDraft(w.db, race.author, input, now);
	const second = await createUnconfirmedDraft(w.db, race.author, input, now);
	expect((await resubmitStateOf(w.db, await w.load(race.id), 'lapsed')).next).toBeNull();
	expect(await confirmResubmit(w.db, first, race.id, now)).toBe(true);
	expect(await confirmResubmit(w.db, second, race.id, now)).toBe(false);
	expect(await billById(w.db, second)).toBeUndefined();
	expect((await resubmitStateOf(w.db, await w.load(race.id), 'lapsed')).next).toMatchObject({ id: first });

	// 出し直した法案がまた廃案になると、その法案から出し直せる
	const nextNow = after(next);
	await w.settle(next);
	expect(await w.can(id, nextNow)).toBe(true);
	expect(names(await coDrafters(w.db, id, 0)), '共同起草者は引き継がない').toEqual([]);
	const again = await resubmitBill(w.db, actor, await w.load(id), nextNow);
	expect(again).toMatchObject({ ok: true, created: true });
	expect((await w.load((again as { id: number }).id)).resubmittedFrom).toBe(id);

	// アカウントの上限を超えると作らず、違反に数える
	const busy = w.addBill(s, w.addLaw());
	const busyActor = w.actorOf(busy.author);
	for (let i = 0; i < LIMITS.billDraftPerAccount; i++) w.sqlite.prepare("INSERT INTO actions (kind, user_id, ip_hash, created_at) VALUES ('bill_draft', ?, 'x', ?)").run(busy.author, now - 1000);
	const bills = () => (w.sqlite.prepare('SELECT count(*) AS n FROM bills').get() as { n: number }).n;
	const total = bills();
	expect(await resubmitBill(w.db, busyActor, await w.load(busy.id), now)).toMatchObject({ ok: false, refusal: { kind: 'bill-draft-account' } });
	expect(bills()).toBe(total);
	expect(w.sqlite.prepare("SELECT count(*) AS n FROM actions WHERE kind = 'violation' AND user_id = ?").get(busy.author)).toEqual({ n: 1 });
}, 60_000);

test('基準5：基にしたあとで条文が変わった法案を出し直すと、基にした版は元のままで、確かめるまで発議を断られる', async () => {
	const w = world();
	const s = monthOf('2030-05');
	const law = w.addLaw();
	const origin = w.addBill(s, law);
	w.vote(s, origin.id, 'no');
	const other = w.addBill(s, law, { text: 'ほかの法案が変えた本文' });
	w.vote(s, other.id, 'yes');
	await w.settle(s);

	const made = await resubmitBill(w.db, w.actorOf(origin.author), await w.load(origin.id), after(s));
	const copy = await w.load((made as { id: number }).id);
	expect(copy.laws[0].baseIfSeq).toBe(0);
	const content = { ...copy.laws[0] };
	expect(await staleArticles(w.db, content)).toMatchObject([{ num: '1', body: 'ほかの法案が変えた本文' }]);
	expect(await proposeBlock(w.db, copy)).toBe('stale');
}, 60_000);
