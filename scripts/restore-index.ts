// 全文検索の索引を作り直す入口（Issue #202。手順は docs/backup.md）。失敗したら終了コード1。
//   pnpm restore:index [--persist-to <dir>]                         手元の D1 の索引を作り直す
//   pnpm restore:index --from <バックアップ.sql> --output <索引.sql> [--work-dir <一時フォルダ>]
//       バックアップから、索引を作る SQL を書く（wrangler d1 execute --remote --file で流す）。一時フォルダに SQLite のファイルを作り、終わったら消す
// Worker のサーバーと同時に手元の D1 を開かない（Issue #17）
import { drizzle } from 'drizzle-orm/d1';
import { closeSync, mkdtempSync, openSync, rmSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { getPlatformProxy } from 'wrangler';
import { loadBackup } from '../src/lib/backup/restore';
import type { BatchDb } from '../src/lib/server/law';
import { rebuildSearchIndex, writeIndexSql, type RebuildResult } from '../src/lib/server/search-index';

const { values } = parseArgs({ options: { 'persist-to': { type: 'string' }, from: { type: 'string' }, output: { type: 'string' }, 'work-dir': { type: 'string' } } });
if (Boolean(values.from) !== Boolean(values.output) || (values.from && values['persist-to']) || (values['work-dir'] && !values.from)) {
	console.error('使い方：pnpm restore:index [--persist-to <dir>]\n　　　　pnpm restore:index --from <バックアップ.sql> --output <索引.sql> [--work-dir <一時フォルダ>]');
	process.exit(2);
}

const report = (r: RebuildResult, seconds: number) => console.log(`検索の行 ${r.search} 件、読める法律の条 ${r.readable} 件（${seconds} 秒）`);
const started = Date.now();
try {
	if (values.from && values.output) {
		// 一時フォルダの SQLite のファイルに、マイグレーションを当ててバックアップを少しずつ流し、そこから索引の行を作る。終わったら消す
		const workDir = mkdtempSync(join(values['work-dir'] ?? tmpdir(), 'osrippo-restore-index-'));
		try {
			const { db, close } = loadBackup(values.from, join(workDir, 'restore.sqlite'));
			try {
				const out = openSync(values.output, 'w');
				try {
					report(await writeIndexSql(db, (s) => void writeSync(out, s)), Math.round((Date.now() - started) / 1000));
				} finally {
					closeSync(out);
				}
			} finally {
				close();
			}
		} finally {
			rmSync(workDir, { recursive: true, force: true });
		}
		console.log(`${values.output} を書きました`);
	} else {
		const { env, dispose } = await getPlatformProxy<Env>({ persist: values['persist-to'] ? { path: join(values['persist-to'], 'v3') } : true });
		try {
			report(await rebuildSearchIndex(drizzle(env.DB) as unknown as BatchDb), Math.round((Date.now() - started) / 1000));
		} finally {
			await dispose();
		}
	}
} catch (e) {
	console.error('索引を作り直せませんでした', e);
	process.exitCode = 1;
}
