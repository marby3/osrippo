// Issue #72 基準1〜3・7 の DB の側（設計書 docs/spec/72.md）
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { beforeAll, describe, expect, test, vi } from 'vitest';
import { openMemoryDb, type MemoryDb } from './memory';
import { sessionAt, type Session } from '../domain/session';
import { articlesOfRevision } from '../server/law';
import { billById, supportRev } from '../server/bills';
import { ifArticles, ifHeadOf, ifLawPage, proposeBlock, saveAdjustedBill, staleArticles } from '../server/if-world';
import { settleSession } from '../server/results';

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
function addUser() {
	const id = `f${unique()}`;
	sqlite.prepare('INSERT INTO user (id, name, email, created_at, updated_at) VALUES (?, ?, ?, 0, 0)').run(id, id, `${id}@test.invalid`);
	return id;
}
function voter() {
	const id = addUser();
	sqlite.prepare("INSERT INTO actions (kind, user_id, ip_hash, created_at) VALUES ('issue_post', ?, 'x', 0)").run(id);
	return id;
}

/** 現実の法令。条は3つ（第1条〜第3条）。内部ID を返す */
function addLaw() {
	const n = unique();
	const lawId = `L${n}`;
	const revisionId = `R${n}`;
	sqlite.prepare("INSERT INTO laws (id, title, law_num) VALUES (?, ?, '番号')").run(lawId, `法令${n}`);
	sqlite.prepare("INSERT INTO law_revisions (id, law_id, branch, seq, enforcement_date, status) VALUES (?, ?, 'real', 0, '2020-01-01', 'enforced')").run(revisionId, lawId);
	const ids: Record<string, number> = {};
	for (const num of ['1', '2', '3']) {
		const article = Number(sqlite.prepare("INSERT INTO provisions (law_id, kind) VALUES (?, 'article')").run(lawId).lastInsertRowid);
		sqlite.prepare("INSERT INTO provision_versions (provision_id, from_revision_id, num, caption, change) VALUES (?, ?, ?, '（見出し）', 'baseline')").run(article, revisionId, num);
		const paragraph = Number(sqlite.prepare("INSERT INTO provisions (law_id, kind, parent_id) VALUES (?, 'paragraph', ?)").run(lawId, article).lastInsertRowid);
		sqlite.prepare("INSERT INTO provision_versions (provision_id, from_revision_id, num, text, change) VALUES (?, ?, '1', ?, 'baseline')").run(paragraph, revisionId, `第${num}条のもとの本文`);
		ids[num] = article;
	}
	return { lawId, revisionId, ids };
}

type Change = { num: string; op: 'amend' | 'add' | 'delete'; provisionId?: number | null; text?: string };
/** 発議した法案。proposedDay はその会期の中の順（早い順に反映する） */
function addBill(s: Session, law: ReturnType<typeof addLaw> | null, changes: Change[], opts: { action?: 'amend' | 'repeal' | 'enact'; baseIfSeq?: number; order?: number; newTitle?: string } = {}) {
	const action = opts.action ?? 'amend';
	const author = addUser();
	const id = Number(
		sqlite
			.prepare("INSERT INTO bills (user_id, committee_id, kind, status, rev, next_rev, proposed_rev, title, affected, side_effects, created_at, updated_at, proposed_at) VALUES (?, 1, ?, 'proposed', 1, 2, 1, ?, 'a', 's', 0, 0, ?)")
			.run(author, action, `法案${unique()}`, s.startsAt + (opts.order ?? unique())).lastInsertRowid
	);
	sqlite
		.prepare('INSERT INTO bill_laws (bill_id, rev, seq, action, law_id, base_revision_id, new_title, base_if_seq) VALUES (?, 1, 0, ?, ?, ?, ?, ?)')
		.run(id, action, action === 'enact' ? null : (law as NonNullable<typeof law>).lawId, action === 'enact' ? null : (law as NonNullable<typeof law>).revisionId, action === 'enact' ? (opts.newTitle ?? `新法${unique()}`) : null, opts.baseIfSeq ?? 0);
	sqlite.prepare('INSERT INTO bill_solutions (bill_id, rev, seq, solution_id) VALUES (?, 1, 0, 1)').run(id);
	for (const c of changes) {
		sqlite
			.prepare("INSERT INTO bill_changes (bill_id, rev, law_seq, num, op, provision_id, caption, body) VALUES (?, 1, 0, ?, ?, ?, '（見出し）', ?)")
			.run(id, c.num, c.op, c.op === 'add' ? null : (c.provisionId ?? null), c.op === 'delete' ? null : para(c.text ?? '本文'));
	}
	return { id, author };
}
function votes(s: Session, bill: number, choice: 'yes' | 'no', n = 10) {
	for (let i = 0; i < n; i++) sqlite.prepare('INSERT INTO votes (session_key, bill_id, user_id, choice, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 0)').run(s.key, bill, voter(), choice);
}
const fix = (s: Session) => sqlite.prepare('INSERT INTO session_participants (committee_id, session_key, active_count, fixed_at) VALUES (1, ?, 0, 0)').run(s.key);
const settle = (s: Session, at = after(s)) => settleSession(db, s, previousOf(s), at, null);
const head = (law: { lawId: string }) => ifHeadOf(db, law.lawId);
const latest = async (law: { lawId: string }) => {
	const h = await head(law);
	return ifArticles(db, law.lawId, h.branchRevisionId as string, h.seq);
};
const bodyOf = async (law: { lawId: string }, num: string) => (await latest(law)).find((a) => a.num === num)?.paragraphs[0].text;
const adjustment = (bill: number, s: Session) => {
	const row = sqlite.prepare('SELECT * FROM bill_adjustments WHERE bill_id = ? AND session_key = ?').get(bill, s.key);
	return row ? { ...row } : undefined;
};
const revisionsOf = (bill: number) => (sqlite.prepare('SELECT count(*) AS n FROM if_revisions WHERE bill_id = ?').get(bill) as { n: number }).n;

beforeAll(() => {
	({ sqlite, db } = openMemoryDb());
	sqlite.exec("INSERT INTO user (id, name, email, created_at, updated_at) VALUES ('issuer', 'i', 'i@test.invalid', 0, 0); INSERT INTO issues (id, user_id, title, affected, example, topic_id, created_at) VALUES (1, 'issuer', '課題', '人', '例', NULL, 0); INSERT INTO solutions (id, issue_id, user_id, body, created_at) VALUES (1, 1, 'issuer', '解決策', 0);");
});

test('基準1：0016 で表と列が増え、既存の行は残り、既存の法案の基にした版は分岐した版のまま', () => {
	const old = new DatabaseSync(':memory:');
	old.exec('PRAGMA foreign_keys = ON');
	const dir = new URL('../../../drizzle/', import.meta.url);
	const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
	for (const f of files.filter((f) => f < '0016')) old.exec(readFileSync(new URL(f, dir), 'utf8'));
	old.exec("INSERT INTO user (id, name, email, created_at, updated_at) VALUES ('u', 'u', 'u@test.invalid', 0, 0)");
	old.exec("INSERT INTO laws (id, title, law_num) VALUES ('L', 'T', 'N'); INSERT INTO law_revisions (id, law_id, branch, seq, enforcement_date, status) VALUES ('R', 'L', 'real', 0, '2020-01-01', 'enforced')");
	old.exec("INSERT INTO bills (id, user_id, committee_id, kind, rev, next_rev, title, affected, side_effects, created_at, updated_at) VALUES (1, 'u', 1, 'amend', 1, 2, 't', 'a', 's', 0, 0)");
	old.exec("INSERT INTO bill_laws (bill_id, rev, seq, action, law_id, base_revision_id) VALUES (1, 1, 0, 'amend', 'L', 'R')");

	const later = files.filter((f) => f >= '0016');
	expect(later.length).toBeGreaterThan(0);
	for (const f of later) old.exec(readFileSync(new URL(f, dir), 'utf8'));

	expect(old.prepare('SELECT base_revision_id, base_if_seq FROM bill_laws').all().map((r) => ({ ...r }))).toEqual([{ base_revision_id: 'R', base_if_seq: 0 }]);
	const names = (old.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name);
	expect(names).toEqual(expect.arrayContaining(['if_branches', 'if_revisions', 'if_added_articles', 'if_laws', 'bill_adjustments']));
	expect(() => old.exec("INSERT INTO bill_adjustments (bill_id, session_key, reason, due_at, proposed_at, created_at) VALUES (1, 's', 'nope', 0, 0, 0)")).toThrow();
});

describe('基準2：可決すると IF世界の版ができる', () => {
	test('書きかえ・足す・削除が重なり、現実の条文は変わらない。否決と廃案では版ができない。何度走っても同じ', async () => {
		const s = monthOf('2201-05');
		fix(s);
		const law = addLaw();
		const before = await articlesOfRevision(db, law.revisionId);
		const passed = addBill(s, law, [
			{ num: '1', op: 'amend', provisionId: law.ids['1'], text: '書きかえた本文' },
			{ num: '2', op: 'delete', provisionId: law.ids['2'] },
			{ num: '3_2', op: 'add', text: '足した本文' }
		]);
		votes(s, passed.id, 'yes');
		const rejected = addBill(s, law, [{ num: '3', op: 'amend', provisionId: law.ids['3'], text: '否決された本文' }]);
		votes(s, rejected.id, 'no');
		const lapsed = addBill(s, law, [{ num: '3', op: 'amend', provisionId: law.ids['3'], text: '廃案の本文' }]);
		votes(s, lapsed.id, 'yes', 9);

		await settle(s);
		expect((await head(law)).seq).toBe(1);
		expect(revisionsOf(rejected.id) + revisionsOf(lapsed.id)).toBe(0);
		const articles = await latest(law);
		expect(articles.map((a) => a.num)).toEqual(['1', '2', '3', '3_2']);
		expect(await bodyOf(law, '1')).toBe('書きかえた本文');
		expect(await bodyOf(law, '3')).toBe('第3条のもとの本文');
		expect(await bodyOf(law, '3_2')).toBe('足した本文');
		// 削除は番号を残し、本文を「削除」にして見出しを空にする
		expect(articles.find((a) => a.num === '2')).toMatchObject({ caption: '', paragraphs: [{ num: '1', text: '削除', items: [] }] });
		// 足した条にも内部IDがあり、以後の法案が指せる
		expect(articles.find((a) => a.num === '3_2')?.id).toBeGreaterThan(0);
		// どの法案が変えたか
		expect(articles.find((a) => a.num === '1')?.changedBy?.id).toBe(passed.id);
		expect(articles.find((a) => a.num === '3')?.changedBy).toBeNull();
		// 現実の条文は変わらない
		expect(await articlesOfRevision(db, law.revisionId)).toEqual(before);

		await settle(s, after(s) + MINUTE);
		expect((await head(law)).seq).toBe(1);
		expect(revisionsOf(passed.id)).toBe(1);
		expect(sqlite.prepare('SELECT count(*) AS n FROM if_added_articles WHERE law_id = ?').get(law.lawId)).toEqual({ n: 1 });
	});

	test('廃止と制定。廃止された法令は廃止と読める。制定の新法は読める', async () => {
		const s = monthOf('2202-05');
		fix(s);
		const law = addLaw();
		const repeal = addBill(s, law, [], { action: 'repeal' });
		votes(s, repeal.id, 'yes');
		const enact = addBill(s, null, [{ num: '1', op: 'add', text: '新法の本文' }], { action: 'enact', newTitle: '新しい法律 2202' });
		votes(s, enact.id, 'yes');
		await settle(s);
		expect((await head(law)).repealed).toBe(true);
		expect(await ifLawPage(db, law.lawId)).toMatchObject({ repealed: true, repealedBy: { id: repeal.id } });
		const page = await ifLawPage(db, `if-${enact.id}`);
		expect(page).toMatchObject({ law: { id: `if-${enact.id}`, title: '新しい法律 2202' }, repealed: false, enactedBy: { id: enact.id } });
		expect(page?.articles.map((a) => a.paragraphs[0].text)).toEqual(['新法の本文']);
		expect(await ifLawPage(db, 'if-999999')).toBeUndefined();
		expect(await ifLawPage(db, 'nope')).toBeUndefined();
	});
});

describe('基準3：衝突', () => {
	test('同じ会期の同じ条は発議の早い順で、後は要調整。別の条は両方反映する。期限はいまより後の最初の発議締切', async () => {
		const s = monthOf('2203-05');
		fix(s);
		const law = addLaw();
		const first = addBill(s, law, [{ num: '1', op: 'amend', provisionId: law.ids['1'], text: '先の本文' }], { order: 1 });
		const second = addBill(s, law, [{ num: '1', op: 'amend', provisionId: law.ids['1'], text: '後の本文' }], { order: 2 });
		const other = addBill(s, law, [{ num: '2', op: 'amend', provisionId: law.ids['2'], text: '別の条の本文' }], { order: 3 });
		const addA = addBill(s, law, [{ num: '3_2', op: 'add', text: '足すA' }], { order: 4 });
		const addB = addBill(s, law, [{ num: '3_2', op: 'add', text: '足すB' }], { order: 5 });
		for (const b of [first, second, other, addA, addB]) votes(s, b.id, 'yes');
		await settle(s);
		expect(await bodyOf(law, '1')).toBe('先の本文');
		expect(await bodyOf(law, '2')).toBe('別の条の本文');
		expect(await bodyOf(law, '3_2')).toBe('足すA');
		expect(adjustment(first.id, s)).toBeUndefined();
		const next = nextOf(s);
		expect(adjustment(second.id, s)).toMatchObject({ reason: 'article', due_at: next.deliberationAt, resolved_at: null, proposed_at: s.startsAt + 2 });
		expect(adjustment(addB.id, s)).toMatchObject({ reason: 'article' });
		expect(revisionsOf(second.id)).toBe(0);

		// 確定が遅れて次の会期の発議締切を過ぎていたら、そのあとの締切
		const late = monthOf('2204-05');
		fix(late);
		const lateLaw = addLaw();
		const a = addBill(late, lateLaw, [{ num: '1', op: 'amend', provisionId: lateLaw.ids['1'], text: 'A' }], { order: 1 });
		const b = addBill(late, lateLaw, [{ num: '1', op: 'amend', provisionId: lateLaw.ids['1'], text: 'B' }], { order: 2 });
		votes(late, a.id, 'yes');
		votes(late, b.id, 'yes');
		const lateNow = nextOf(late).deliberationAt + MINUTE;
		await settle(late, lateNow);
		expect(adjustment(b.id, late)).toMatchObject({ due_at: nextOf(nextOf(late)).deliberationAt });
	});

	test('基にした版より後の変更との衝突、廃止、制定の法令名。基にした版より前の変更とは衝突しない', async () => {
		const s = monthOf('2205-05');
		fix(s);
		const law = addLaw();
		const first = addBill(s, law, [{ num: '1', op: 'amend', provisionId: law.ids['1'], text: '前の会期の本文' }], { order: 1 });
		votes(s, first.id, 'yes');
		const enactFirst = addBill(s, null, [{ num: '1', op: 'add', text: '本文' }], { action: 'enact', newTitle: '同じ名前の法律', order: 2 });
		votes(s, enactFirst.id, 'yes');
		await settle(s);

		const n = nextOf(s);
		fix(n);
		// 前の会期に書いた下書き（基にした版は 0）が同じ条を変える
		const stale = addBill(n, law, [{ num: '1', op: 'amend', provisionId: law.ids['1'], text: '古い下書き' }], { baseIfSeq: 0, order: 1 });
		// 最新を基に同じ条を変える法案は衝突しない
		const fresh = addBill(n, law, [{ num: '1', op: 'amend', provisionId: law.ids['1'], text: '新しい本文' }], { baseIfSeq: 1, order: 2 });
		const title = addBill(n, null, [{ num: '1', op: 'add', text: '本文' }], { action: 'enact', newTitle: '同じ名前の法律', order: 3 });
		for (const b of [stale, fresh, title]) votes(n, b.id, 'yes');
		await settle(n);
		expect(adjustment(stale.id, n)).toMatchObject({ reason: 'article' });
		expect(adjustment(fresh.id, n)).toBeUndefined();
		expect(adjustment(title.id, n)).toMatchObject({ reason: 'title' });
		expect(await bodyOf(law, '1')).toBe('新しい本文');

		// 廃止：基にした版より後の変更があれば衝突。廃止のあとの変更は repealed を優先する
		const n2 = nextOf(n);
		fix(n2);
		const repealStale = addBill(n2, law, [], { action: 'repeal', baseIfSeq: 1, order: 1 });
		const repealOk = addBill(n2, law, [], { action: 'repeal', baseIfSeq: 2, order: 2 });
		const afterRepeal = addBill(n2, law, [{ num: '1', op: 'amend', provisionId: law.ids['1'], text: '廃止のあと' }], { baseIfSeq: 1, order: 3 });
		for (const b of [repealStale, repealOk, afterRepeal]) votes(n2, b.id, 'yes');
		await settle(n2);
		expect(adjustment(repealStale.id, n2)).toMatchObject({ reason: 'article' });
		expect((await head(law)).repealed).toBe(true);
		expect(adjustment(afterRepeal.id, n2)).toMatchObject({ reason: 'repealed' });
	});

	test('すべての結果が入るまで反映しない。1本が失敗すると後の法案を先に反映しない', async () => {
		const s = monthOf('2206-05');
		fix(s);
		const law = addLaw();
		const passed = addBill(s, law, [{ num: '1', op: 'amend', provisionId: law.ids['1'], text: '可決の本文' }], { order: 1 });
		votes(s, passed.id, 'yes');
		const broken = addBill(s, law, [{ num: '2', op: 'amend', provisionId: law.ids['2'], text: '壊れた法案' }], { order: 2 });
		votes(s, broken.id, 'yes');
		const amendment = Number(
			sqlite.prepare("INSERT INTO amendments (bill_id, session_key, base_rev, law_seq, num, user_id, body, revision, status, created_at, updated_at) VALUES (?, ?, 1, 0, '2', 'issuer', 'こわれた本文', 1, 'open', 0, 0)").run(broken.id, s.key).lastInsertRowid
		);
		await expect(settle(s)).rejects.toThrow();
		expect(revisionsOf(passed.id)).toBe(0);
		// 直るとやり直せる
		sqlite.prepare('UPDATE amendments SET body = ? WHERE id = ?').run(para('直した本文'), amendment);
		await settle(s, after(s) + MINUTE);
		expect(revisionsOf(passed.id)).toBe(1);
		expect(revisionsOf(broken.id)).toBe(1);

		// 反映の途中で失敗したら止める：先の法案の足す条の番号が不正で失敗すると、後の法案を先に反映しない
		const s2 = monthOf('2207-05');
		fix(s2);
		const law2 = addLaw();
		const a = addBill(s2, law2, [{ num: '1', op: 'amend', provisionId: law2.ids['1'], text: 'A' }], { order: 1 });
		const b = addBill(s2, law2, [{ num: '2', op: 'amend', provisionId: law2.ids['2'], text: 'B' }], { order: 2 });
		votes(s2, a.id, 'yes');
		votes(s2, b.id, 'yes');
		const log = vi.spyOn(console, 'error').mockImplementation(() => {});
		sqlite.exec(`CREATE TRIGGER fail_first BEFORE INSERT ON if_revisions WHEN NEW.bill_id = ${a.id} BEGIN SELECT RAISE(ABORT, 'だめ'); END;`);
		await expect(settle(s2)).rejects.toThrow();
		expect(revisionsOf(b.id)).toBe(0);
		sqlite.exec('DROP TRIGGER fail_first');
		log.mockRestore();
		await settle(s2, after(s2) + MINUTE);
		expect(revisionsOf(a.id) + revisionsOf(b.id)).toBe(2);
	});

	test('同時に走っても、反映済みの法案が自分自身と衝突しない', async () => {
		const s = monthOf('2208-05');
		fix(s);
		const law = addLaw();
		const a = addBill(s, law, [{ num: '1', op: 'amend', provisionId: law.ids['1'], text: 'A' }], { order: 1 });
		const b = addBill(s, law, [{ num: '1', op: 'amend', provisionId: law.ids['1'], text: 'B' }], { order: 2 });
		votes(s, a.id, 'yes');
		votes(s, b.id, 'yes');
		await Promise.all([settle(s), settle(s)]);
		expect(revisionsOf(a.id)).toBe(1);
		expect(adjustment(a.id, s)).toBeUndefined();
		expect(adjustment(b.id, s)).toMatchObject({ reason: 'article' });
		expect((await head(law)).seq).toBe(1);
	});
});

describe('基準7：要調整を直す', () => {
	const actor = (userId: string) => ({ userId, registeredAt: 0, ipHash: `ip-${userId}` });
	const input = (bill: NonNullable<Awaited<ReturnType<typeof billById>>>, baseIfSeq: number, text: string, affected = '直した困りごと') => ({
		kind: bill.kind,
		committeeId: 1,
		title: bill.title,
		affected,
		sideEffects: bill.sideEffects,
		summary: null,
		supplementary: null,
		laws: bill.laws.map((l) => ({ action: l.action, lawId: l.lawId, baseRevisionId: l.baseRevisionId, baseIfSeq, newTitle: l.newTitle, changes: l.changes.map((c) => ({ ...c, paragraphs: [{ num: '1', text, items: [] }] })) })),
		solutionIds: [1]
	});

	test('直すと次の会期に付託され、本文が保存され、賛同は修正案が当たった法案でも保たれる。次の会期に可決すると反映され、前の会期の修正案と同じ条でも負けない', async () => {
		const s = monthOf('2209-05');
		fix(s);
		const law = addLaw();
		const first = addBill(s, law, [{ num: '1', op: 'amend', provisionId: law.ids['1'], text: '先の本文' }], { order: 1 });
		const second = addBill(s, law, [{ num: '1', op: 'amend', provisionId: law.ids['1'], text: '後の本文' }], { order: 2 });
		votes(s, first.id, 'yes');
		votes(s, second.id, 'yes');
		// 賛同は発議した版の行。修正案が当たって rev が進む
		const backer = addUser();
		sqlite.prepare('INSERT INTO bill_supports (bill_id, rev, user_id, created_at) VALUES (?, 1, ?, 0)').run(second.id, backer);
		const amendment = Number(
			sqlite.prepare("INSERT INTO amendments (bill_id, session_key, base_rev, law_seq, num, user_id, body, revision, status, created_at, updated_at) VALUES (?, ?, 1, 0, '2', 'issuer', ?, 1, 'open', 0, 0)").run(second.id, s.key, para('前の会期の修正案')).lastInsertRowid
		);
		for (const u of [addUser(), addUser()]) sqlite.prepare('INSERT INTO amendment_supports (amendment_id, revision, user_id, created_at) VALUES (?, 1, ?, 0)').run(amendment, u);
		const amendmentVoters = sqlite.prepare('SELECT user_id FROM votes WHERE bill_id = ?').all(second.id) as { user_id: string }[];
		for (const v of amendmentVoters) sqlite.prepare("INSERT INTO amendment_votes (session_key, amendment_id, user_id, choice, created_at, updated_at) VALUES (?, ?, ?, 'yes', 0, 0)").run(s.key, amendment, v.user_id);
		await settle(s);
		const loaded = await billById(db, second.id);
		if (!loaded) throw new Error('法案がない');
		expect(loaded.rev).toBe(2);
		expect(adjustment(second.id, s)).toMatchObject({ reason: 'article' });

		const next = nextOf(s);
		const at = next.startsAt + MINUTE;
		const h = await head(law);

		// ほかの人と期限のあとは直せない
		expect(await saveAdjustedBill(db, actor(addUser()), loaded, 2, input(loaded, h.seq, '乗っ取り'), at)).toEqual({ ok: true, saved: false });
		expect(await saveAdjustedBill(db, actor(second.author), loaded, 2, input(loaded, h.seq, '遅い'), next.deliberationAt)).toEqual({ ok: true, saved: false });
		expect(adjustment(second.id, s)).toMatchObject({ resolved_at: null });

		expect(await saveAdjustedBill(db, actor(second.author), loaded, 2, input(loaded, h.seq, '直した本文'), at)).toEqual({ ok: true, saved: true });
		const fixed = await billById(db, second.id);
		if (!fixed) throw new Error('法案がない');
		expect(fixed.proposedAt).toBe(at);
		expect(fixed.proposedRev).toBe(fixed.rev);
		expect(fixed.affected).toBe('直した困りごと');
		expect(fixed.laws[0].baseIfSeq).toBe(h.seq);
		expect(adjustment(second.id, s)).toMatchObject({ resolved_at: at, proposed_at: s.startsAt + 2 });
		// 賛同は発議した版（1）の行から写す
		expect(sqlite.prepare('SELECT count(*) AS n FROM bill_supports WHERE bill_id = ? AND rev = ?').get(second.id, supportRev(fixed))).toEqual({ n: 1 });

		// 次の会期に可決すると反映される
		fix(next);
		const amendment2 = Number(
			sqlite.prepare("INSERT INTO amendments (bill_id, session_key, base_rev, law_seq, num, user_id, body, revision, status, created_at, updated_at) VALUES (?, ?, ?, 0, '2', 'issuer', ?, 1, 'open', 0, 0)").run(second.id, next.key, fixed.rev, para('次の会期の修正案')).lastInsertRowid
		);
		for (const u of [addUser(), addUser()]) sqlite.prepare('INSERT INTO amendment_supports (amendment_id, revision, user_id, created_at) VALUES (?, 1, ?, 0)').run(amendment2, u);
		votes(next, second.id, 'yes');
		const nextVoters = sqlite.prepare('SELECT user_id FROM votes WHERE bill_id = ? AND session_key = ?').all(second.id, next.key) as { user_id: string }[];
		for (const v of nextVoters) sqlite.prepare("INSERT INTO amendment_votes (session_key, amendment_id, user_id, choice, created_at, updated_at) VALUES (?, ?, ?, 'yes', 0, 0)").run(next.key, amendment2, v.user_id);
		await settle(next);
		expect(sqlite.prepare('SELECT status FROM amendments WHERE id = ?').get(amendment2)).toEqual({ status: 'passed' });
		expect(adjustment(second.id, next)).toBeUndefined();
		expect(await bodyOf(law, '1')).toBe('直した本文');
		expect(await bodyOf(law, '2')).toBe('次の会期の修正案');
	});

	test('法令の廃止で衝突した法案は直せない。題名と対象の法令は変えられない。法令名の重なりは法令名だけ直せる', async () => {
		const s = monthOf('2213-05');
		fix(s);
		const law = addLaw();
		const repeal = addBill(s, law, [], { action: 'repeal', order: 1 });
		const after_ = addBill(s, law, [{ num: '1', op: 'amend', provisionId: law.ids['1'], text: '本文' }], { order: 2 });
		const enactA = addBill(s, null, [{ num: '1', op: 'add', text: '本文' }], { action: 'enact', newTitle: '重なる法律', order: 3 });
		const enactB = addBill(s, null, [{ num: '1', op: 'add', text: '本文' }], { action: 'enact', newTitle: '重なる法律', order: 4 });
		const other = addLaw();
		const conflicted = addBill(s, other, [{ num: '1', op: 'amend', provisionId: other.ids['1'], text: 'A' }], { order: 5 });
		const conflicted2 = addBill(s, other, [{ num: '1', op: 'amend', provisionId: other.ids['1'], text: 'B' }], { order: 6 });
		for (const b of [repeal, after_, enactA, enactB, conflicted, conflicted2]) votes(s, b.id, 'yes');
		await settle(s);
		const at = nextOf(s).startsAt + MINUTE;

		const repealed = await billById(db, after_.id);
		if (!repealed) throw new Error('法案がない');
		expect(await saveAdjustedBill(db, actor(after_.author), repealed, 1, input(repealed, 1, '直す'), at)).toEqual({ ok: true, saved: false });

		const named = await billById(db, enactB.id);
		if (!named) throw new Error('法案がない');
		const renamed = input(named, 0, '本文');
		renamed.laws[0].newTitle = '別の名前の法律';
		expect(await saveAdjustedBill(db, actor(enactB.author), named, 1, renamed, at)).toEqual({ ok: true, saved: true });

		const c = await billById(db, conflicted2.id);
		if (!c) throw new Error('法案がない');
		const h = await head(other);
		const retitled = { ...input(c, h.seq, '直す'), title: '別の題名' };
		expect(await saveAdjustedBill(db, actor(conflicted2.author), c, 1, retitled, at)).toEqual({ ok: false, reason: 'locked' });
		const moved = input(c, h.seq, '直す');
		moved.laws[0].lawId = law.lawId;
		expect(await saveAdjustedBill(db, actor(conflicted2.author), c, 1, moved, at)).toEqual({ ok: false, reason: 'locked' });
	});
});

test('基準5・8：基にしたあとで変わった条と、発議の確かめ', async () => {
	const s = monthOf('2216-05');
	fix(s);
	const law = addLaw();
	const passed = addBill(s, law, [{ num: '1', op: 'amend', provisionId: law.ids['1'], text: '変わった本文' }], { order: 1 });
	votes(s, passed.id, 'yes');
	const enact = addBill(s, null, [{ num: '1', op: 'add', text: '本文' }], { action: 'enact', newTitle: '使われた名前', order: 2 });
	votes(s, enact.id, 'yes');
	await settle(s);

	const lawOf = (changes: { num: string; provisionId: number | null; op: 'amend' | 'add' }[], action: 'amend' | 'repeal' = 'amend', baseIfSeq = 0) => ({ action, lawId: law.lawId, baseRevisionId: law.revisionId, baseIfSeq, newTitle: null, changes: changes.map((c) => ({ ...c, caption: null, paragraphs: [] })) });
	// 変わった条に触れる：いまの条文を返す
	expect(await staleArticles(db, lawOf([{ num: '1', provisionId: law.ids['1'], op: 'amend' }]))).toMatchObject([{ num: '1', body: expect.stringContaining('変わった本文') }]);
	// 別の条に触れるだけなら空
	expect(await staleArticles(db, lawOf([{ num: '2', provisionId: law.ids['2'], op: 'amend' }]))).toEqual([]);
	// 最新を基にしていれば空
	expect(await staleArticles(db, lawOf([{ num: '1', provisionId: law.ids['1'], op: 'amend' }], 'amend', 1))).toEqual([]);
	// 廃止は変わった条すべて
	expect(await staleArticles(db, lawOf([], 'repeal'))).toMatchObject([{ num: '1' }]);

	expect(await proposeBlock(db, { laws: [lawOf([{ num: '1', provisionId: law.ids['1'], op: 'amend' }])] })).toBe('stale');
	expect(await proposeBlock(db, { laws: [lawOf([{ num: '2', provisionId: law.ids['2'], op: 'amend' }])] })).toBeNull();
	expect(await proposeBlock(db, { laws: [{ action: 'enact', lawId: null, baseRevisionId: null, baseIfSeq: 0, newTitle: '使われた名前', changes: [] }] })).toBe('title');
	expect(await proposeBlock(db, { laws: [{ action: 'enact', lawId: null, baseRevisionId: null, baseIfSeq: 0, newTitle: '空いている名前', changes: [] }] })).toBeNull();

	const n = nextOf(s);
	fix(n);
	const repeal = addBill(n, law, [], { action: 'repeal', baseIfSeq: 1 });
	votes(n, repeal.id, 'yes');
	await settle(n);
	expect(await proposeBlock(db, { laws: [lawOf([{ num: '2', provisionId: law.ids['2'], op: 'amend' }], 'amend', 2)] })).toBe('repealed');
});
