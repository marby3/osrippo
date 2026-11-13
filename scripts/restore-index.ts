// 全文検索の索引を作り直す入口（Issue #202。手順は docs/backup.md）。失敗したら終了コード1。
//   pnpm restore:index [--persist-to <dir>]                         手元の D1 の索引を作り直す
//   pnpm restore:index --from <バックアップ.sql> --output <索引.sql>   バックアップから、索引を作る SQL を書く（wrangler d1 execute --remote --file で流す）
// Worker のサーバーと同時に手元の D1 を開かない（Issue #17）
import { drizzle } from 'drizzle-orm/d1';
import { closeSync, openSync, readFileSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { getPlatformProxy } from 'wrangler';
import { openMemoryDb } from '../src/lib/db/memory';
import type { BatchDb } from '../src/lib/server/law';
import { rebuildSearchIndex, writeIndexSql, type RebuildResult } from '../src/lib/server/search-index';

const { values } = parseArgs({ options: { 'persist-to': { type: 'string' }, from: { type: 'string' }, output: { type: 'string' } } });
if (Boolean(values.from) !== Boolean(values.output) || (values.from && values['persist-to'])) {
	console.error('使い方：pnpm restore:index [--persist-to <dir>]\n　　　　pnpm restore:index --from <バックアップ.sql> --output <索引.sql>');
	process.exit(2);
}

const report = (r: RebuildResult, seconds: number) => console.log(`検索の行 ${r.search} 件、読める法律の条 ${r.readable} 件（${seconds} 秒）`);
const started = Date.now();
try {
	if (values.from && values.output) {
		// マイグレーションを当てたメモリ上の DB にバックアップを流し、そこから索引の行を作る
		const { sqlite, db } = openMemoryDb();
		sqlite.exec(readFileSync(values.from, 'utf8'));
		const out = openSync(values.output, 'w');
		try {
			report(await writeIndexSql(db, (s) => void writeSync(out, s)), Math.round((Date.now() - started) / 1000));
		} finally {
			closeSync(out);
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
