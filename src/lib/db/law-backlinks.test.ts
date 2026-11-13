// Issue #166：条の「リンク元」（受入基準は Issue #198 の「#166」の節）。
// 書いたときに本文の条を law_refs へ入れ、読むときに非表示・統合したものを外す。法案は、いまの版の変える条から引く。
// 画面は e2e/jo-rinkumoto.spec.ts
import { beforeAll, expect, test } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { openMemoryDb } from './memory';
import { seedStatements } from './seed';
import type { Db } from '../server/law';
import { createIssue, type Actor } from '../server/issues';
import { createPost } from '../server/posts';
import { articlesTouchedBy, backfillLawRefs, saveLawRefs } from '../server/law-refs';
import { articleBacklinks } from '../server/law-backlinks';
import { sessionAt } from '../domain/session';

const root = new URL('../../../', import.meta.url);
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`tests/fixtures/egov/${name}.json`, root), 'utf8'));
const LAW = '351AC0000000057';
const NOW = Date.parse('2046-05-15T09:00:00+09:00');
const session = sessionAt(NOW, null);

let sqlite: DatabaseSync;
let db: Db;
const actor: Actor = { userId: 'u1', registeredAt: 0, ipHash: 'ip1' };
const other: Actor = { userId: 'u2', registeredAt: 0, ipHash: 'ip2' };
const run = (sql: string, ...p: (string | number | null)[]) => sqlite.prepare(sql).run(...p);
const one = <T>(sql: string, ...p: (string | number)[]) => sqlite.prepare(sql).get(...p) as T;

beforeAll(() => {
	({ sqlite, db } = openMemoryDb());
	for (const sql of seedStatements([LAW], fixture)) sqlite.exec(sql);
	for (const id of ['u1', 'u2']) run('INSERT INTO user (id, name, email, created_at, updated_at) VALUES (?, ?, ?, 0, 0)', id, id, `${id}@test.invalid`);
}, 120_000);

/** いまの版の条の内部ID */
const articleId = (num: string) =>
	one<{ id: number }>(
		`SELECT p.id FROM provisions p JOIN provision_versions v ON v.provision_id = p.id JOIN law_revisions f ON f.id = v.from_revision_id
		 LEFT JOIN law_revisions t ON t.id = v.to_revision_id
		 WHERE p.law_id = ? AND p.kind = 'article' AND v.num = ?
		   AND f.seq <= (SELECT max(seq) FROM law_revisions WHERE law_id = p.law_id AND branch = 'real' AND status = 'enforced')
		   AND (t.id IS NULL OR t.seq > (SELECT max(seq) FROM law_revisions WHERE law_id = p.law_id AND branch = 'real' AND status = 'enforced'))`,
		LAW,
		num
	).id;
const baseRevision = () => one<{ id: string }>("SELECT id FROM law_revisions WHERE law_id = ? AND branch = 'real' AND status = 'enforced' ORDER BY seq DESC LIMIT 1", LAW).id;

let nextBill = 1;
/** 法案。changes は版ごとの変える条（op と条の番号） */
function bill(o: { status: 'draft' | 'proposed' | 'withdrawn'; rev: number; title: string; changes: Record<number, { op: 'amend' | 'add' | 'delete'; num: string }[]>; createdAt: number }) {
	const id = nextBill++;
	const proposedAt = o.status === 'draft' ? null : NOW - 10 * 86_400_000;
	run(
		"INSERT INTO bills (id, user_id, committee_id, kind, status, rev, next_rev, title, affected, side_effects, created_at, updated_at, proposed_at) VALUES (?, 'u2', 1, 'amend', ?, ?, ?, ?, 'a', 's', ?, ?, ?)",
		id,
		o.status,
		o.rev,
		o.rev + 1,
		o.title,
		o.createdAt,
		o.createdAt,
		proposedAt
	);
	for (const [rev, changes] of Object.entries(o.changes)) {
		run("INSERT INTO bill_laws (bill_id, rev, seq, action, law_id, base_revision_id) VALUES (?, ?, 0, 'amend', ?, ?)", id, Number(rev), LAW, baseRevision());
		for (const c of changes)
			run(
				'INSERT INTO bill_changes (bill_id, rev, law_seq, num, op, provision_id, caption, body) VALUES (?, ?, 0, ?, ?, ?, NULL, ?)',
				id,
				Number(rev),
				c.num,
				c.op,
				c.op === 'add' ? null : articleId(c.num),
				c.op === 'delete' ? null : '[]'
			);
	}
	return id;
}

const issueInput = (title: string, example: string) => ({ title, affected: '訪問販売で契約した人', example, topicId: null });
async function newIssue(a: Actor, title: string, example: string, at: number) {
	const r = await createIssue(db, a, issueInput(title, example), at);
	if (!r.ok) throw new Error('課題を書けませんでした');
	return r.id;
}
/**
 * 解決策。createSolution は db.all の RETURNING を読むので、行を配列で返すメモリの DB では番号が取れない。
 * ここでは createSolution と同じ手順（書く前に条を引き、書いたあとに入れる）で書く。画面からの書き込みは e2e/jo-rinkumoto.spec.ts
 */
async function newSolution(a: Actor, issueId: number, body: string, at: number) {
	const touched = await articlesTouchedBy(db, [body]);
	const id = Number(run('INSERT INTO solutions (issue_id, user_id, body, created_at) VALUES (?, ?, ?, ?)', issueId, a.userId, body, at).lastInsertRowid);
	await saveLawRefs(db, 'solution', id, touched);
	return id;
}
async function newPost(a: Actor, billId: number, kind: 'question' | 'answer', parentId: number | null, body: string, at: number) {
	const r = await createPost(db, a, { billId, sessionKey: session.key, kind, parentId, role: kind === 'answer' ? 'author' : null, body }, at, kind === 'answer' ? 'author' : null);
	if (!r.ok || r.id === null) throw new Error('質疑を書けませんでした');
	return r.id;
}
const refs = (kind: string, id: number) =>
	sqlite
		.prepare('SELECT law_id, num FROM law_refs WHERE kind = ? AND ref_id = ? ORDER BY num')
		.all(kind, id)
		.map((r) => ({ ...r }));

test('条のリンク元：その条を変える法案（下書きを除く。いまの版）と、触れている課題・解決策・質疑（非表示・統合済みを除く）。0件は空。すでにある行は一度きりの処理で入る', async () => {
	let t = NOW;
	const tick = () => (t += 1000);

	// --- 法案：いまの版で第9条を変えるもの。下書き・保存していない法案・前の版だけで変えていた法案は出さない
	const amend = bill({ status: 'proposed', rev: 1, title: '撤回の期間を14日にする法案', changes: { 1: [{ op: 'amend', num: '9' }] }, createdAt: tick() });
	const withdrawn = bill({ status: 'withdrawn', rev: 1, title: '撤回した法案', changes: { 1: [{ op: 'delete', num: '9' }] }, createdAt: tick() });
	bill({ status: 'draft', rev: 1, title: '下書きの法案', changes: { 1: [{ op: 'amend', num: '9' }] }, createdAt: tick() });
	bill({ status: 'draft', rev: 0, title: '保存していない法案', changes: { 0: [{ op: 'amend', num: '9' }] }, createdAt: tick() });
	bill({ status: 'proposed', rev: 2, title: '前の版だけで変えていた法案', changes: { 1: [{ op: 'amend', num: '9' }], 2: [{ op: 'amend', num: '10' }] }, createdAt: tick() });
	// 条を足す法案は、法令と条の番号で引く
	const add = bill({ status: 'proposed', rev: 1, title: '条を足す法案', changes: { 1: [{ op: 'add', num: '9_4' }] }, createdAt: tick() });

	// --- 課題・解決策・質疑：書いたときに本文の条が law_refs に入る（題名・困っている人・具体例のどれでも）
	const issue = await newIssue(actor, '訪問販売で断りきれずに契約してしまう', '特商法9条のクーリング・オフを知らなかった。消費者契約法4条も読んだ', tick());
	expect(refs('issue', issue)).toEqual([{ law_id: LAW, num: '9' }]);
	const hiddenIssue = await newIssue(actor, '非表示にされる課題', '特定商取引に関する法律第九条の話', tick());
	const mergedIssue = await newIssue(other, '統合される課題', '特商法第9条の話', tick());
	const plainIssue = await newIssue(other, '条に触れない課題', '特商法の話だけ。9条とは書くが法令名がない', tick());
	expect(refs('issue', plainIssue)).toEqual([]);

	const solution = await newSolution(other, issue, '特商法第9条の期間を延ばす', tick());
	expect(refs('solution', solution)).toEqual([{ law_id: LAW, num: '9' }]);
	const hiddenSolution = await newSolution(actor, issue, '特商法9条を変える（非表示になる）', tick());
	// 非表示の課題の解決策は、解決策が表示でも出さない
	await newSolution(other, hiddenIssue, '特商法9条の解決策（課題が非表示）', tick());

	const question = await newPost(other, amend, 'question', null, '定期購入の解約は、特商法9条のクーリング・オフとは別に考えるのですか', tick());
	expect(refs('post', question)).toEqual([{ law_id: LAW, num: '9' }]);
	// 答弁が触れていれば、その質疑を出す（リンク先は質疑のタブ）
	const quiet = await newPost(other, amend, 'question', null, '条に触れない質疑', tick());
	const answer = await newPost(actor, amend, 'answer', quiet, '特商法第9条の2で扱います。特商法9条は変えません', tick());
	expect(refs('post', answer)).toEqual([
		{ law_id: LAW, num: '9' },
		{ law_id: LAW, num: '9_2' }
	]);
	const hiddenQuestion = await newPost(other, amend, 'question', null, '非表示になる質疑。特商法9条', tick());
	const mergedQuestion = await newPost(actor, amend, 'question', null, '統合される質疑。特商法9条', tick());

	run("UPDATE issues SET status = 'hidden', status_actor = 'operator', status_changed_at = 1 WHERE id = ?", hiddenIssue);
	run("UPDATE issues SET status = 'merged', status_actor = 'operator', status_changed_at = 1, merged_into = ? WHERE id = ?", issue, mergedIssue);
	run("UPDATE solutions SET status = 'auto_hidden', status_actor = 'auto', status_changed_at = 1 WHERE id = ?", hiddenSolution);
	run("UPDATE posts SET status = 'hidden', status_actor = 'operator', status_changed_at = 1 WHERE id = ?", hiddenQuestion);
	run("UPDATE posts SET status = 'merged', status_actor = 'operator', status_changed_at = 1, merged_into = ? WHERE id = ?", question, mergedQuestion);

	const nine = await articleBacklinks(db, { lawId: LAW, num: '9', playable: true }, NOW, null);
	expect(nine.bills?.map((b) => b.title)).toEqual(['撤回した法案', '撤回の期間を14日にする法案']);
	expect(nine.bills?.find((b) => b.id === withdrawn)?.stage).toBe('withdrawn');
	expect(nine.bills?.find((b) => b.id === amend)).toMatchObject({ stage: 'deliberation', session: '2046-05' });
	// 新しい順。答弁の触れた質疑は、答弁を書いた時刻で並ぶ。非表示・統合した課題と質疑、非表示の解決策、非表示の課題の解決策は出ない
	expect(nine.discussions).toEqual([
		{ kind: 'question', text: '条に触れない質疑', context: '撤回の期間を14日にする法案', href: `/houan/${amend}/shitsugi#shitsugi-${quiet}` },
		{
			kind: 'question',
			text: '定期購入の解約は、特商法9条のクーリング・オフとは別に考えるのですか',
			context: '撤回の期間を14日にする法案',
			href: `/houan/${amend}/shitsugi#shitsugi-${question}`
		},
		{ kind: 'solution', text: '特商法第9条の期間を延ばす', context: '訪問販売で断りきれずに契約してしまう', href: `/kadai/${issue}/kaiketsu#kaiketsu-${solution}` },
		{ kind: 'issue', text: '訪問販売で断りきれずに契約してしまう', context: null, href: `/kadai/${issue}` }
	]);

	// 条を足す法案は、足す条の番号で出る
	const added = await articleBacklinks(db, { lawId: LAW, num: '9_4', playable: true }, NOW, null);
	expect(added.bills?.map((b) => b.id)).toEqual([add]);

	// 0件：法案も議論もない条。読める法律には法案の欄がない（null）
	expect(await articleBacklinks(db, { lawId: LAW, num: '11', playable: true }, NOW, null)).toEqual({ bills: [], discussions: [] });
	expect(await articleBacklinks(db, { lawId: '129AC0000000089', num: '1', playable: false }, NOW, null)).toEqual({ bills: null, discussions: [] });

	// --- すでにある行（law_refs を作る前に書いた本文）は、一度きりの処理で入る。何度流しても同じ
	run("INSERT INTO issues (user_id, title, affected, example, created_at) VALUES ('u1', '前からある課題', '人', '特商法第11条の話', ?)", tick());
	const oldIssue = one<{ id: number }>('SELECT max(id) AS id FROM issues').id;
	run("INSERT INTO solutions (issue_id, user_id, body, created_at) VALUES (?, 'u2', '特商法11条を直す', ?)", oldIssue, tick());
	const oldSolution = one<{ id: number }>('SELECT max(id) AS id FROM solutions').id;
	run(
		"INSERT INTO posts (bill_id, session_key, kind, parent_id, user_id, role, body, created_at) VALUES (?, ?, 'question', NULL, 'u2', NULL, '特商法第十一条はどうなりますか', ?)",
		amend,
		session.key,
		tick()
	);
	const oldQuestion = one<{ id: number }>('SELECT max(id) AS id FROM posts').id;
	const before = one<{ n: number }>('SELECT count(*) AS n FROM law_refs').n;
	await backfillLawRefs(db);
	await backfillLawRefs(db);
	expect(one<{ n: number }>('SELECT count(*) AS n FROM law_refs').n).toBe(before + 3);
	const eleven = await articleBacklinks(db, { lawId: LAW, num: '11', playable: true }, NOW, null);
	expect(eleven.discussions.map((d) => d.href)).toEqual([
		`/houan/${amend}/shitsugi#shitsugi-${oldQuestion}`,
		`/kadai/${oldIssue}/kaiketsu#kaiketsu-${oldSolution}`,
		`/kadai/${oldIssue}`
	]);
});
