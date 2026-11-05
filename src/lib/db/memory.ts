// テスト用：マイグレーションを当てた node:sqlite のメモリ上の DB と、その上の Drizzle（本体の Db と同じ型）
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { drizzle } from 'drizzle-orm/sqlite-proxy';
import type { BatchDb } from '../server/law';

export type MemoryDb = BatchDb;

export function openMemoryDb() {
	const root = new URL('../../../', import.meta.url);
	const sqlite = new DatabaseSync(':memory:');
	sqlite.exec('PRAGMA foreign_keys = ON');
	const migrations = new URL('drizzle/', root);
	for (const f of readdirSync(migrations).filter((f) => f.endsWith('.sql')).sort()) {
		sqlite.exec(readFileSync(new URL(f, migrations), 'utf8'));
	}
	const run = (sql: string, params: unknown[], method: string) => {
		const stmt = sqlite.prepare(sql);
		stmt.setReturnArrays(true);
		if (method === 'run') return stmt.run(...(params as [])), { rows: [] };
		if (method === 'get') return { rows: stmt.get(...(params as [])) as unknown as unknown[] };
		return { rows: stmt.all(...(params as [])) as unknown as unknown[][] };
	};
	const db: BatchDb = drizzle(
		async (sql, params, method) => run(sql, params, method),
		// D1 の batch と同じく、1つのトランザクションで流す
		async (queries) => {
			sqlite.exec('BEGIN');
			try {
				const results = queries.map((q) => run(q.sql, q.params, q.method));
				sqlite.exec('COMMIT');
				return results;
			} catch (e) {
				sqlite.exec('ROLLBACK');
				throw e;
			}
		}
	) as unknown as BatchDb;
	return { sqlite, db };
}
