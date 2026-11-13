// 読める法律の取り込みの入口（設計書 docs/spec/162.md 決めたこと7）。自宅サーバーで動かす。一覧が読めないか、1つでも失敗すれば終了コード1で終わる。
// 本番の D1 につなぐ引数は本番の公開（#203）で足す。Worker のサーバーと同時に手元の D1 を開かない（Issue #17）
import { drizzle } from 'drizzle-orm/d1';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { getPlatformProxy } from 'wrangler';
import { fetchEgovJson } from '../src/lib/egov/client';
import type { BatchDb } from '../src/lib/server/law';
import { sleep, syncReadable } from '../src/lib/server/readable-sync';

const { values } = parseArgs({ options: { 'persist-to': { type: 'string' } } });
const { env, dispose } = await getPlatformProxy<Env>({ persist: values['persist-to'] ? { path: join(values['persist-to'], 'v3') } : true });
try {
	const started = Date.now();
	const result = await syncReadable(drizzle(env.DB) as unknown as BatchDb, fetchEgovJson, sleep);
	const seconds = Math.round((Date.now() - started) / 1000);
	if (result.listError) {
		process.exitCode = 1;
		console.log(`一覧を読めなかったので、何も書きませんでした：${result.listError}`);
	} else {
		if (result.failed.length) process.exitCode = 1;
		console.log(`本文を読んだ法令 ${result.read.length} 件、消した法令 ${result.removed.length} 件（${seconds} 秒）`);
		if (result.empty.length) console.log(`本則の条がない法令：${result.empty.join(', ')}`);
		console.log(result.failed.length ? `取り込みに失敗した法令：${result.failed.join(', ')}` : '取り込みが終わりました');
	}
} finally {
	await dispose();
}
