// テスト用：マイグレーションを当てた node:sqlite のメモリ上の DB と、その上の Drizzle（本体の Db と同じ型）
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { drizzle } from 'drizzle-orm/sqlite-proxy';
import type { Db } from '../server/law';

export function openMemoryDb() {
	const root = new URL('../../../', import.meta.url);
	const sqlite = new DatabaseSync(':memory:');
	sqlite.exec('PRAGMA foreign_keys = ON');
	const migrations = new URL('drizzle/', root);
	for (const f of readdirSync(migrations).filter((f) => f.endsWith('.sql')).sort()) {
		sqlite.exec(readFileSync(new URL(f, migrations), 'utf8'));
	}
	const db: Db = drizzle(async (sql, params, method) => {
		const stmt = sqlite.prepare(sql);
		stmt.setReturnArrays(true);
		if (method === 'run') return stmt.run(...(params as [])), { rows: [] };
		if (method === 'get') return { rows: stmt.get(...(params as [])) as unknown as unknown[] };
		return { rows: stmt.all(...(params as [])) as unknown as unknown[][] };
	});
	return { sqlite, db };
}
