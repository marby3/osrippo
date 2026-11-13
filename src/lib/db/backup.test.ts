// Issue #202（#198「バックアップと復元試験」基準1・2・3）：D1 の書き出しを、全文検索の表を除いた SQL にして置く・戻す・索引を作り直す。
// 本物の D1 の書き出し（wrangler d1 export --compatibility sqlite3_cli_only）は呼ばず、sqlite3 の .dump と同じ形の SQL をメモリ上の DB から作って渡す
import { afterEach, expect, test, vi } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { backupKey, runBackup } from '../backup/batch';
import { sessionAt } from '../domain/session';
import type { FetchJson } from '../egov/client';
import { createIssue, type Actor } from '../server/issues';
import { syncLaw } from '../server/law-sync';
import { setStance } from '../server/posts';
import { syncReadable } from '../server/readable-sync';
import { indexTexts } from '../server/search';
import { rebuildSearchIndex, writeIndexSql } from '../server/search-index';
import { solutionSearchSources } from '../domain/search';
import type { Db } from '../server/law';
import { openMemoryDb } from './memory';
import { seedStatements } from './seed';

const SHOHISHA = '412AC0000000061';
const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 10, 3, 3, 0);
const FTS = ['search_trigram', 'search_bigram', 'readable_search'];

type Row = Record<string, unknown>;
const all = (sqlite: DatabaseSync, sql: string) => sqlite.prepare(sql).all() as Row[];

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../../../tests/fixtures/egov/${name}.json`, import.meta.url), 'utf8'));

/** sqlite3 の .dump と同じ形（仮想表は sqlite_schema への INSERT、影の表は行ごとの INSERT、改行を含む文字列は replace(…, char(10))） */
function cliDump(sqlite: DatabaseSync): string {
	const out = ['PRAGMA foreign_keys=OFF;', 'BEGIN TRANSACTION;'];
	const quote = (s: string) => `'${s.replaceAll("'", "''")}'`;
	let writable = false;
	const tables = all(sqlite, "SELECT name, sql FROM sqlite_schema WHERE type = 'table' AND sql NOT NULL ORDER BY rowid") as { name: string; sql: string }[];
	for (const t of tables) {
		if (t.name === 'sqlite_sequence') continue;
		if (/^CREATE VIRTUAL TABLE/i.test(t.sql)) {
			if (!writable) out.push('PRAGMA writable_schema=ON;');
			writable = true;
			out.push(`INSERT INTO sqlite_schema(type,name,tbl_name,rootpage,sql)VALUES('table',${quote(t.name)},${quote(t.name)},0,${quote(t.sql)});`);
			continue;
		}
		out.push(`${t.sql};`);
		const columns = (all(sqlite, `SELECT name FROM pragma_table_info('${t.name}')`) as { name: string }[]).map((c) => c.name);
		const order = /WITHOUT ROWID/i.test(t.sql) ? '' : ' ORDER BY rowid';
		const rows = sqlite.prepare(`SELECT ${columns.map((c) => `quote("${c}")`).join(', ')} FROM "${t.name}"${order}`);
		rows.setReturnArrays(true);
		for (const values of rows.all() as unknown as string[][]) {
			const literal = values.map((v) => (v.startsWith("'") && v.includes('\n') ? `replace(${v.replaceAll('\n', '\\n')},'\\n',char(10))` : v));
			out.push(`INSERT INTO "${t.name}" VALUES(${literal.join(',')});`);
		}
	}
	for (const s of all(sqlite, "SELECT sql FROM sqlite_schema WHERE type IN ('index', 'trigger', 'view') AND sql NOT NULL ORDER BY rowid")) out.push(`${s.sql};`);
	if (writable) out.push('PRAGMA writable_schema=OFF;');
	const sequence = all(sqlite, "SELECT name, seq FROM sqlite_sequence ORDER BY name") as { name: string; seq: number }[];
	if (sequence.length) out.push('DELETE FROM sqlite_sequence;', ...sequence.map((s) => `INSERT INTO sqlite_sequence VALUES(${quote(s.name)},${s.seq});`));
	out.push('COMMIT;');
	return out.join('\n');
}

/** D1 にだけある表（マイグレーションの記録と、D1 の内部の表）を足す */
function likeD1(sqlite: DatabaseSync) {
	sqlite.exec('CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)');
	const files = readdirSync(new URL('../../../drizzle/', import.meta.url)).filter((f) => f.endsWith('.sql')).sort();
	for (const f of files) sqlite.prepare('INSERT INTO d1_migrations (name) VALUES (?)').run(f);
	sqlite.exec("CREATE TABLE _cf_KV (key TEXT PRIMARY KEY, value BLOB) WITHOUT ROWID; INSERT INTO _cf_KV VALUES ('k', X'00ff')");
}

const dirs: string[] = [];
afterEach(() => {
	for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
	vi.restoreAllMocks();
});

/** 書き出し → 変換 → 置く。置いた SQL の中身を返す */
async function backup(source: DatabaseSync, now = new Date(T0)) {
	const workDir = mkdtempSync(join(tmpdir(), 'osrippo-backup-'));
	dirs.push(workDir);
	const uploaded: { key: string; sql: string }[] = [];
	const result = await runBackup({
		env: 'staging',
		bucket: 'osrippo-backup',
		now,
		workDir,
		exportDb: async (path) => writeFileSync(path, cliDump(source)),
		upload: async (key, path) => void uploaded.push({ key, sql: readFileSync(path, 'utf8') })
	});
	expect(uploaded).toHaveLength(1);
	return { ...result, ...uploaded[0] };
}

/** マイグレーションを当てた新しい DB に戻す */
function restore(sql: string) {
	const target = openMemoryDb();
	target.sqlite.exec(sql);
	return target;
}

let users = 0;
function addUser(sqlite: DatabaseSync, registeredAt = T0 - 2 * DAY): Actor {
	const id = `u${++users}`;
	sqlite.prepare('INSERT INTO user (id, name, email, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(id, `参加者${id}`, `${id}@test.invalid`, registeredAt, registeredAt);
	return { userId: id, registeredAt, ipHash: `ip-${id}` };
}

/**
 * 解決策。createSolution は db.all の RETURNING を読むので、行を配列で返すメモリの DB では番号が取れない（law-backlinks.test.ts と同じ）。
 * ここでは createSolution と同じく、行を入れたあとに indexTexts で索引を書く
 */
async function createSolution(db: Db, sqlite: DatabaseSync, actor: Actor, issueId: number, body: string, at: number) {
	const id = Number(sqlite.prepare('INSERT INTO solutions (issue_id, user_id, body, created_at) VALUES (?, ?, ?, ?)').run(issueId, actor.userId, body, at).lastInsertRowid);
	await indexTexts(db, 'solution', id, solutionSearchSources({ body }));
	return id;
}

function addBill(sqlite: DatabaseSync, author: string) {
	return Number(
		sqlite
			.prepare("INSERT INTO bills (user_id, committee_id, kind, status, rev, next_rev, title, affected, side_effects, created_at, updated_at) VALUES (?, 1, 'amend', 'proposed', 1, 2, ?, 'a', 's', 0, 0)")
			.run(author, "法案の題名（'引用'と\n改行）").lastInsertRowid
	);
}

/** 表の中身（rowid も含めて）。行の順によらずに比べる */
function contents(sqlite: DatabaseSync, table: string) {
	const sql = (all(sqlite, `SELECT sql FROM sqlite_schema WHERE name = '${table}'`)[0]?.sql as string) ?? '';
	const rowid = /WITHOUT ROWID/i.test(sql) ? '' : 'rowid AS _rowid_, ';
	return all(sqlite, `SELECT ${rowid}* FROM "${table}"`)
		.map((r) => JSON.stringify(r))
		.sort();
}

/** 戻す対象の表：全文検索の仮想表とその影の表、sqlite_ の表、D1 のマイグレーションの記録と内部の表を除いた全部 */
function expectedTables(sqlite: DatabaseSync) {
	const tables = all(sqlite, "SELECT name, sql FROM sqlite_schema WHERE type = 'table'") as { name: string; sql: string }[];
	const virtual = tables.filter((t) => /^CREATE VIRTUAL TABLE/i.test(t.sql)).map((t) => t.name);
	expect(virtual.sort()).toEqual([...FTS].sort());
	return tables
		.map((t) => t.name)
		.filter((n) => !n.startsWith('sqlite_') && !n.startsWith('_cf_') && n !== 'd1_migrations' && !virtual.some((v) => n === v || n.startsWith(`${v}_`)))
		.sort();
}

test('基準1：書き出しから全文検索の表を除いた SQL を日付ごとに置き、それを新しい DB に流すと、ほかの表が全部元どおりになる。失敗は例外になる', async () => {
	const { sqlite, db } = openMemoryDb();
	for (const statement of seedStatements([SHOHISHA], fixture)) sqlite.exec(statement);
	const author = addUser(sqlite);
	const created = await createIssue(db, author, { title: '解約の\n電話がつながらない', affected: "高齢者の'家族'", example: '具体例', topicId: 1 }, T0);
	if (!created.ok) throw new Error('課題を作れない');
	await createSolution(db, sqlite, addUser(sqlite), created.id, '窓口を\r\n増やす', T0 + 1000);
	const bill = addBill(sqlite, author.userId);
	const session = sessionAt(Date.parse('2046-05-10T00:00:00+09:00'), null);
	await setStance(db, author, { id: bill }, session, 'for', T0 + 2000);
	// 読める法律（索引は手で1行）と、マイグレーションが入れる行を書き換えたもの
	sqlite.exec("INSERT INTO readable_laws (id, title, law_num, law_type, promulgation_date, revision_id, updated) VALUES ('129AC0000000089', '民法', '明治二十九年法律第八十九号', 'Act', '1896-04-27', 'r1', '2026-01-01')");
	sqlite.exec("INSERT INTO readable_articles (id, law_id, seq, num, label, caption, paragraphs) VALUES (7, '129AC0000000089', 0, '1', '第一条', '（基本原則）', '[]')");
	sqlite.exec("INSERT INTO readable_search (rowid, text) VALUES (7, '基本原則')");
	sqlite.exec("UPDATE topics SET name = '消費者保護（改）' WHERE id = 1");
	// 消した行のぶん、番号の続き（sqlite_sequence）が行の最大より大きい
	sqlite.exec("UPDATE sqlite_sequence SET seq = 50 WHERE name = 'bills'");
	likeD1(sqlite);
	expect(all(sqlite, 'SELECT count(*) AS n FROM search_trigram')[0].n).toBeGreaterThan(0);

	// 日本時間の日付で置く（UTC 15時は日本時間の翌日0時）
	const result = await backup(sqlite, new Date(Date.UTC(2026, 10, 14, 15, 30)));
	expect(result.key).toBe('d1/staging/2026-11-15.sql');
	expect(backupKey('production', '2026-11-15')).toBe('d1/production/2026-11-15.sql');

	// 全文検索の表・影の表・マイグレーションの記録・D1 の内部の表は SQL に出てこない
	expect(result.sql).not.toMatch(/search_trigram|search_bigram|readable_search|d1_migrations|_cf_KV/);
	// ほかの表は全部ある（行のない表も、表と行の数の一覧に出る）
	const expected = expectedTables(sqlite);
	expect(result.tables.map((t) => t.name).sort()).toEqual(expected);
	for (const name of expected) expect(result.sql).toMatch(new RegExp(`^-- 表 ${name} \\d+行$`, 'm'));
	expect(result.tables.find((t) => t.name === 'provision_versions')?.rows).toBe(all(sqlite, 'SELECT count(*) AS n FROM provision_versions')[0].n);

	// マイグレーションを当てた新しい DB に流すと、どの表も元どおり（rowid も、マイグレーションが入れた行の書き換えも）
	const target = restore(result.sql);
	for (const name of expected) expect(contents(target.sqlite, name), name).toEqual(contents(sqlite, name));
	const sequence = (s: DatabaseSync) => all(s, "SELECT name, seq FROM sqlite_sequence WHERE name <> 'd1_migrations' ORDER BY name");
	expect(sequence(target.sqlite)).toEqual(sequence(sqlite));
	// トリガーも元どおり
	const triggers = (s: DatabaseSync) => all(s, "SELECT name, sql FROM sqlite_schema WHERE type = 'trigger' ORDER BY name");
	expect(triggers(target.sqlite)).toEqual(triggers(sqlite));
	// 全文検索の表は空（あとで作り直す）
	for (const name of FTS) expect(all(target.sqlite, `SELECT count(*) AS n FROM ${name}`)[0].n).toBe(0);

	// 書き出しか置くのに失敗したら例外（入口が終了コード1にする）。書き出しに失敗したら置かない
	const workDir = mkdtempSync(join(tmpdir(), 'osrippo-backup-'));
	dirs.push(workDir);
	const upload = vi.fn(async () => undefined);
	const base = { env: 'staging', bucket: 'osrippo-backup', now: new Date(T0), workDir };
	await expect(runBackup({ ...base, exportDb: async () => Promise.reject(new Error('export failed')), upload })).rejects.toThrow();
	expect(upload).not.toHaveBeenCalled();
	await expect(runBackup({ ...base, exportDb: async (path) => writeFileSync(path, ''), upload })).rejects.toThrow();
	expect(upload).not.toHaveBeenCalled();
	await expect(
		runBackup({ ...base, exportDb: async (path) => writeFileSync(path, cliDump(sqlite)), upload: async () => Promise.reject(new Error('upload failed')) })
	).rejects.toThrow();
});

/** 全文検索の索引の中身。search_* は行の集合、readable_search（本文の写しを持たない）は rowid ごとの語と位置 */
function searchIndex(sqlite: DatabaseSync) {
	sqlite.exec("CREATE VIRTUAL TABLE IF NOT EXISTS temp.readable_vocab USING fts5vocab(main, 'readable_search', 'instance')");
	return {
		trigram: all(sqlite, 'SELECT kind, ref_id, text FROM search_trigram ORDER BY kind, ref_id, text'),
		bigram: all(sqlite, 'SELECT kind, ref_id, text FROM search_bigram ORDER BY kind, ref_id, text'),
		readable: all(sqlite, 'SELECT doc, term, col, offset FROM temp.readable_vocab ORDER BY doc, offset, term'),
		readableRowids: all(sqlite, 'SELECT rowid FROM readable_search ORDER BY rowid').map((r) => r.rowid)
	};
}

test('基準2：全文検索の索引を、戻したほかの表から作り直すと、取り込みと投稿で作った索引と同じになる', async () => {
	vi.spyOn(console, 'error').mockImplementation(() => undefined);
	const { sqlite, db } = openMemoryDb();
	// 法令の条：2018年の一覧で取り込み、いまの一覧で同期する（古い版の行を消して足す）
	type Raw = { amendment_enforcement_date: string; amendment_promulgate_date: string | null; current_revision_status: string };
	const listAsOf = (date: string) => {
		const rows = (fixture(`law_revisions_${SHOHISHA}`).revisions as Raw[]).filter((r) => [r.amendment_promulgate_date ?? r.amendment_enforcement_date, r.amendment_enforcement_date].some((d) => d <= date));
		const current = rows.findIndex((r) => r.amendment_enforcement_date <= date);
		return rows.map((r, i) => ({ ...r, current_revision_status: r.amendment_enforcement_date > date ? 'UnEnforced' : i === current ? 'CurrentEnforced' : 'PreviousEnforced' }));
	};
	const load = (date: string) => (name: string) => (name === `law_revisions_${SHOHISHA}` ? { law_info: fixture(name).law_info, revisions: listAsOf(date) } : fixture(name));
	for (const statement of seedStatements([SHOHISHA], load('2018-01-01'))) sqlite.exec(statement);
	const egov: FetchJson = async (url) => {
		const u = new URL(url);
		if (/\/law_revisions\//.test(u.pathname)) return load('2026-11-01')(`law_revisions_${SHOHISHA}`);
		if (u.pathname.endsWith('/laws')) return fixture(`laws_list_${u.searchParams.get('law_type')!.toLowerCase()}`);
		const data = /\/law_data\/([^/]+)$/.exec(u.pathname);
		if (data) return fixture(`law_data_${decodeURIComponent(data[1])}`);
		throw new Error(`知らない URL ${url}`);
	};
	expect(await syncLaw(db, SHOHISHA, egov)).toMatchObject({ changed: true });
	// 読める法律
	const readable = await syncReadable(db, egov, async () => undefined);
	expect(readable.failed).toEqual([]);
	// 課題と解決策の投稿（自動で隠れた課題の行も索引に残る）
	const a = addUser(sqlite);
	const b = addUser(sqlite);
	const first = await createIssue(db, a, { title: '定期購入の解約', affected: '通販で買う人', example: '一度だけのつもりが毎月届いた', topicId: 1 }, T0);
	const second = await createIssue(db, b, { title: 'SNS の広告', affected: '若い人', example: '!!!', topicId: 1 }, T0 + 1000);
	if (!first.ok || !second.ok) throw new Error('課題を作れない');
	await createSolution(db, sqlite, b, first.id, '解約の手続きを、申し込みと同じ画面でできるようにする', T0 + 2000);
	await createSolution(db, sqlite, a, first.id, '確認画面に回数を大きく出す', T0 + 3000);
	sqlite.prepare("UPDATE issues SET status = 'auto_hidden', status_actor = 'auto', status_reason = 'reports', status_changed_at = ? WHERE id = ?").run(T0 + 4000, second.id);

	const before = searchIndex(sqlite);
	expect(before.trigram.filter((r) => r.kind === 'provision').length).toBeGreaterThan(100);
	expect(before.trigram.filter((r) => r.kind === 'issue').length).toBe(5);
	expect(before.trigram.filter((r) => r.kind === 'solution').length).toBe(2);
	expect(before.readableRowids.length).toBeGreaterThan(100);

	// バックアップから戻した DB で作り直す
	const { sql } = await backup(sqlite);
	const restored = restore(sql);
	expect(searchIndex(restored.sqlite).trigram).toEqual([]);
	await rebuildSearchIndex(restored.db);
	expect(searchIndex(restored.sqlite)).toEqual(before);
	// 何度作り直しても同じ
	await rebuildSearchIndex(restored.db);
	expect(searchIndex(restored.sqlite)).toEqual(before);

	// D1 に流す SQL として書き出しても同じ
	const other = restore(sql);
	const out: string[] = [];
	await writeIndexSql(other.db, (s) => void out.push(s));
	other.sqlite.exec(out.join(''));
	expect(searchIndex(other.sqlite)).toEqual(before);
});

test('基準3：戻すときに立場の履歴が二重にならない。戻したあとも、立場を変えると履歴が1行足される', async () => {
	const { sqlite, db } = openMemoryDb();
	const author = addUser(sqlite);
	const bill = addBill(sqlite, author.userId);
	const session = sessionAt(Date.parse('2046-05-10T00:00:00+09:00'), null);
	const people = [author, addUser(sqlite), addUser(sqlite)];
	for (const [i, p] of people.entries()) {
		await setStance(db, p, { id: bill }, session, 'for', T0 + i);
		if (i > 0) await setStance(db, p, { id: bill }, session, 'against', T0 + 100 + i);
	}
	const log = (s: DatabaseSync) => all(s, 'SELECT * FROM stance_log ORDER BY id');
	expect(log(sqlite)).toHaveLength(5);
	likeD1(sqlite);

	const { sql } = await backup(sqlite);
	const restored = restore(sql);
	expect(log(restored.sqlite)).toEqual(log(sqlite));
	expect(all(restored.sqlite, 'SELECT * FROM stances ORDER BY user_id')).toEqual(all(sqlite, 'SELECT * FROM stances ORDER BY user_id'));

	// 戻したあとも履歴のトリガーが効く（新しい行の番号は続きから）
	const newcomer = addUser(restored.sqlite);
	await setStance(restored.db, newcomer, { id: bill }, session, 'for', T0 + 1000);
	expect(log(restored.sqlite)).toHaveLength(6);
	expect(log(restored.sqlite).at(-1)).toMatchObject({ id: 6, user_id: newcomer.userId, stance: 'for' });
});
