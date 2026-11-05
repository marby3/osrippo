// Issue #68 基準3・4・7・8 の DB の側（設計書 docs/spec/68.md 決めたこと5・6・8・10・11）
import { beforeAll, expect, test } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { openMemoryDb, type MemoryDb } from './memory';
import { sessionAt } from '../domain/session';
import { billById, billSupportState, listBills, supportRev } from '../server/bills';
import { acceptAmendment, castAmendmentVote, coDrafters, createAmendment, settleAmendments, tallyAmendmentVotes, updateAmendment, amendmentOf } from '../server/amendments';
import { isSupporter } from '../server/posts';
import { castVote } from '../server/votes';

let sqlite: DatabaseSync;
let db: MemoryDb;
const NOW = Date.parse('2046-05-25T00:00:00+09:00');
const session = sessionAt(NOW, null);
const previous = sessionAt(session.startsAt - 1, null);
const actor = (userId: string) => ({ userId, registeredAt: 0, ipHash: `ip-${userId}` });
const para = (text: string) => [{ num: '1', text, items: [] }];
const firstRandom = () => 0;
let nextBill = 1;
const SOLUTION_ROWS = "INSERT INTO issues (id, user_id, title, affected, example, topic_id, created_at) VALUES (1, 'issuer', '課題', '人', '例', NULL, 0); INSERT INTO solutions (id, issue_id, user_id, body, created_at) VALUES (1, 1, 'issuer', '解決策', 0);";
/** レート制限（24時間に5件）に当たらないよう、出すたびに時刻を進める */
let clock = NOW;
const tick = () => (clock += 2 * 86_400_000);

function addUser(id: string) {
	sqlite.prepare('INSERT INTO user (id, name, email, created_at, updated_at) VALUES (?, ?, ?, 0, 0)').run(id, `name-${id}`, `${id}@test.invalid`);
	// 投票資格：会期の前に今月の参加者に数える行動がある
	sqlite.prepare("INSERT INTO actions (kind, user_id, ip_hash, created_at) VALUES ('support_add', ?, 'x', 0)").run(id);
}

/** 発議した制定の法案（条は3つ）。版は 1 */
function addBill(author = 'author') {
	const id = nextBill++;
	const proposedAt = previous.deliberationAt + 1;
	sqlite
		.prepare("INSERT INTO bills (id, user_id, committee_id, kind, status, rev, next_rev, proposed_rev, title, affected, side_effects, created_at, updated_at, proposed_at) VALUES (?, ?, 1, 'enact', 'proposed', 1, 2, 1, 't', 'a', 's', 0, 0, ?)")
		.run(id, author, proposedAt);
	sqlite.prepare("INSERT INTO bill_laws (bill_id, rev, seq, action, new_title) VALUES (?, 1, 0, 'enact', '新しい法律')").run(id);
	sqlite.prepare('INSERT INTO bill_solutions (bill_id, rev, seq, solution_id) VALUES (?, 1, 0, 1)').run(id);
	for (const num of ['1', '2', '3']) {
		sqlite.prepare("INSERT INTO bill_changes (bill_id, rev, law_seq, num, op, caption, body) VALUES (?, 1, 0, ?, 'add', '（見出し）', ?)").run(id, num, JSON.stringify(para(`第${num}条のもとの本文`)));
	}
	return id;
}

const addAmendment = async (billId: number, userId: string, num: string, text: string, baseRev = 1) => {
	const result = await createAmendment(db, actor(userId), { billId, sessionKey: session.key, baseRev, lawSeq: 0, num, provisionId: null, paragraphs: para(text), reason: null }, tick());
	if (!result.ok) throw new Error('断られた');
	return result.id;
};
const support = (id: number, users: string[], revision = 1) => {
	for (const u of users) sqlite.prepare('INSERT INTO amendment_supports (amendment_id, revision, user_id, created_at) VALUES (?, ?, ?, 0)').run(id, revision, u);
};
const voters = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i}`);
const statusOf = (id: number) => (sqlite.prepare('SELECT status FROM amendments WHERE id = ?').get(id) as { status: string }).status;
const bodyOf = async (billId: number, num: string) => {
	const bill = await billById(db, billId);
	return bill?.laws[0].changes.find((c) => c.num === num)?.paragraphs?.[0].text;
};
/** 修正案に投票し、割り当てられた本案すべてに投票する（本案の票がないと有効票にならない） */
async function voteFor(amendmentId: number, users: string[], choice: 'yes' | 'no' | 'abstain', required = 2) {
	for (const u of users) {
		expect(await castAmendmentVote(db, actor(u), session, previous, amendmentId, required, choice, NOW, firstRandom)).toBe(true);
		const assigned = sqlite.prepare('SELECT bill_id FROM vote_assignments WHERE user_id = ?').all(u) as { bill_id: number }[];
		for (const { bill_id } of assigned) await castVote(db, u, session, previous, bill_id, 'yes', NOW, firstRandom);
	}
}
const loaded = async (id: number) => {
	const bill = await billById(db, id);
	if (!bill) throw new Error('法案がない');
	return bill;
};
const row = async (id: number, billId: number) => {
	const amendment = await amendmentOf(db, id, billId);
	if (!amendment) throw new Error('修正案がない');
	return amendment;
};
const accept = (billId: number, amendmentId: number, revision = 1) => acceptAmendment(db, actor('author'), billId, amendmentId, revision, NOW);

beforeAll(() => {
	({ sqlite, db } = openMemoryDb());
	sqlite.exec("INSERT INTO user (id, name, email, created_at, updated_at) VALUES ('issuer', 'issuer', 'issuer@test.invalid', 0, 0)");
	sqlite.exec(SOLUTION_ROWS);
	for (const u of ['author', 'p1', 'p2', 'p3', 's1', 's2', 's3', ...voters('v', 16), ...voters('w', 10)]) addUser(u);
});

test('基準3：取り込むと本案の版が進み、条の本文が修正案になり、ほかの条は変わらない。提案者が共同起草者になる。古い本文や版では取り込めない', async () => {
	const id = addBill();
	const a = await addAmendment(id, 'p1', '1', '取り込む本文');
	expect(await coDrafters(db, id)).toEqual([]);

	// 読んだ本文（revision）が違えば取り込まない
	expect(await accept(id, a, 99)).toBe(false);
	expect(statusOf(a)).toBe('open');

	expect(await accept(id, a)).toBe(true);
	const after = await billById(db, id);
	expect(after?.rev).toBe(2);
	expect(await bodyOf(id, '1')).toBe('取り込む本文');
	expect(await bodyOf(id, '2')).toBe('第2条のもとの本文');
	expect(after?.laws[0].changes.map((c) => c.num)).toEqual(['1', '2', '3']);
	expect(statusOf(a)).toBe('accepted');
	expect(sqlite.prepare('SELECT applied_rev FROM amendments WHERE id = ?').get(a)).toMatchObject({ applied_rev: 2 });
	expect(await coDrafters(db, id)).toEqual(['name-p1']);

	// 同じ修正案を2回取り込めない（版が進んでいる）
	expect(await accept(id, a)).toBe(false);
	expect((await billById(db, id))?.rev).toBe(2);
	expect(sqlite.prepare("SELECT count(*) AS n FROM actions WHERE kind = 'amendment_accept' AND target_id = ?").get(id)).toMatchObject({ n: 1 });
});

test('基準4：更新で本文を変えるか同じ条が取り込まれていたら賛同は数え直し。どちらでもなければ保つ', async () => {
	const id = addBill();
	const accepted = await addAmendment(id, 'p1', '1', '先に取り込む本文');
	const otherArticle = await addAmendment(id, 'p2', '2', '別の条の本文');
	const otherEdited = await addAmendment(id, 'p2', '3', '別の条の本文その2');
	const sameArticle = await addAmendment(id, 'p3', '1', '同じ条の本文');
	await accept(id, accepted);
	const bill = await loaded(id);
	const revisionOf = async (a: number) => (await amendmentOf(db, a, id))?.revision;
	const baseRevOf = async (a: number) => (await amendmentOf(db, a, id))?.baseRev;

	// 本文も条も変わらない：賛同を保つ
	expect(await updateAmendment(db, actor('p2'), bill, await row(otherArticle, id), para('別の条の本文'), null, tick())).toEqual({ ok: true });
	expect(await revisionOf(otherArticle)).toBe(1);
	expect(await baseRevOf(otherArticle)).toBe(2);
	// 本文を変えた：数え直し
	await updateAmendment(db, actor('p2'), bill, await row(otherEdited, id), para('書き直した本文'), null, tick());
	expect(await revisionOf(otherEdited)).toBe(2);
	// 本文は同じでも、同じ条が取り込まれていた：数え直し
	await updateAmendment(db, actor('p3'), bill, await row(sameArticle, id), para('同じ条の本文'), null, tick());
	expect(await revisionOf(sameArticle)).toBe(2);
	// 版が同じものは更新できない
	expect(await updateAmendment(db, actor('p3'), bill, await row(sameArticle, id), para('もう一度'), null, tick())).toEqual({ ok: false, reason: 'closed' });
	expect((await amendmentOf(db, sameArticle, id))?.paragraphs[0].text).toBe('同じ条の本文');
});

test('基準7：定足数と可決の条件は本案と同じ。可決だけを反映し、同じ条は先に出したほう。要件に届かないものと古い版のものは採決されない。何度呼んでも同じ', async () => {
	const id = addBill();
	const [yes, no] = [voters('v', 6), voters('w', 4)];
	const passed = await addAmendment(id, 'p1', '1', '可決する本文');
	const superseded = await addAmendment(id, 'p2', '1', '後から可決する本文');
	const rejected = await addAmendment(id, 'p3', '2', '否決される本文');
	const lapsed = await addAmendment(id, 'p1', '3', '定足数に届かない本文');
	const unsupported = await addAmendment(id, 'p2', '3', '賛同の足りない本文');
	const oldVersion = await addAmendment(id, 'p3', '3', '古い版の本文', 0);
	for (const a of [passed, superseded, rejected, lapsed, oldVersion]) support(a, ['s1', 's2']);
	support(unsupported, ['s1']);

	await voteFor(passed, yes, 'yes');
	await voteFor(passed, no, 'no');
	await voteFor(superseded, yes, 'yes');
	await voteFor(superseded, no, 'no');
	await voteFor(rejected, no, 'yes');
	await voteFor(rejected, yes, 'no');
	await voteFor(lapsed, ['v0', 'v1'], 'yes');
	// 要件に届かないものと古い版のものには入れられない
	expect(await castAmendmentVote(db, actor('v0'), session, previous, unsupported, 2, 'yes', NOW, firstRandom)).toBe(false);
	expect(await castAmendmentVote(db, actor('v0'), session, previous, oldVersion, 2, 'yes', NOW, firstRandom)).toBe(false);
	// 投票の期間の外は入れられない
	expect(await castAmendmentVote(db, actor('v0'), session, previous, passed, 2, 'yes', session.endsAt, firstRandom)).toBe(false);

	await settleAmendments(db, session, id, 0, session.endsAt);
	const statuses = () => [passed, superseded, rejected, lapsed, unsupported, oldVersion].map(statusOf);
	const expected = ['passed', 'superseded', 'failed', 'lapsed', 'unvoted', 'unvoted'];
	expect(statuses()).toEqual(expected);
	expect(await bodyOf(id, '1')).toBe('可決する本文');
	expect(await bodyOf(id, '2')).toBe('第2条のもとの本文');
	expect(await bodyOf(id, '3')).toBe('第3条のもとの本文');
	expect(await coDrafters(db, id)).toEqual(['name-p1']);
	const rev = (await billById(db, id))?.rev;
	expect(rev).toBe(2);

	await settleAmendments(db, session, id, 0, session.endsAt + 1);
	expect(statuses()).toEqual(expected);
	expect((await billById(db, id))?.rev).toBe(rev);
});

test('基準7：状態を書いたあと版を進める前に失敗しても、やり直すと反映される。別の条の可決はまとめて1つの版にする', async () => {
	const id = addBill();
	const first = await addAmendment(id, 'p1', '1', '1本目の本文');
	const second = await addAmendment(id, 'p2', '2', '2本目の本文');
	sqlite.prepare("UPDATE amendments SET status = 'passed' WHERE id IN (?, ?)").run(first, second);

	await settleAmendments(db, session, id, 0, session.endsAt);
	expect(await bodyOf(id, '1')).toBe('1本目の本文');
	expect(await bodyOf(id, '2')).toBe('2本目の本文');
	expect((await billById(db, id))?.rev).toBe(2);
	expect(statusOf(first)).toBe('passed');
	expect(await coDrafters(db, id)).toEqual(['name-p1', 'name-p2']);
});

test('基準7：修正案の票は、投票資格があり割り当てを本案の票で済ませた人だけを数える。修正案の票は割り当てを済ませる条件に入らない', async () => {
	const id = addBill();
	const a = await addAmendment(id, 'p1', '1', '数える本文');
	support(a, ['s1', 's2']);
	// 割り当てを済ませた人（本案に投票した）
	await voteFor(a, ['v10'], 'yes');
	// 修正案だけに投票した人は、割り当てが残っているので参考の票
	expect(await castAmendmentVote(db, actor('v11'), session, previous, a, 2, 'no', NOW, firstRandom)).toBe(true);
	const counts = await tallyAmendmentVotes(db, session, a);
	expect(counts.counted).toEqual({ yes: 1, no: 0, abstain: 0 });
	expect(counts.reference).toEqual({ yes: 0, no: 1, abstain: 0 });
	// 票を変えられる。数えるのは最後の票で、変えていなければ記録を足さない
	await castAmendmentVote(db, actor('v10'), session, previous, a, 2, 'abstain', NOW, firstRandom);
	expect((await tallyAmendmentVotes(db, session, a)).counted).toEqual({ yes: 0, no: 0, abstain: 1 });
	const records = () => (sqlite.prepare("SELECT count(*) AS n FROM actions WHERE kind = 'vote_cast' AND user_id = 'v11' AND target_id IS NULL").get() as { n: number }).n;
	expect(records()).toBe(1);
	await castAmendmentVote(db, actor('v11'), session, previous, a, 2, 'no', NOW, firstRandom);
	expect(records()).toBe(1);
});

test('基準8：版が進んでも、発議した版の賛同者が賛同者のまま。下書きは今までどおりいまの版', async () => {
	const id = addBill();
	sqlite.prepare('INSERT INTO bill_supports (bill_id, rev, user_id, created_at) VALUES (?, 1, ?, 0), (?, 1, ?, 0)').run(id, 's1', id, 's2');
	const a = await addAmendment(id, 'p1', '1', '賛同者の本文');
	await accept(id, a);

	const bill = await loaded(id);
	expect(bill.rev).toBe(2);
	expect(supportRev(bill)).toBe(1);
	expect(await isSupporter(db, bill, 's1')).toBe(true);
	expect(await isSupporter(db, bill, 'p1')).toBe(false);
	expect((await billSupportState(db, id, supportRev(bill), 's1'))).toEqual({ supports: 2, mine: true });
	const { rows } = await listBills(db, 'shingi', 1, 0);
	expect(rows.find((r) => r.id === id)?.supports).toBe(2);

	// 下書きは proposed_rev がなく、いまの版
	expect(supportRev({ rev: 3, proposedRev: null })).toBe(3);
});
