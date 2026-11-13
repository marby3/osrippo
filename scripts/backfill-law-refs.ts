// 条のリンク元（Issue #166）の一度きりの処理：law_refs を作る前に書いた課題・解決策・質疑・答弁・補足の本文から、触れている条を law_refs へ入れる。
// マイグレーションでは本文を読み解けないので、本番の公開のときに1回流す。何度流しても同じ行になる（すでにある行は足さない）。
// 本番の D1 につなぐ引数は本番の公開（#203）で足す。Worker のサーバーと同時に手元の D1 を開かない（Issue #17）
import { drizzle } from 'drizzle-orm/d1';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { getPlatformProxy } from 'wrangler';
import { backfillLawRefs } from '../src/lib/server/law-refs';

const { values } = parseArgs({ options: { 'persist-to': { type: 'string' } } });
const { env, dispose } = await getPlatformProxy<Env>({ persist: values['persist-to'] ? { path: join(values['persist-to'], 'v3') } : true });
try {
	const started = Date.now();
	const read = await backfillLawRefs(drizzle(env.DB));
	const seconds = Math.round((Date.now() - started) / 1000);
	console.log(`課題 ${read.issue} 件、解決策 ${read.solution} 件、質疑・答弁・補足 ${read.post} 件を読み、条への参照 ${read.added} 行を足しました（${seconds} 秒）`);
} finally {
	await dispose();
}
