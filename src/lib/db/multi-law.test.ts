// Issue #53 基準4・7・8・9 の DB の側（設計書 docs/spec/53.md 決めたこと5・8〜11）。画面は e2e/houan-fukusu.spec.ts
import type { DatabaseSync } from 'node:sqlite';
import { beforeAll, expect, test } from 'vitest';
import { openMemoryDb, type MemoryDb } from './memory';
import { sessionAt, type Session } from '../domain/session';
import { billById } from '../server/bills';
import * as ifWorld from '../server/if-world';
import { hiddenAmendmentsFor, reportedAmendments } from '../server/amendment-moderation';
import { settleAmendments } from '../server/amendments';
import { resubmitStateOf } from '../server/resubmit';
import { checkBillForm, type BillFormValues } from '../server/bill-form';
import { ja } from '../copy/ja';
import { priorAmendmentResults, settleSession } from '../server/results';

let sqlite: DatabaseSync;
let db: MemoryDb;
const jst = (s: string) => Date.parse(`${s}+09:00`);
const monthOf = (key: string) => sessionAt(jst(`${key}-10T00:00:00`), null);
const previousOf = (s: Session) => sessionAt(s.startsAt - 1, null);
const nextOf = (s: Session) => sessionAt(s.endsAt, null);
const MINUTE = 60_000;
const para = (text: string) => JSON.stringify([{ num: '1', text, items: [] }]);

let counter = 0;
const unique = () => ++counter;
function addUser() {
	const id = `m${unique()}`;
	sqlite.prepare('INSERT INTO user (id, name, email, created_at, updated_at) VALUES (?, ?, ?, 0, 0)').run(id, id, `${id}@test.invalid`);
	return id;
}
function voter() {
	const id = addUser();
	sqlite.prepare("INSERT INTO actions (kind, user_id, ip_hash, created_at) VALUES ('issue_post', ?, 'x', 0)").run(id);
	return id;
}

type Law = { lawId: string; revisionId: string; title: string; ids: Record<string, number> };
/** 現実の法令。条は3つ（第1条〜第3条） */
function addLaw(): Law {
	const n = unique();
	const lawId = `ML${n}`;
	const revisionId = `MR${n}`;
	const title = `法令${n}`;
	sqlite.prepare("INSERT INTO laws (id, title, law_num) VALUES (?, ?, '番号')").run(lawId, title);
	sqlite.prepare("INSERT INTO law_revisions (id, law_id, branch, seq, enforcement_date, status) VALUES (?, ?, 'real', 0, '2020-01-01', 'enforced')").run(revisionId, lawId);
	const ids: Record<string, number> = {};
	for (const num of ['1', '2', '3']) {
		const article = Number(sqlite.prepare("INSERT INTO provisions (law_id, kind) VALUES (?, 'article')").run(lawId).lastInsertRowid);
		sqlite.prepare("INSERT INTO provision_versions (provision_id, from_revision_id, num, caption, change) VALUES (?, ?, ?, '（見出し）', 'baseline')").run(article, revisionId, num);
		const paragraph = Number(sqlite.prepare("INSERT INTO provisions (law_id, kind, parent_id) VALUES (?, 'paragraph', ?)").run(lawId, article).lastInsertRowid);
		sqlite.prepare("INSERT INTO provision_versions (provision_id, from_revision_id, num, text, change) VALUES (?, ?, '1', ?, 'baseline')").run(paragraph, revisionId, `第${num}条のもとの本文`);
		ids[num] = article;
	}
	return { lawId, revisionId, title, ids };
}

type Change = { num: string; op: 'amend' | 'add' | 'delete'; provisionId?: number | null; text?: string };
type LawPart = { action: 'amend' | 'repeal' | 'enact'; law?: Law; newTitle?: string; baseIfSeq?: number; changes: Change[] };

/** 発議した法案。laws の順が seq。order はその会期の中の発議の順 */
function addBill(s: Session, laws: LawPart[], order = unique()) {
	const author = addUser();
	const id = Number(
		sqlite
			.prepare("INSERT INTO bills (user_id, committee_id, kind, status, rev, next_rev, proposed_rev, title, affected, side_effects, created_at, updated_at, proposed_at) VALUES (?, 1, ?, 'proposed', 1, 2, 1, ?, 'a', 's', 0, 0, ?)")
			.run(author, laws[0].action, `法案${unique()}`, s.startsAt + order).lastInsertRowid
	);
	laws.forEach((l, seq) => {
		sqlite
			.prepare('INSERT INTO bill_laws (bill_id, rev, seq, action, law_id, base_revision_id, new_title, base_if_seq) VALUES (?, 1, ?, ?, ?, ?, ?, ?)')
			.run(id, seq, l.action, l.law?.lawId ?? null, l.law?.revisionId ?? null, l.action === 'enact' ? (l.newTitle ?? `新法${unique()}`) : null, l.baseIfSeq ?? 0);
		for (const c of l.changes) {
			sqlite
				.prepare("INSERT INTO bill_changes (bill_id, rev, law_seq, num, op, provision_id, caption, body) VALUES (?, 1, ?, ?, ?, ?, '（見出し）', ?)")
				.run(id, seq, c.num, c.op, c.op === 'add' ? null : (c.provisionId ?? null), c.op === 'delete' ? null : para(c.text ?? '本文'));
		}
	});
	sqlite.prepare('INSERT INTO bill_solutions (bill_id, rev, seq, solution_id) VALUES (?, 1, 0, 1)').run(id);
	return { id, author };
}
function votes(s: Session, bill: number, n = 10) {
	for (let i = 0; i < n; i++) sqlite.prepare("INSERT INTO votes (session_key, bill_id, user_id, choice, created_at, updated_at) VALUES (?, ?, ?, 'yes', 0, 0)").run(s.key, bill, voter());
}
const fix = (s: Session) => sqlite.prepare('INSERT INTO session_participants (committee_id, session_key, active_count, fixed_at) VALUES (1, ?, 0, 0)').run(s.key);
const settle = (s: Session) => settleSession(db, s, previousOf(s), s.endsAt + MINUTE, null);
const latest = async (law: Law) => {
	const h = await ifWorld.ifHeadOf(db, law.lawId);
	return ifWorld.ifArticles(db, law.lawId, h.branchRevisionId as string, h.seq);
};
const bodyOf = async (law: Law, num: string) => (await latest(law)).find((a) => a.num === num)?.paragraphs[0].text;
const revisionsOf = (bill: number) => (sqlite.prepare('SELECT count(*) AS n FROM if_revisions WHERE bill_id = ?').get(bill) as { n: number }).n;
const enactedOf = (bill: number) => (sqlite.prepare('SELECT count(*) AS n FROM if_laws WHERE bill_id = ?').get(bill) as { n: number }).n;
const adjustmentOf = (bill: number, s: Session) => (sqlite.prepare('SELECT reason FROM bill_adjustments WHERE bill_id = ? AND session_key = ?').get(bill, s.key) as { reason: string } | undefined)?.reason;
/** 結果のページのリンク先（法令の順） */
const placesOf = (bill: number) => ifWorld.ifPlacesOf(db, bill, 1);

beforeAll(() => {
	({ sqlite, db } = openMemoryDb());
	sqlite.exec(
		"INSERT INTO user (id, name, email, created_at, updated_at) VALUES ('issuer', 'i', 'i@test.invalid', 0, 0); INSERT INTO issues (id, user_id, title, affected, example, topic_id, created_at) VALUES (1, 'issuer', '課題', '人', '例', NULL, 0); INSERT INTO solutions (id, issue_id, user_id, body, created_at) VALUES (1, 1, 'issuer', '解決策', 0);"
	);
});

test('基準7：2本の法令の法案が可決するとすべての法令に入り、結果のページは法令ごと。1本でもぶつかれば全部が要調整。途中で失敗しても半端に残らず、やり直すと全部入る。新法の名前の重なりは巻き戻る', async () => {
	// すべての法令に入る
	const s = monthOf('2601-05');
	fix(s);
	const [a, b] = [addLaw(), addLaw()];
	const both = addBill(s, [
		{ action: 'amend', law: a, changes: [{ num: '1', op: 'amend', provisionId: a.ids['1'], text: 'Aの書きかえ' }] },
		{ action: 'amend', law: b, changes: [{ num: '2', op: 'amend', provisionId: b.ids['2'], text: 'Bの書きかえ' }] }
	]);
	votes(s, both.id);
	await settle(s);
	expect(revisionsOf(both.id)).toBe(2);
	expect(await bodyOf(a, '1')).toBe('Aの書きかえ');
	expect(await bodyOf(b, '2')).toBe('Bの書きかえ');
	expect(await placesOf(both.id)).toEqual([
		{ lawId: a.lawId, title: a.title },
		{ lawId: b.lawId, title: b.title }
	]);

	// 1本でもぶつかれば全部が要調整
	const s2 = nextOf(s);
	fix(s2);
	const first = addBill(s2, [{ action: 'amend', law: b, baseIfSeq: 1, changes: [{ num: '3', op: 'amend', provisionId: b.ids['3'], text: '先の書きかえ' }] }], 1);
	const later = addBill(
		s2,
		[
			{ action: 'amend', law: a, baseIfSeq: 1, changes: [{ num: '3', op: 'amend', provisionId: a.ids['3'], text: '後のAの書きかえ' }] },
			{ action: 'amend', law: b, baseIfSeq: 1, changes: [{ num: '3', op: 'amend', provisionId: b.ids['3'], text: '後のBの書きかえ' }] }
		],
		2
	);
	votes(s2, first.id);
	votes(s2, later.id);
	await settle(s2);
	expect(adjustmentOf(later.id, s2)).toBe('article');
	expect(revisionsOf(later.id)).toBe(0);
	expect(await bodyOf(a, '3')).toBe('第3条のもとの本文');

	// 2本目の法令で失敗すると、1本目も入らない。やり直すと全部入る
	const s3 = nextOf(s2);
	fix(s3);
	const [c, d] = [addLaw(), addLaw()];
	const failing = addBill(s3, [
		{ action: 'amend', law: c, changes: [{ num: '1', op: 'amend', provisionId: c.ids['1'], text: 'Cの書きかえ' }] },
		{ action: 'amend', law: d, changes: [{ num: '1', op: 'amend', provisionId: d.ids['1'], text: 'Dの書きかえ' }] }
	]);
	votes(s3, failing.id);
	sqlite.exec(`CREATE TRIGGER fail_second BEFORE INSERT ON if_revisions WHEN NEW.law_id = '${d.lawId}' BEGIN SELECT RAISE(ABORT, '2本目で失敗'); END`);
	await expect(settle(s3)).rejects.toThrow();
	expect(revisionsOf(failing.id)).toBe(0);
	sqlite.exec('DROP TRIGGER fail_second');
	await settle(s3);
	expect(revisionsOf(failing.id)).toBe(2);
	expect(await bodyOf(c, '1')).toBe('Cの書きかえ');
	expect(await bodyOf(d, '1')).toBe('Dの書きかえ');

	// 確かめたあとに同じ名前の新法が入ると、関連法だけが入らずに巻き戻り、やり直すと名前の重なりで要調整
	const s4 = nextOf(s3);
	fix(s4);
	const e = addLaw();
	const rival = addBill(nextOf(s4), [{ action: 'enact', newTitle: '重なる新法', changes: [{ num: '1', op: 'add' }] }]);
	const enact = addBill(s4, [
		{ action: 'enact', newTitle: '重なる新法', changes: [{ num: '1', op: 'add', text: '新法の本文' }] },
		{ action: 'amend', law: e, changes: [{ num: '3_2', op: 'add', text: '足す条' }] }
	]);
	votes(s4, enact.id);
	sqlite.exec(
		`CREATE TRIGGER take_title AFTER INSERT ON if_added_articles WHEN NEW.law_id = '${e.lawId}' BEGIN INSERT INTO if_laws (id, bill_id, bill_rev, title, session_key, created_at) VALUES ('if-${rival.id}', ${rival.id}, 1, '重なる新法', 'x', 0); END`
	);
	await expect(settle(s4)).rejects.toThrow();
	expect(revisionsOf(enact.id) + enactedOf(enact.id)).toBe(0);
	sqlite.exec('DROP TRIGGER take_title');
	await settle(s4);
	expect(adjustmentOf(enact.id, s4)).toBe('title');
	expect(revisionsOf(enact.id) + enactedOf(enact.id)).toBe(0);
});

test('基準8：制定と関連法が可決すると、新法のページには新法の条だけが出て、関連法の条は関連法のページに出る。結果のページは新法が先', async () => {
	const s = monthOf('2605-05');
	fix(s);
	const law = addLaw();
	const bill = addBill(s, [
		{ action: 'enact', newTitle: '関連法のある新法', changes: [{ num: '1', op: 'add', text: '新法の第1条' }, { num: '2', op: 'add', text: '新法の第2条' }] },
		{ action: 'amend', law, changes: [{ num: '3', op: 'amend', provisionId: law.ids['3'], text: '関連法の書きかえ' }] }
	]);
	votes(s, bill.id);
	await settle(s);

	const page = await ifWorld.ifLawPage(db, `if-${bill.id}`);
	expect(page?.articles.map((a) => a.num)).toEqual(['1', '2']);
	expect(page?.articles.map((a) => a.paragraphs[0].text)).toEqual(['新法の第1条', '新法の第2条']);
	const related = await ifWorld.ifLawPage(db, law.lawId);
	expect(related?.articles.find((a) => a.num === '3')?.paragraphs[0].text).toBe('関連法の書きかえ');
	expect(await placesOf(bill.id)).toEqual([
		{ lawId: `if-${bill.id}`, title: '関連法のある新法' },
		{ lawId: law.lawId, title: law.title }
	]);
});

test('基準4：対象の法令の一部が廃止されて廃案になった法案は出し直せる。すべて廃止なら出し直せない。要調整を直すとき法令の扱いは変えられない', async () => {
	const s = monthOf('2609-05');
	fix(s);
	const [gone, kept] = [addLaw(), addLaw()];
	const repeal = addBill(s, [{ action: 'repeal', law: gone, changes: [] }], 1);
	const changer = addBill(s, [{ action: 'amend', law: kept, changes: [{ num: '2', op: 'amend', provisionId: kept.ids['2'], text: '先に変わった第2条' }] }], 2);
	votes(s, repeal.id);
	votes(s, changer.id);
	await settle(s);

	// ぶつかった条文は、法令が2本以上なら法令名つき
	const stale = await ifWorld.staleArticlesOfBill(
		db,
		[{ action: 'amend', lawId: kept.lawId, baseRevisionId: kept.revisionId, baseIfSeq: 0, newTitle: null, changes: [{ num: '2', op: 'amend', provisionId: kept.ids['2'] }] }],
		new Map([[kept.lawId, kept.title]])
	);
	expect(stale.map((c) => [c.lawTitle, c.label, c.body])).toEqual([[kept.title, '第2条', '先に変わった第2条']]);

	// 書く画面の確かめ：廃止された法令の枠は断り、外せば通る。主と同じ法令の枠は、その枠のそばに出す
	for (const law of [gone, kept]) sqlite.prepare('INSERT OR IGNORE INTO committee_laws (committee_id, law_id) VALUES (1, ?)').run(law.lawId);
	const token = async (law: Law) => {
		const h = await ifWorld.ifHeadOf(db, law.lawId);
		return `${h.branchRevisionId}@${h.seq}`;
	};
	const values = async (extras: BillFormValues['extras']): Promise<BillFormValues> => ({
		kind: 'amend',
		title: '出し直した法案',
		newTitle: '',
		law: kept.lawId,
		base: await token(kept),
		extras,
		affected: '困っている人',
		sideEffects: '副作用',
		summary: '',
		supplementary: '',
		solutions: ['1'],
		rows: [{ op: 'amend', target: '1', num: '', caption: '（見出し）', body: '書きかえた第1条', seq: '0' }]
	});
	const withGone = await checkBillForm(db, await values([{ law: gone.lawId, base: await token(gone), action: 'amend' }]));
	expect(withGone.ok ? null : [withGone.status, withGone.errors.laws?.[1]?.law]).toEqual([400, ja.ifLaw.lawRepealed]);
	expect((await checkBillForm(db, await values([]))).ok).toBe(true);
	const duplicate = await checkBillForm(db, await values([{ law: kept.lawId, base: await token(kept), action: 'amend' }]));
	expect(duplicate.ok ? null : [duplicate.status, duplicate.errors.laws?.[1]?.law]).toEqual([400, ja.bill.lawDuplicate]);

	const twoLaws = { id: 0, laws: [{ lawId: gone.lawId }, { lawId: kept.lawId }] };
	expect((await resubmitStateOf(db, twoLaws, 'lapsed')).can).toBe(true);
	expect((await resubmitStateOf(db, { id: 0, laws: [{ lawId: gone.lawId }] }, 'lapsed')).can).toBe(false);
	expect((await resubmitStateOf(db, { id: 0, laws: [{ lawId: null }, { lawId: gone.lawId }] }, 'lapsed')).can).toBe(true);

	// 要調整：廃止の法案の関連法を、廃止から改正へ変えられない
	const s2 = nextOf(s);
	fix(s2);
	const [main, sub] = [addLaw(), addLaw()];
	const adjusted = addBill(s2, [
		{ action: 'repeal', law: main, changes: [] },
		{ action: 'repeal', law: sub, changes: [] }
	]);
	const at = nextOf(s2).startsAt + MINUTE;
	sqlite.prepare("INSERT INTO bill_adjustments (bill_id, session_key, reason, due_at, proposed_at, created_at) VALUES (?, ?, 'article', ?, 0, 0)").run(adjusted.id, s2.key, at + 86_400_000);
	const bill = await billById(db, adjusted.id);
	if (!bill) throw new Error('法案がない');
	const input = {
		kind: bill.kind,
		committeeId: 1,
		title: bill.title,
		affected: '直した困りごと',
		sideEffects: bill.sideEffects,
		summary: null,
		supplementary: null,
		laws: bill.laws.map((l) => ({ action: l.action, lawId: l.lawId, baseRevisionId: l.baseRevisionId, baseIfSeq: 0, newTitle: l.newTitle, changes: [] as never[] })),
		solutionIds: [1]
	};
	input.laws[1] = { ...input.laws[1], action: 'amend', changes: [{ op: 'amend', num: '1', provisionId: sub.ids['1'], caption: null, paragraphs: [{ num: '1', text: '改正に変えた', items: [] }] }] as never[] };
	expect(await ifWorld.saveAdjustedBill(db, { userId: adjusted.author, registeredAt: 0, ipHash: 'x' }, bill, 1, input, at)).toEqual({ ok: false, reason: 'locked' });
});

test('基準9：2本の法令の法案の修正案は、非表示の欄、運営の画面、結果のページで法令名が付く。1本の法案は付かない。関連法の条への修正案が可決するとその法令に入る', async () => {
	const s = monthOf('2613-05');
	const [a, b] = [addLaw(), addLaw()];
	const two = addBill(s, [
		{ action: 'amend', law: a, changes: [{ num: '1', op: 'amend', provisionId: a.ids['1'], text: 'Aの書きかえ' }] },
		{ action: 'amend', law: b, changes: [{ num: '2', op: 'amend', provisionId: b.ids['2'], text: 'Bの書きかえ' }] }
	]);
	const one = addBill(s, [{ action: 'amend', law: a, changes: [{ num: '1', op: 'amend', provisionId: a.ids['1'], text: 'Aだけ' }] }]);
	const writer = addUser();
	const insert = (billId: number, lawSeq: number, num: string, provisionId: number, status: string, moderation: string) =>
		Number(
			sqlite
				.prepare('INSERT INTO amendments (bill_id, session_key, user_id, base_rev, law_seq, num, provision_id, body, status, moderation_status, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, 0, 0)')
				.run(billId, s.key, writer, lawSeq, num, provisionId, para('修正案の本文'), status, moderation).lastInsertRowid
		);
	const hiddenTwo = insert(two.id, 1, '2', b.ids['2'], 'open', 'hidden');
	const hiddenOne = insert(one.id, 0, '1', a.ids['1'], 'open', 'hidden');
	const failed = insert(two.id, 1, '2', b.ids['2'], 'failed', 'visible');
	for (const id of [hiddenTwo, hiddenOne]) sqlite.prepare("INSERT INTO amendment_reports (amendment_id, user_id, reason, counted, revision, created_at) VALUES (?, ?, 'spam', 1, 1, 0)").run(id, addUser());

	expect((await hiddenAmendmentsFor(db, two.id, writer, false)).map((r) => r.location)).toEqual([`${b.title} 第2条`]);
	expect((await hiddenAmendmentsFor(db, one.id, writer, false)).map((r) => r.location)).toEqual(['第1条']);
	const staff = { userId: addUser(), role: 'operator' as const };
	const reported = await reportedAmendments(db, staff, null);
	expect(reported.find((r) => r.id === hiddenTwo)?.location).toBe(`${b.title} 第2条`);
	expect(reported.find((r) => r.id === hiddenOne)?.location).toBe('第1条');
	const results = await priorAmendmentResults(db, two.id, s.key);
	expect(results.find((r) => r.id === failed)?.location).toBe(`${b.title} 第2条`);

	// 関連法の条への修正案の可決
	const passed = insert(two.id, 1, '2', b.ids['2'], 'passed', 'visible');
	await settleAmendments(db, s, two.id, 0, s.endsAt);
	const bill = await billById(db, two.id);
	expect(bill?.laws[1].changes.find((c) => c.num === '2')?.paragraphs?.[0].text).toBe('修正案の本文');
	expect(bill?.laws[0].changes.find((c) => c.num === '1')?.paragraphs?.[0].text).toBe('Aの書きかえ');
	expect(passed).toBeGreaterThan(0);
});
