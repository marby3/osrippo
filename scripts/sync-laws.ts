// 現実の改正の同期の入口（設計書 docs/spec/74.md 決めたこと5）。自宅サーバーで毎日動かす。1つでも失敗すれば終了コード1で終わる。
// 本番の D1 につなぐ引数はデプロイの Issue で足す。Worker のサーバーと同時に手元の D1 を開かない（Issue #17）
import { drizzle } from 'drizzle-orm/d1';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { getPlatformProxy } from 'wrangler';
import { fetchEgovJson } from '../src/lib/egov/client';
import type { BatchDb } from '../src/lib/server/law';
import { syncAll } from '../src/lib/server/law-sync';

const { values } = parseArgs({ options: { 'persist-to': { type: 'string' } } });
const { env, dispose } = await getPlatformProxy<Env>({ persist: values['persist-to'] ? { path: join(values['persist-to'], 'v3') } : true });
try {
	const { failed, skipped } = await syncAll(drizzle(env.DB) as unknown as BatchDb, fetchEgovJson);
	for (const s of skipped) console.warn(`${s.lawId}：固定の版より前に遅れて来た版を履歴に入れませんでした：${s.revisionId}。次の版が入るまで、その改正は法令ページに出ません`);
	if (failed.length) process.exitCode = 1;
	console.log(failed.length ? `同期に失敗した法令：${failed.join(', ')}` : '同期が終わりました');
} finally {
	await dispose();
}
