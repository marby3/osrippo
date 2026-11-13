// バックアップの SQL を、手元の SQLite のファイルに戻す（Issue #202。pnpm restore:index --from が使う）。node:sqlite を使うので、Worker からは読まない。
// マイグレーションを当てた DB に、バックアップを batch.ts と同じ分け方（少しずつ読んで文に分ける）で流す。大きなバックアップを一度に文字列にしない
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { drizzle } from 'drizzle-orm/sqlite-proxy';
import type { Db } from '../server/law';
import { readChunks } from './batch';
import { SqlSplitter } from './plan';

/** dbPath に新しい DB を作り、マイグレーションを当ててからバックアップ（backupPath）を流す。終わったら close を呼ぶ */
export function loadBackup(backupPath: string, dbPath: string): { sqlite: DatabaseSync; db: Db; close: () => void } {
	const sqlite = new DatabaseSync(dbPath);
	try {
		sqlite.exec('PRAGMA foreign_keys = ON');
		const migrations = new URL('../../../drizzle/', import.meta.url);
		for (const f of readdirSync(migrations).filter((f) => f.endsWith('.sql')).sort()) sqlite.exec(readFileSync(new URL(f, migrations), 'utf8'));
		const splitter = new SqlSplitter();
		sqlite.exec('BEGIN');
		for (const chunk of readChunks(backupPath)) for (const stmt of splitter.push(chunk)) sqlite.exec(stmt);
		for (const stmt of splitter.end()) sqlite.exec(stmt);
		sqlite.exec('COMMIT');
	} catch (e) {
		sqlite.close();
		throw e;
	}
	// 読むだけなので、batch は使わない（索引の SQL を書くときは select だけ）
	const db = drizzle(async (sql, params, method) => {
		const stmt = sqlite.prepare(sql);
		stmt.setReturnArrays(true);
		if (method === 'run') return stmt.run(...(params as [])), { rows: [] };
		if (method === 'get') return { rows: stmt.get(...(params as [])) as unknown as unknown[] };
		return { rows: stmt.all(...(params as [])) as unknown as unknown[][] };
	}) as unknown as Db;
	return { sqlite, db, close: () => sqlite.close() };
}
