// Issue #155 基準2〜5：公開ミラーの書き出し。会期の処理は Cron と同じ順（結果と反映 → 現実の改正の取り込み）で通す。
// バッチは一時的な git リポジトリに書き、GitHub には押さない
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, test } from 'vitest';
import { sessionAt, type Session } from '../domain/session';
import { runMirror } from '../mirror/batch';
import { importReal } from '../server/if-world';
import { mirrorSession, mirrorSessions } from '../server/mirror';
import { decideReview, settleSession } from '../server/results';
import { openMemoryDb, type MemoryDb } from './memory';

const jst = (s: string) => Date.parse(`${s}+09:00`);
const monthOf = (key: string) => sessionAt(jst(`${key}-10T00:00:00`), null);
const previousOf = (s: Session) => sessionAt(s.startsAt - 1, null);
const MINUTE = 60_000;
const after = (s: Session) => s.endsAt + MINUTE;
const para = (text: string) => JSON.stringify([{ num: '1', text, items: [] }]);

const dirs: string[] = [];
afterEach(() => {
	for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** 1つのテストの DB と、法令・法案・票を作る道具 */
function world() {
	const { sqlite, db } = openMemoryDb();
	let counter = 0;
	const unique = () => ++counter;
	const addUser = () => {
		const id = `u${unique()}`;
		sqlite.prepare('INSERT INTO user (id, name, email, created_at, updated_at) VALUES (?, ?, ?, 0, 0)').run(id, `名前${id}`, `${id}@test.invalid`);
		return id;
	};
	sqlite.exec("INSERT INTO user (id, name, email, created_at, updated_at) VALUES ('issuer', 'i', 'i@test.invalid', 0, 0); INSERT INTO issues (id, user_id, title, affected, example, topic_id, created_at) VALUES (1, 'issuer', '課題', '人', '例', NULL, 0); INSERT INTO solutions (id, issue_id, user_id, body, created_at) VALUES (1, 1, 'issuer', '解決策の中身', 0);");

	/** 委員会の対象の法令。条は3つ（第1条〜第3条） */
	const addLaw = () => {
		const n = unique();
		const lawId = `L${n}`;
		const revisionId = `R${n}`;
		sqlite.prepare("INSERT INTO laws (id, title, law_num) VALUES (?, ?, '番号')").run(lawId, `法令${n}`);
		sqlite.prepare("INSERT INTO law_revisions (id, law_id, branch, seq, enforcement_date, status) VALUES (?, ?, 'real', 0, '2020-01-01', 'enforced')").run(revisionId, lawId);
		sqlite.prepare('INSERT INTO committee_laws (committee_id, law_id) VALUES (1, ?)').run(lawId);
		const ids: Record<string, number> = {};
		for (const num of ['1', '2', '3']) {
			const article = Number(sqlite.prepare("INSERT INTO provisions (law_id, kind) VALUES (?, 'article')").run(lawId).lastInsertRowid);
			sqlite.prepare("INSERT INTO provision_versions (provision_id, from_revision_id, num, caption, change) VALUES (?, ?, ?, '（見出し）', 'baseline')").run(article, revisionId, num);
			const paragraph = Number(sqlite.prepare("INSERT INTO provisions (law_id, kind, parent_id) VALUES (?, 'paragraph', ?)").run(lawId, article).lastInsertRowid);
			sqlite.prepare("INSERT INTO provision_versions (provision_id, from_revision_id, num, text, change) VALUES (?, ?, '1', ?, 'baseline')").run(paragraph, revisionId, `第${num}条のもとの本文`);
			ids[num] = article;
		}
		return { lawId, revisionId, title: `法令${n}`, ids };
	};
	type Law = ReturnType<typeof addLaw>;
	type Change = { num: string; op: 'amend' | 'add' | 'delete'; provisionId?: number; text?: string };

	/** いまの IF世界の版の番号（法案はいまの IF世界を基にする） */
	const headSeq = (lawId: string) =>
		(sqlite.prepare('SELECT COALESCE(MAX(s), 0) AS n FROM (SELECT seq AS s FROM if_revisions WHERE law_id = ? UNION ALL SELECT seq AS s FROM if_imports WHERE law_id = ?)').get(lawId, lawId) as { n: number }).n;
	/** 発議して10人が賛成した法案（可決する）。enact は新法の題名 */
	const passBill = (s: Session, law: Law | null, changes: Change[], opts: { action?: 'amend' | 'repeal' | 'enact'; newTitle?: string } = {}) => {
		const action = opts.action ?? 'amend';
		const author = addUser();
		const title = `法案の題名${unique()}`;
		const id = Number(
			sqlite
				.prepare("INSERT INTO bills (user_id, committee_id, kind, status, rev, next_rev, proposed_rev, title, affected, side_effects, created_at, updated_at, proposed_at) VALUES (?, 1, ?, 'proposed', 1, 2, 1, ?, '影響の中身', '副作用の中身', 0, 0, ?)")
				.run(author, action, title, s.startsAt + unique()).lastInsertRowid
		);
		sqlite
			.prepare('INSERT INTO bill_laws (bill_id, rev, seq, action, law_id, base_revision_id, new_title, base_if_seq) VALUES (?, 1, 0, ?, ?, ?, ?, ?)')
			.run(id, action, law?.lawId ?? null, law?.revisionId ?? null, action === 'enact' ? (opts.newTitle ?? `新法${unique()}`) : null, law ? headSeq(law.lawId) : 0);
		sqlite.prepare('INSERT INTO bill_solutions (bill_id, rev, seq, solution_id) VALUES (?, 1, 0, 1)').run(id);
		for (const c of changes) {
			sqlite
				.prepare("INSERT INTO bill_changes (bill_id, rev, law_seq, num, op, provision_id, caption, body) VALUES (?, 1, 0, ?, ?, ?, '（見出し）', ?)")
				.run(id, c.num, c.op, c.provisionId ?? null, c.op === 'delete' ? null : para(c.text ?? '本文'));
		}
		for (let i = 0; i < 10; i++) {
			const voter = addUser();
			sqlite.prepare("INSERT INTO actions (kind, user_id, ip_hash, created_at) VALUES ('issue_post', ?, 'x', 0)").run(voter);
			sqlite.prepare("INSERT INTO votes (session_key, bill_id, user_id, choice, created_at, updated_at) VALUES (?, ?, ?, 'yes', 0, 0)").run(s.key, id, voter);
		}
		return { id, author, title };
	};
	/** 票の偏りで確認中にする（結果を記録する前に入れる） */
	const hold = (s: Session, billId: number) =>
		sqlite.prepare("INSERT INTO vote_reviews (session_key, bill_id, signals, detail, status, created_at) VALUES (?, ?, '[]', '{}', 'open', 0)").run(s.key, billId);
	/** Cron と同じ順：結果と反映のあと、現実の改正の取り込み */
	const close = async (s: Session) => {
		sqlite.prepare('INSERT OR IGNORE INTO session_participants (committee_id, session_key, active_count, fixed_at) VALUES (1, ?, 0, 0)').run(s.key);
		expect(await settleSession(db, s, previousOf(s), after(s), null)).toBe(true);
		await importReal(db, s, after(s));
	};
	const confirm = (s: Session, billId: number, now: number) => decideReview(db, { userId: 'staff', role: 'operator' }, s.key, billId, 'confirm', null, now, null);
	return { sqlite, db, addLaw, passBill, hold, close, confirm };
}

type Snapshot = Awaited<ReturnType<typeof mirrorSession>>;
const lawOf = (snapshot: Snapshot, lawId: string) => snapshot?.laws.find((l) => l.id === lawId);
const bodyOf = (snapshot: Snapshot, lawId: string, num: string) => lawOf(snapshot, lawId)?.articles.find((a) => a.num === num)?.paragraphs[0].text;

/** Worker の書き出しの入口と同じ中身を返す（HTTP の代わり） */
const serve = (db: MemoryDb, now: () => number) => async (path: string) => {
	const url = new URL(path, 'http://mirror.test');
	if (url.pathname === '/mirror') return { sessions: await mirrorSessions(db, now(), url.searchParams.get('after')) };
	const snapshot = await mirrorSession(db, url.pathname.slice('/mirror/'.length), now());
	if (!snapshot) throw new Error(`404 ${path}`);
	return snapshot;
};

const git = (dir: string, ...args: string[]) => execFileSync('git', ['-c', 'core.quotePath=false', ...args], { cwd: dir, encoding: 'utf8' });
/** ミラーのリポジトリ（押す先は空の bare リポジトリ） */
function mirrorRepo() {
	const root = mkdtempSync(join(tmpdir(), 'osrippo-mirror-'));
	dirs.push(root);
	const remote = join(root, 'remote.git');
	const dir = join(root, 'work');
	execFileSync('git', ['init', '--bare', '-q', remote]);
	execFileSync('git', ['init', '-q', dir]);
	git(dir, 'remote', 'add', 'origin', remote);
	return { dir, remote };
}
const subjects = (dir: string) => git(dir, 'log', '--reverse', '--format=%s').trim().split('\n');

test('基準2：確定した会期だけを古い順に返す。確認中の法案がある会期とそのあと、終わっていない会期は入らない', async () => {
	const w = world();
	const law = w.addLaw();
	const [a, b, c, d] = ['2301-04', '2301-05', '2301-06', '2301-07'].map(monthOf);
	w.passBill(a, law, [{ num: '1', op: 'amend', provisionId: law.ids['1'], text: '4月の本文' }]);
	await w.close(a);
	const held = w.passBill(b, law, [{ num: '2', op: 'amend', provisionId: law.ids['2'], text: '5月の本文' }]);
	w.hold(b, held.id);
	await w.close(b);
	w.passBill(c, law, [{ num: '3', op: 'amend', provisionId: law.ids['3'], text: '6月の本文' }]);
	await w.close(c);

	// 5月に確認中の法案があるので、4月だけ（6月は5月が確定するまで待つ）
	expect(await mirrorSessions(w.db, after(c), null)).toEqual(['2301-04']);

	await w.confirm(b, held.id, after(c));
	expect(await mirrorSessions(w.db, after(c), null)).toEqual(['2301-04', '2301-05', '2301-06']);
	expect(await mirrorSessions(w.db, after(c), '2301-04')).toEqual(['2301-05', '2301-06']);
	// 終わっていない会期は入らない（7月は取り込みもまだ。6月の終わりより前の時刻なら6月も入らない）
	expect(await mirrorSession(w.db, d.key, after(c))).toBeUndefined();
	expect(await mirrorSessions(w.db, c.endsAt - 1, null)).toEqual(['2301-04', '2301-05']);
	// 確定していない会期の中身は返さない
	const x = world();
	const lawX = x.addLaw();
	const heldX = x.passBill(a, lawX, [{ num: '1', op: 'amend', provisionId: lawX.ids['1'], text: '確認中' }]);
	x.hold(a, heldX.id);
	await x.close(a);
	expect(await mirrorSession(x.db, '2301-04', after(a))).toBeUndefined();
});

test('基準3：その会期を終えた時点の IF世界の法令。あとの会期の改正は入らない。法案・解決策・ユーザー名・投稿の中身を含まない', async () => {
	const w = world();
	const law = w.addLaw();
	const repealed = w.addLaw();
	const [a, b] = ['2302-04', '2302-05'].map(monthOf);
	const first = w.passBill(a, law, [{ num: '1', op: 'amend', provisionId: law.ids['1'], text: '4月に書きかえた本文' }]);
	// 4月の確認中の法案は、5月の処理のあとで確定する（反映は5月の法案より後になる）
	const late = w.passBill(a, law, [{ num: '2', op: 'amend', provisionId: law.ids['2'], text: 'あとで確定した4月の本文' }]);
	w.hold(a, late.id);
	const enact = w.passBill(a, null, [{ num: '1', op: 'add', text: '新法の本文' }], { action: 'enact', newTitle: '新しい法律' });
	await w.close(a);
	const second = w.passBill(b, law, [{ num: '1', op: 'amend', provisionId: law.ids['1'], text: '5月に書きかえた本文' }]);
	const repeal = w.passBill(b, repealed, [], { action: 'repeal' });
	await w.close(b);
	await w.confirm(a, late.id, after(b));

	const april = await mirrorSession(w.db, '2302-04', after(b));
	expect(april?.key).toBe('2302-04');
	expect(lawOf(april, law.lawId)?.title).toBe(law.title);
	expect(lawOf(april, law.lawId)?.articles.map((x) => x.num)).toEqual(['1', '2', '3']);
	expect(lawOf(april, law.lawId)?.articles[0]).toEqual({ num: '1', caption: '（見出し）', paragraphs: [{ num: '1', text: '4月に書きかえた本文', items: [] }] });
	expect(bodyOf(april, law.lawId, '2')).toBe('あとで確定した4月の本文');
	expect(bodyOf(april, law.lawId, '3')).toBe('第3条のもとの本文');
	expect(lawOf(april, repealed.lawId)).toBeDefined();
	expect(lawOf(april, `if-${enact.id}`)).toEqual({ id: `if-${enact.id}`, title: '新しい法律', enacted: true, articles: [{ num: '1', caption: '（見出し）', paragraphs: [{ num: '1', text: '新法の本文', items: [] }] }] });

	const may = await mirrorSession(w.db, '2302-05', after(b));
	expect(bodyOf(may, law.lawId, '1')).toBe('5月に書きかえた本文');
	expect(bodyOf(may, law.lawId, '2')).toBe('あとで確定した4月の本文');
	expect(lawOf(may, repealed.lawId)).toBeUndefined();
	expect(lawOf(may, `if-${enact.id}`)).toBeDefined();

	const text = JSON.stringify([april, may]);
	for (const bill of [first, late, enact, second, repeal]) {
		expect(text).not.toContain(bill.title);
		expect(text).not.toContain(bill.author);
	}
	for (const word of ['名前', '解決策の中身', '影響の中身', '副作用の中身', '課題', 'bill', 'user']) expect(text).not.toContain(word);
});

test('基準4：バッチは法令ごとのフォルダに1条1ファイルと README を書き、会期ごとに1コミットする。押さない指定では push しない。もう一度流すと続きだけ', async () => {
	const w = world();
	const law = w.addLaw();
	const [a, b, c] = ['2303-04', '2303-05', '2303-06'].map(monthOf);
	w.passBill(a, law, [{ num: '1', op: 'amend', provisionId: law.ids['1'], text: '4月の本文' }]);
	await w.close(a);
	await w.close(b);
	let now = after(b);
	const { dir, remote } = mirrorRepo();

	expect(await runMirror({ dir, fetchJson: serve(w.db, () => now), push: false })).toEqual(['2303-04', '2303-05']);
	expect(subjects(dir)).toEqual(['2303年4月の会期', '2303年5月の会期']);
	expect(git(dir, 'log', '-1', '--format=%an')).toBe('オープンソース立法府 投稿者一同\n');
	expect(git(dir, 'status', '--porcelain')).toBe('');
	expect(readFileSync(join(dir, law.lawId, '第1条.md'), 'utf8')).toBe('# 第1条　（見出し）\n\n4月の本文\n');
	expect(readFileSync(join(dir, law.lawId, '第3条.md'), 'utf8')).toBe('# 第3条　（見出し）\n\n第3条のもとの本文\n');
	expect(readFileSync(join(dir, law.lawId, 'README.md'), 'utf8')).toContain(`# ${law.title}`);
	const readme = readFileSync(join(dir, 'README.md'), 'utf8');
	for (const word of ['CC BY 4.0', 'オープンソース立法府 投稿者一同', law.title, '架空の法令', '2303年5月の会期']) expect(readme).toContain(word);
	expect(readFileSync(join(dir, '.osrippo-mirror'), 'utf8').trim()).toBe('2303-05');
	// 押していない
	expect(git(remote, 'for-each-ref')).toBe('');

	// 同じ時点でもう一度：続きがないのでコミットしない
	expect(await runMirror({ dir, fetchJson: serve(w.db, () => now), push: false })).toEqual([]);
	// 次の会期が確定したら、その会期だけ
	await w.close(c);
	now = after(c);
	expect(await runMirror({ dir, fetchJson: serve(w.db, () => now), push: false })).toEqual(['2303-06']);
	expect(subjects(dir)).toEqual(['2303年4月の会期', '2303年5月の会期', '2303年6月の会期']);
	expect(git(remote, 'for-each-ref')).toBe('');
});

test('基準5：改正した条はファイルが変わり、廃止した法令はフォルダが消え、制定した新法はフォルダが増える', async () => {
	const w = world();
	const law = w.addLaw();
	const repealed = w.addLaw();
	const [a, b, c] = ['2304-04', '2304-05', '2304-06'].map(monthOf);
	await w.close(a);
	w.passBill(b, law, [{ num: '2', op: 'amend', provisionId: law.ids['2'], text: '5月に書きかえた本文' }]);
	const enact = w.passBill(b, null, [{ num: '1', op: 'add', text: '新法の本文' }], { action: 'enact', newTitle: '5月の新法' });
	await w.close(b);
	w.passBill(c, repealed, [], { action: 'repeal' });
	await w.close(c);
	const { dir } = mirrorRepo();
	await runMirror({ dir, fetchJson: serve(w.db, () => after(c)), push: false });

	const changed = (key: string) => {
		const hash = git(dir, 'log', '--format=%H', `--grep=${key}`).trim();
		return git(dir, 'show', '--name-status', '--format=', hash)
			.trim()
			.split('\n')
			.filter((line) => !/\.osrippo-mirror$|^M\tREADME\.md$/.test(line))
			.sort();
	};
	const newLaw = `if-${enact.id}`;
	expect(changed('2304年5月')).toEqual([`A\t${newLaw}/README.md`, `A\t${newLaw}/第1条.md`, `M\t${law.lawId}/第2条.md`]);
	expect(changed('2304年6月')).toEqual([`D\t${repealed.lawId}/README.md`, `D\t${repealed.lawId}/第1条.md`, `D\t${repealed.lawId}/第2条.md`, `D\t${repealed.lawId}/第3条.md`]);
	expect(existsSync(join(dir, repealed.lawId))).toBe(false);
	expect(readFileSync(join(dir, newLaw, '第1条.md'), 'utf8')).toBe('# 第1条　（見出し）\n\n新法の本文\n');
	expect(readFileSync(join(dir, 'README.md'), 'utf8')).toContain('5月の新法');
});
