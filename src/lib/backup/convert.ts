// D1 の書き出し（sqlite3 の .dump の形）を、D1 に流せる SQL にする（Issue #202）。自宅サーバーのバッチから読む（node:sqlite を使う。Worker からは読まない）。
// 書き出しを手元の SQLite に入れ直してから、戻す表だけを外部キーの順に書く。全文検索の表は入れない（戻したあとで作り直す）
import { DatabaseSync } from 'node:sqlite';
import { classify, insertTriggers, isBackedUp, restoreOrder, SqlSplitter } from './plan';
import { insertStatements, quoteIdent, sqlLiteral } from './sql';

export type BackupTable = { name: string; rows: number };
export type Converted = { tables: BackupTable[]; migrations: string[] };

type Trigger = { name: string; sql: string };

/**
 * chunks は書き出しの中身（少しずつ）。write に D1 に流す SQL を順に渡す。dbPath は入れ直すための SQLite のファイル（既定はメモリ）。
 * 流す SQL は、マイグレーションを当てた新しい D1 に流す前提：INSERT のトリガーを外して行を入れ（OR REPLACE：マイグレーションが入れた行は書き換える）、
 * トリガーを戻し、番号の続き（sqlite_sequence）を元に合わせる
 */
export function convertDump(chunks: Iterable<string>, write: (sql: string) => void, options: { createdAt: string; dbPath?: string }): Converted {
	const load = new DatabaseSync(options.dbPath ?? ':memory:', { enableForeignKeyConstraints: false });
	try {
		const virtual: string[] = [];
		const triggers: Trigger[] = [];
		const loaded = (name: string) => isBackedUp(name, virtual) || name.toLowerCase() === 'd1_migrations';
		const hasTable = (name: string) => load.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?").get(name) !== undefined;
		let statements = 0;
		const apply = (stmt: string) => {
			statements++;
			const s = classify(stmt);
			switch (s.kind) {
				case 'skip':
					return;
				case 'virtual':
					virtual.push(s.table);
					return;
				case 'table':
					if (loaded(s.table)) load.exec(stmt);
					return;
				case 'insert':
				case 'delete':
					if (s.table.toLowerCase() === 'sqlite_sequence') {
						if (hasTable('sqlite_sequence')) load.exec(stmt);
					} else if (s.kind === 'insert' && loaded(s.table)) load.exec(stmt);
					else if (s.kind === 'delete') throw new Error(`書き出しに知らない DELETE があります：${stmt.slice(0, 80)}`);
					return;
				case 'trigger':
					triggers.push({ name: s.name, sql: stmt });
					return;
				default:
					throw new Error(`書き出しに知らない文があります：${stmt.slice(0, 80)}`);
			}
		};
		const splitter = new SqlSplitter();
		load.exec('BEGIN');
		for (const chunk of chunks) for (const stmt of splitter.push(chunk)) apply(stmt);
		for (const stmt of splitter.end()) apply(stmt);
		load.exec('COMMIT');
		if (statements === 0) throw new Error('書き出しが空です');

		const names = (load.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name").all() as { name: string }[])
			.map((t) => t.name)
			.filter((n) => isBackedUp(n, virtual));
		if (!names.length) throw new Error('書き出しに戻す表がありません');
		const order = restoreOrder(
			names.map((name) => ({
				name,
				references: (load.prepare('SELECT DISTINCT "table" AS t FROM pragma_foreign_key_list(?)').all(name) as { t: string }[]).map((r) => r.t)
			}))
		);
		const count = (name: string) => Number((load.prepare(`SELECT count(*) AS n FROM ${quoteIdent(name)}`).get() as { n: number }).n);
		const tables = order.map((name) => ({ name, rows: count(name) }));
		const migrations = hasTable('d1_migrations') ? (load.prepare('SELECT name FROM d1_migrations ORDER BY id').all() as { name: string }[]).map((m) => m.name) : [];

		write(
			[
				'-- オープンソース立法府の D1 のバックアップ（全文検索の索引を除く。Issue #202）',
				`-- 作った日時：${options.createdAt}`,
				'-- 戻し方は docs/backup.md。マイグレーションを当てた新しい D1 に流し、そのあと全文検索の索引を作り直す（pnpm restore:index）',
				`-- 書き出したときのマイグレーション：${migrations.length}件${migrations.length ? `、最後は ${migrations.at(-1)}` : ''}`,
				...tables.map((t) => `-- 表 ${t.name} ${t.rows}行`),
				''
			].join('\n')
		);
		const dropped = insertTriggers(triggers);
		for (const t of dropped) write(`DROP TRIGGER IF EXISTS ${quoteIdent(t.name)};\n`);
		for (const name of order) writeRows(load, name, write);
		for (const t of dropped) write(`${t.sql};\n`);
		if (hasTable('sqlite_sequence')) {
			const sequence = load.prepare('SELECT name, seq FROM sqlite_sequence ORDER BY name');
			sequence.setReadBigInts(true);
			for (const s of sequence.all() as { name: string; seq: bigint }[]) {
				if (!names.includes(s.name)) continue;
				write(`DELETE FROM sqlite_sequence WHERE name = ${sqlLiteral(s.name)};\nINSERT INTO sqlite_sequence (name, seq) VALUES (${sqlLiteral(s.name)}, ${sqlLiteral(s.seq)});\n`);
			}
		}
		return { tables, migrations };
	} finally {
		load.close();
	}
}

/** 表の行を rowid の順に書く。rowid が列の別名でない表は、rowid も書く（元と同じ rowid にする） */
function writeRows(load: DatabaseSync, name: string, write: (sql: string) => void) {
	const { sql } = load.prepare("SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = ?").get(name) as { sql: string };
	const info = load.prepare('SELECT name, type, pk, hidden FROM pragma_table_xinfo(?)').all(name) as { name: string; type: string; pk: number; hidden: number }[];
	// 生成列（hidden が 2・3）は入れられない
	const columns = info.filter((c) => c.hidden === 0);
	const withoutRowid = /\bWITHOUT\s+ROWID\b/i.test(sql);
	const pk = info.filter((c) => c.pk > 0);
	const aliased = pk.length === 1 && pk[0].type.toUpperCase() === 'INTEGER';
	const names = [...(withoutRowid || aliased ? [] : ['rowid']), ...columns.map((c) => c.name)];
	const select = load.prepare(`SELECT ${names.map(quoteIdent).join(', ')} FROM ${quoteIdent(name)}${withoutRowid ? '' : ' ORDER BY rowid'}`);
	select.setReadBigInts(true);
	select.setReturnArrays(true);
	for (const statement of insertStatements('INSERT OR REPLACE INTO', name, names, select.iterate() as Iterable<unknown[]>)) write(statement);
}
