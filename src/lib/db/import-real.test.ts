// Issue #95 基準1・2・4・5：現実の改正の取り込みと衝突（設計書 docs/spec/95.md）。現実の版はテストの法令を実際の同期で入れる（e-Gov は呼ばない）
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { expect, test, vi } from 'vitest';
import { sessionAt, type Session } from '../domain/session';
import type { FetchJson } from '../egov/client';
import { ifArticles, ifHeadOf, ifLawPage, importReal, currentNumsOf, pinnedRevision, proposeBlock, staleArticles } from '../server/if-world';
import { articlesOfRevision, provisionsAt } from '../server/law';
import { syncLaw } from '../server/law-sync';
import { runSessionEnd, settleSession } from '../server/results';
import { openMemoryDb, type MemoryDb } from './memory';
import { seedStatements } from './seed';

const jst = (s: string) => Date.parse(`${s}+09:00`);
const monthOf = (key: string) => sessionAt(jst(`${key}-10T00:00:00`), null);
const previousOf = (s: Session) => sessionAt(s.startsAt - 1, null);
const nextOf = (s: Session) => sessionAt(s.endsAt, null);
const after = (s: Session) => s.endsAt + 60_000;

/** 条ごとに別の漢字を並べた本文（似ている度合いが条のあいだで0になる）。末尾の足しは同じ条の改正になる */
const textOf = (n: number, tail = '') => String.fromCodePoint(0x4e00 + n * 97).repeat(40) + tail;
type A = { num: string; text: string; caption?: string };
const articles = (nums: number[]) => nums.map((n): A => ({ num: String(n), text: textOf(n) }));

const lawNode = (rows: A[]) => ({
	tag: 'Law',
	children: [
		{
			tag: 'LawBody',
			children: [
				{
					tag: 'MainProvision',
					children: rows.map((a) => ({
						tag: 'Article',
						attr: { Num: a.num },
						children: [...((a.caption ?? '（見出し）') ? [{ tag: 'ArticleCaption', children: [a.caption ?? '（見出し）'] }] : []), { tag: 'Paragraph', attr: { Num: '1' }, children: [{ tag: 'ParagraphSentence', children: [a.text] }] }]
					}))
				}
			]
		}
	]
});

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

	/** 現実の法令。起点の版は 2017-01-01 に施行済み。revise は版を足して実際の同期を通す */
	async function addLaw(base: A[]) {
		const lawId = `L${unique()}`;
		const row = (id: string, date: string, status: string) => ({
			law_revision_id: id,
			law_title: `法令${lawId}`,
			law_title_kana: null,
			amendment_enforcement_date: date,
			amendment_law_title: `${id}の改正法`,
			amendment_law_num: null,
			amendment_promulgate_date: date,
			current_revision_status: status,
			repeal_status: 'None'
		});
		const baseId = `${lawId}_base`;
		const list = [row(baseId, '2017-01-01', 'CurrentEnforced')];
		const texts = new Map<string, A[]>([[baseId, base]]);
		const fetchJson: FetchJson = async (url) => {
			if (url.includes('/law_revisions/')) return { law_info: { law_num: '番号' }, revisions: [...list].reverse() };
			const id = decodeURIComponent(url.split('/').at(-1) as string);
			return { revision_info: { law_revision_id: id }, law_full_text: lawNode(texts.get(id) as A[]) };
		};
		const load = (name: string) => (name.startsWith('law_revisions_') ? { law_info: { law_num: '番号' }, revisions: [...list].reverse() } : { law_full_text: lawNode(base) });
		const next = sqlite.prepare('SELECT (SELECT COALESCE(MAX(id), 0) + 1 FROM provisions) AS provisionId, (SELECT COALESCE(MAX(id), 0) + 1 FROM provision_versions) AS versionId').get() as { provisionId: number; versionId: number };
		for (const statement of seedStatements([lawId], load, next)) sqlite.exec(statement);
		await syncLaw(db, lawId, fetchJson);
		let n = 0;
		return {
			lawId,
			baseId,
			fetchJson,
			list,
			/** 版を足す（before を渡すとその版の前に入れる）。同期まで通す */
			async revise(date: string, rows: A[], status = 'PreviousEnforced', before?: string) {
				const id = `${lawId}_r${++n}`;
				texts.set(id, rows);
				const at = before ? list.findIndex((r) => r.law_revision_id === before) : list.length;
				list.splice(at, 0, row(id, date, status));
				await syncLaw(db, lawId, fetchJson);
				return id;
			},
			async sync() {
				return syncLaw(db, lawId, fetchJson);
			}
		};
	}
	type Law = Awaited<ReturnType<typeof addLaw>>;

	const idOf = async (revisionId: string, num: string) => (await articlesOfRevision(db, revisionId)).find((a) => a.num === num)!.id;
	const para = (text: string) => JSON.stringify([{ num: '1', text, items: [] }]);

	type Change = { num: string; op: 'amend' | 'add' | 'delete'; provisionId?: number | null; text?: string; caption?: string };
	function addBill(s: Session, law: Law, changes: Change[], opts: { action?: 'amend' | 'repeal'; baseIfSeq?: number; order?: number } = {}) {
		const action = opts.action ?? 'amend';
		const id = Number(
			sqlite
				.prepare("INSERT INTO bills (user_id, committee_id, kind, status, rev, next_rev, proposed_rev, title, affected, side_effects, created_at, updated_at, proposed_at) VALUES (?, 1, ?, 'proposed', 1, 2, 1, ?, 'a', 's', 0, 0, ?)")
				.run(addUser(), action, `法案${unique()}`, s.startsAt + (opts.order ?? unique())).lastInsertRowid
		);
		sqlite.prepare('INSERT INTO bill_laws (bill_id, rev, seq, action, law_id, base_revision_id, base_if_seq) VALUES (?, 1, 0, ?, ?, ?, ?)').run(id, action, law.lawId, law.baseId, opts.baseIfSeq ?? 0);
		sqlite.prepare('INSERT INTO bill_solutions (bill_id, rev, seq, solution_id) VALUES (?, 1, 0, 1)').run(id);
		for (const c of changes) {
			sqlite
				.prepare('INSERT INTO bill_changes (bill_id, rev, law_seq, num, op, provision_id, caption, body) VALUES (?, 1, 0, ?, ?, ?, ?, ?)')
				.run(id, c.num, c.op, c.op === 'add' ? null : (c.provisionId ?? null), c.caption ?? '（見出し）', c.op === 'delete' ? null : para(c.text ?? '本文'));
		}
		return id;
	}
	function vote(s: Session, bill: number, choice: 'yes' | 'no' = 'yes') {
		for (let i = 0; i < 10; i++) {
			const voter = addUser();
			sqlite.prepare("INSERT INTO actions (kind, user_id, ip_hash, created_at) VALUES ('issue_post', ?, 'x', 0)").run(voter);
			sqlite.prepare('INSERT INTO votes (session_key, bill_id, user_id, choice, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 0)').run(s.key, bill, voter, choice);
		}
	}
	const fix = (s: Session) => sqlite.prepare('INSERT OR IGNORE INTO session_participants (committee_id, session_key, active_count, fixed_at) VALUES (1, ?, 0, 0)').run(s.key);
	/** 法案を可決して反映する（実際の会期の処理） */
	async function pass(s: Session, law: Law, changes: Change[], opts: { action?: 'amend' | 'repeal'; baseIfSeq?: number } = {}) {
		const bill = addBill(s, law, changes, opts);
		vote(s, bill);
		fix(s);
		await settleSession(db, s, previousOf(s), after(s), null);
		return bill;
	}
	const latest = async (law: Law) => {
		const head = await ifHeadOf(db, law.lawId);
		return ifArticles(db, law.lawId, head.branchRevisionId as string, head.seq);
	};
	const bodyOf = async (law: Law, num: string) => (await latest(law)).find((a) => a.num === num)?.paragraphs[0].text;
	type Row = Record<string, string | number | null>;
	const records = (law: Law) => sqlite.prepare('SELECT * FROM if_import_articles WHERE law_id = ?').all(law.lawId) as Row[];
	const record = (law: Law, num: string, conflict?: number) => records(law).filter((r) => r.num === num && (conflict === undefined || r.conflict === conflict));
	const imports = (law: Law) => sqlite.prepare('SELECT seq, revision_id AS revisionId, session_key AS sessionKey FROM if_imports WHERE law_id = ? ORDER BY seq').all(law.lawId) as { seq: number; revisionId: string; sessionKey: string }[];
	return { sqlite, db: db as MemoryDb, addLaw, addBill, vote, fix, pass, idOf, latest, bodyOf, records, record, imports };
}

test('基準1：0018 で表が増え、既存の行は残り、IF世界の版の番号は反映と取り込みで重ならない', async () => {
	const old = new DatabaseSync(':memory:');
	old.exec('PRAGMA foreign_keys = ON');
	const dir = new URL('../../../drizzle/', import.meta.url);
	const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
	for (const f of files.filter((f) => f < '0018')) old.exec(readFileSync(new URL(f, dir), 'utf8'));
	old.exec("INSERT INTO laws (id, title, law_num) VALUES ('L', 'T', 'N'); INSERT INTO law_revisions (id, law_id, branch, seq, enforcement_date, status) VALUES ('R', 'L', 'real', 0, '2020-01-01', 'enforced'); INSERT INTO if_branches (law_id, revision_id, created_at) VALUES ('L', 'R', 0)");
	const later = files.filter((f) => f >= '0018');
	expect(later.length).toBeGreaterThan(0);
	for (const f of later) old.exec(readFileSync(new URL(f, dir), 'utf8'));
	expect(old.prepare('SELECT revision_id AS r FROM if_branches').get()).toEqual({ r: 'R' });
	for (const table of ['if_imports', 'if_import_articles', 'if_import_runs']) expect(old.prepare(`SELECT count(*) AS n FROM ${table}`).get()).toEqual({ n: 0 });

	const w = world();
	const s = monthOf('2030-05');
	const next = nextOf(s);
	const law = await w.addLaw(articles([1, 2, 3]));
	await w.pass(s, law, [{ num: '1', op: 'amend', provisionId: await w.idOf(law.baseId, '1'), text: 'IFの本文1' }]);
	await law.revise('2030-05-20', [{ num: '1', text: textOf(1) }, { num: '2', text: textOf(2, 'を改める') }, { num: '3', text: textOf(3) }]);
	await importReal(w.db, s, after(s));
	const head = await ifHeadOf(w.db, law.lawId);
	await w.pass(next, law, [{ num: '3', op: 'amend', provisionId: await w.idOf(law.baseId, '3'), text: 'IFの本文3' }], { baseIfSeq: head.seq });
	const seqs = [
		...(w.sqlite.prepare('SELECT seq FROM if_revisions WHERE law_id = ?').all(law.lawId) as { seq: number }[]),
		...(w.sqlite.prepare('SELECT seq FROM if_imports WHERE law_id = ?').all(law.lawId) as { seq: number }[])
	].map((r) => r.seq);
	expect(seqs.sort()).toEqual([1, 2, 3]);
	expect((await ifHeadOf(w.db, law.lawId)).seq).toBe(3);
}, 60_000);

test('基準2：変わった条を IF世界に取り込み、ぶつかった条文を記録する', async () => {
	const w = world();
	const s = monthOf('2030-05');
	const nums = [1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 15];
	const law = await w.addLaw(articles(nums));
	const id = (num: string) => w.idOf(law.baseId, num);
	const bill = await w.pass(s, law, [
		{ num: '2', op: 'amend', provisionId: await id('2'), text: 'IFの本文2' },
		{ num: '4', op: 'amend', provisionId: await id('4'), text: 'IFの本文4' },
		{ num: '5', op: 'amend', provisionId: await id('5'), text: textOf(5, 'を改める') },
		{ num: '7', op: 'delete', provisionId: await id('7') },
		{ num: '8', op: 'amend', provisionId: await id('8'), text: 'IFの本文8' },
		{ num: '9', op: 'delete', provisionId: await id('9') },
		{ num: '10', op: 'add', text: 'IFで足した第10条' },
		{ num: '13', op: 'delete', provisionId: await id('13') },
		{ num: '23', op: 'add', text: 'IFで足した第23条' }
	]);
	const id3 = await id('3');
	const id6 = await id('6');
	await law.revise('2030-05-31', [
		{ num: '1', text: textOf(1, 'を改める') }, // 本文の変更。IF世界で変えていない
		{ num: '2', text: textOf(2, 'を改める') }, // 両方で変えた
		{ num: '4_2', text: textOf(4) }, // 番号だけの変更。IF世界で変えた
		{ num: '5', text: textOf(5, 'を改める') }, // 同じ中身
		{ num: '6', text: textOf(60) }, // 内部IDが変わる。IF世界で変えていない
		{ num: '9', text: textOf(9, 'を改める') }, // IF世界で削除した
		{ num: '10', text: textOf(10) }, // 足す番号が同じ
		{ num: '11', text: textOf(11) }, // 変わらない
		{ num: '13', text: '削除', caption: '' }, // 現実も「削除」にした。IF世界で削除した
		{ num: '20', text: textOf(3) }, // 番号だけの変更。IF世界で変えていない
		{ num: '23', text: textOf(15) }, // 繰り下げた先の番号に IF世界で足した条がある
		{ num: '30', text: textOf(30) } // 足した
		// 第7条（両方で削除）、第8条（IF世界で変えた）、第12条（IF世界で変えていない）は現実でなくなった
	]);
	await importReal(w.db, s, after(s));

	// 変えていない条は現実に従う（番号だけの変更も、内部IDが変わった条も）
	expect(await w.bodyOf(law, '1')).toBe(textOf(1, 'を改める'));
	expect(await w.bodyOf(law, '20')).toBe(textOf(3));
	expect(await w.bodyOf(law, '3')).toBeUndefined();
	expect(await w.bodyOf(law, '6')).toBe(textOf(60));
	expect(await w.bodyOf(law, '12')).toBeUndefined();
	expect(await w.bodyOf(law, '30')).toBe(textOf(30));
	expect(w.record(law, '20')).toMatchObject([{ change: 'renumbered', conflict: 0, prev_num: '3', provision_id: id3 }]);
	expect(w.record(law, '6')).toMatchObject([{ change: 'amended', conflict: 0, closed_provision_id: id6 }]);
	expect(w.records(law).filter((r) => r.change === 'removed').map((r) => r.num).sort()).toEqual(['12', '7', '8']);
	expect(w.record(law, '30')).toMatchObject([{ change: 'added', conflict: 0, real_body: null }]);
	expect(w.record(law, '11')).toEqual([]);

	// 両方で変えた条は IF世界が残り、当時の条文が記録される
	expect(await w.bodyOf(law, '2')).toBe('IFの本文2');
	expect(w.record(law, '2')).toMatchObject([{ change: 'amended', conflict: 1, real_body: textOf(2, 'を改める'), real_caption: '（見出し）', if_num: '2', if_body: 'IFの本文2', if_caption: '（見出し）', bill_id: bill }]);
	// 番号だけの変更でも、IF世界で変えた条は IF世界の番号のまま残る
	expect(await w.bodyOf(law, '4')).toBe('IFの本文4');
	expect(await w.bodyOf(law, '4_2')).toBeUndefined();
	expect(w.record(law, '4_2')).toMatchObject([{ change: 'renumbered', conflict: 1, prev_num: '4', if_num: '4', if_body: 'IFの本文4' }]);
	// 現実でなくなった条を IF世界で変えていた
	expect(await w.bodyOf(law, '8')).toBe('IFの本文8');
	expect(w.record(law, '8')).toMatchObject([{ change: 'removed', conflict: 1, real_body: null, if_body: 'IFの本文8' }]);
	// IF世界で削除した条を現実が変えた
	expect(await w.bodyOf(law, '9')).toBe('削除');
	expect(w.record(law, '9')).toMatchObject([{ change: 'amended', conflict: 1, real_body: textOf(9, 'を改める'), if_body: null }]);
	// 番号の衝突：IF世界の条が残り、隠れた現実の条が記録される
	expect(await w.bodyOf(law, '10')).toBe('IFで足した第10条');
	expect(w.record(law, '10')).toMatchObject([{ change: 'added', conflict: 1, real_body: textOf(10), if_num: '10', if_body: 'IFで足した第10条' }]);
	expect(await w.bodyOf(law, '23')).toBe('IFで足した第23条');
	expect(w.record(law, '23')).toMatchObject([{ change: 'renumbered', conflict: 1, prev_num: '15', real_body: textOf(15), if_body: 'IFで足した第23条' }]);
	// 中身と番号が同じなら衝突にしない（同じ改正、両方で削除、現実の「削除」と IF世界の削除）
	expect(w.record(law, '5', 1)).toEqual([]);
	expect(w.record(law, '7')).toMatchObject([{ change: 'removed', conflict: 0 }]);
	expect(await w.bodyOf(law, '7')).toBe('削除');
	expect(w.record(law, '13', 1)).toEqual([]);
	expect(await w.bodyOf(law, '13')).toBe('削除');

	// 取り込みの前の版の条は変わらない（基にした版を読むので）
	const before = await ifArticles(w.db, law.lawId, law.baseId, (await ifHeadOf(w.db, law.lawId)).seq - 1);
	expect(before.find((a) => a.num === '1')?.paragraphs[0].text).toBe(textOf(1));
	// 目次も取り込んだ版を読み、ページの条に印が付く
	const page = await ifLawPage(w.db, law.lawId);
	expect(page?.articles.find((a) => a.num === '2')).toMatchObject({ conflict: true });
	expect(page?.articles.find((a) => a.num === '1')).toMatchObject({ conflict: false });

	// 範囲：その会期の最終日までに施行された版だけ。途中の版が施行予定なら後ろも取り込まない
	const range = world();
	const inRange = await range.addLaw(articles([1]));
	const v1 = await inRange.revise('2030-05-31', [{ num: '1', text: textOf(1, '一') }]);
	await inRange.revise('2030-06-01', [{ num: '1', text: textOf(1, '二') }]);
	const held = await range.addLaw(articles([1]));
	await held.revise('2030-05-10', [{ num: '1', text: textOf(1, '一') }], 'UnEnforced');
	await held.revise('2030-05-20', [{ num: '1', text: textOf(1, '二') }]);
	const repealed = await range.addLaw(articles([1]));
	await range.pass(s, repealed, [], { action: 'repeal' });
	await repealed.revise('2030-05-20', [{ num: '1', text: textOf(1, '一') }]);
	const late = await range.addLaw(articles([1]));
	const failing = await range.addLaw(articles([1]));
	const failed = await failing.revise('2030-05-20', [{ num: '1', text: textOf(1, '一') }]);

	range.sqlite.exec(`CREATE TRIGGER fail_import BEFORE INSERT ON if_imports WHEN NEW.law_id = '${failing.lawId}' BEGIN SELECT RAISE(ABORT, '失敗'); END`);
	vi.spyOn(console, 'error').mockImplementation(() => undefined);
	await expect(importReal(range.db, s, after(s))).rejects.toThrow();
	vi.restoreAllMocks();
	expect(range.imports(inRange).map((i) => i.revisionId)).toEqual([v1]);
	expect(range.imports(held)).toEqual([]);
	expect(range.imports(repealed)).toEqual([]);

	// 1つの会期に1回：会期の途中で施行済みになった版は次の会期まで入らない。失敗した法令だけ次の日に続く
	const delayed = await late.revise('2030-05-25', [{ num: '1', text: textOf(1, '一') }]);
	range.sqlite.exec('DROP TRIGGER fail_import');
	await importReal(range.db, s, after(s) + 86_400_000);
	expect(range.imports(late)).toEqual([]);
	expect(range.imports(failing).map((i) => i.revisionId)).toEqual([failed]);
	const next = nextOf(s);
	await importReal(range.db, next, after(next));
	expect(range.imports(late)).toMatchObject([{ revisionId: delayed, sessionKey: next.key }]);
	expect(range.imports(inRange)).toHaveLength(2);

	// 読むときの処理では走らず、Cron でも反映が終わるまで走らない
	const cron = world();
	const cronLaw = await cron.addLaw(articles([1]));
	await cronLaw.revise('2030-05-20', [{ num: '1', text: textOf(1, '一') }]);
	const waiting = cron.addBill(s, cronLaw, [{ num: '1', op: 'amend', provisionId: await cron.idOf(cronLaw.baseId, '1'), text: 'IFの本文' }]);
	cron.vote(s, waiting);
	cron.fix(s);
	cron.sqlite.exec(`CREATE TRIGGER fail_result BEFORE INSERT ON bill_results BEGIN SELECT RAISE(ABORT, '失敗'); END`);
	vi.spyOn(console, 'error').mockImplementation(() => undefined);
	await expect(runSessionEnd(cron.db, after(s))).rejects.toThrow();
	vi.restoreAllMocks();
	expect(cron.imports(cronLaw)).toEqual([]);
	cron.sqlite.exec('DROP TRIGGER fail_result');
	await settleSession(cron.db, s, previousOf(s), after(s), null);
	expect(cron.imports(cronLaw)).toEqual([]);
	await runSessionEnd(cron.db, after(s));
	expect(cron.imports(cronLaw)).toHaveLength(1);
	// 反映が先：法案の版は取り込みより小さい番号
	expect(cron.sqlite.prepare('SELECT seq FROM if_revisions WHERE bill_id = ?').get(waiting)).toEqual({ seq: 1 });
	expect(cron.imports(cronLaw)[0].seq).toBe(2);
}, 120_000);

test('基準4：取り込みで変わった条に触れる下書きは確かめが要り、番号が変わっても同じ条を指し、可決までいくと要調整', async () => {
	const w = world();
	const s = monthOf('2030-05');
	const next = nextOf(s);
	const law = await w.addLaw(articles([1, 2, 3, 4, 5, 6]));
	const ids = Object.fromEntries(await Promise.all(['1', '2', '3', '4', '5', '6'].map(async (n) => [n, await w.idOf(law.baseId, n)])));
	const draft = (changes: { num: string; op: 'amend' | 'add' | 'delete'; provisionId: number | null }[]) => ({ action: 'amend' as const, lawId: law.lawId, baseRevisionId: law.baseId, baseIfSeq: 0, newTitle: null, changes });

	// 第2条が第20条へ、第3条が第2条へ移る。第4条は内部IDが2回変わる。第5条はなくなる。第7条ができる
	await law.revise('2030-05-10', [
		{ num: '1', text: textOf(1, 'を改める') },
		{ num: '2', text: textOf(3) },
		{ num: '4', text: textOf(40) },
		{ num: '6', text: textOf(6) },
		{ num: '7', text: textOf(7) },
		{ num: '20', text: textOf(2) }
	]);
	await law.revise('2030-05-20', [
		{ num: '1', text: textOf(1, 'を改める') },
		{ num: '2', text: textOf(3) },
		{ num: '4', text: textOf(41) },
		{ num: '6', text: textOf(6) },
		{ num: '7', text: textOf(7) },
		{ num: '20', text: textOf(2) }
	]);
	await importReal(w.db, s, after(s));

	// 変わった条に触れる下書きは、いまの条文が出て、発議を断られる
	const moved = draft([{ num: '2', op: 'amend', provisionId: ids['2'] }]);
	expect(await staleArticles(w.db, moved)).toMatchObject([{ num: '20', body: textOf(2) }]);
	expect(await proposeBlock(w.db, { laws: [moved] })).toBe('stale');
	const amended = draft([{ num: '1', op: 'amend', provisionId: ids['1'] }]);
	expect(await staleArticles(w.db, amended)).toMatchObject([{ num: '1', body: textOf(1, 'を改める') }]);
	const gone = draft([{ num: '5', op: 'amend', provisionId: ids['5'] }]);
	expect(await staleArticles(w.db, gone)).toMatchObject([{ num: '5', body: '' }]);
	expect(await proposeBlock(w.db, { laws: [gone] })).toBe('stale');
	const addSame = draft([{ num: '7', op: 'add', provisionId: null }]);
	expect(await staleArticles(w.db, addSame)).toMatchObject([{ num: '7', body: textOf(7) }]);
	expect(await proposeBlock(w.db, { laws: [addSame] })).toBe('stale');
	const replaced = draft([{ num: '4', op: 'amend', provisionId: ids['4'] }]);
	expect(await staleArticles(w.db, replaced)).toMatchObject([{ num: '4', body: textOf(41) }]);
	// 変わっていない条だけなら確かめは要らない
	const quiet = draft([{ num: '6', op: 'amend', provisionId: ids['6'] }]);
	expect(await staleArticles(w.db, quiet)).toEqual([]);
	expect(await proposeBlock(w.db, { laws: [quiet] })).toBeNull();

	// 書く画面に出す番号：同じ内部IDの条のいまの番号。内部IDが続けて変わった条はいまの条の番号。なくなった条は null
	const nums = await currentNumsOf(w.db, law.lawId, [ids['2'], ids['3'], ids['4'], ids['5'], ids['6']]);
	expect(Object.fromEntries(nums)).toEqual({ [ids['2']]: '20', [ids['3']]: '2', [ids['4']]: '4', [ids['5']]: null, [ids['6']]: '6' });

	// 可決までいった法案は要調整。いまの版を基にした法案は反映される
	const head = await ifHeadOf(w.db, law.lawId);
	const stale = await w.pass(next, law, [{ num: '1', op: 'amend', provisionId: ids['1'], text: 'IFの本文1' }]);
	expect(w.sqlite.prepare('SELECT reason FROM bill_adjustments WHERE bill_id = ?').get(stale)).toEqual({ reason: 'article' });
	await w.pass(next, law, [{ num: '6', op: 'amend', provisionId: ids['6'], text: 'IFの本文6' }], { baseIfSeq: head.seq });
	expect(await w.bodyOf(law, '6')).toBe('IFの本文6');
	expect(await w.bodyOf(law, '1')).toBe(textOf(1, 'を改める'));
}, 60_000);

test('基準5：取り込んだ版までの内部IDは同期で変わらず、それより前に遅れて来た版は飛ばされる', async () => {
	const w = world();
	const s = monthOf('2030-05');
	const law = await w.addLaw(articles([1, 2]));
	const imported = await law.revise('2030-05-10', [{ num: '1', text: textOf(1, 'を改める') }, { num: '2', text: textOf(2) }, { num: '3', text: textOf(3) }]);
	const scheduled = await law.revise('2030-09-01', [{ num: '1', text: textOf(1, 'を改める') }, { num: '2', text: textOf(2) }, { num: '3', text: textOf(3) }, { num: '4', text: textOf(4) }], 'UnEnforced');
	expect(await pinnedRevision(w.db, law.lawId)).toBe(law.baseId);
	await importReal(w.db, s, after(s));
	expect(await pinnedRevision(w.db, law.lawId)).toBe(imported);

	const byId = async (revision: string) => [...(await provisionsAt(w.db, revision))].sort((a, b) => a.id - b.id);
	const pinned = await byId(imported);
	const revisions = () => (w.sqlite.prepare('SELECT id FROM law_revisions WHERE law_id = ? ORDER BY seq').all(law.lawId) as { id: string }[]).map((r) => r.id);

	// 固定の版より前に遅れて来た版は飛ばされ、より後の割り込みは入る
	const lateId = await law.revise('2030-05-05', [{ num: '1', text: textOf(1) }, { num: '2', text: textOf(2, 'を改める') }], 'PreviousEnforced', imported);
	expect(revisions()).not.toContain(lateId);
	expect(await law.sync()).toMatchObject({ skipped: [lateId] });
	const between = await law.revise('2030-08-01', [{ num: '1', text: textOf(1, 'を改める') }, { num: '2', text: textOf(2) }, { num: '3', text: textOf(3, 'を改める') }], 'UnEnforced', scheduled);
	const ids = revisions();
	expect(ids.indexOf(between)).toBeLessThan(ids.indexOf(scheduled));
	expect(ids.indexOf(imported)).toBeLessThan(ids.indexOf(between));
	expect(await byId(imported)).toEqual(pinned);
}, 60_000);
