// SvelteKit が書き出した Worker に Cron の入口を足す（設計書 docs/spec/71.md 決めたこと4）。pnpm build の最後に走る。
// アダプターは wrangler.jsonc の main の場所に Worker を書き出すので、main を自前のファイルにできない
import { appendFileSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(import.meta.dirname, '../.svelte-kit/cloudflare');
const worker = join(dir, '_worker.js');
const MARK = '// wrap-worker';

const source = readFileSync(worker, 'utf8');
if (source.startsWith(MARK)) process.exit(0);
// default のほかの書き出しがあると、包んだときに失われる
if (/^export\s+(?!default\b)/m.test(source)) throw new Error('_worker.js に default のほかの書き出しがあります。wrap-worker.ts で引き継いでください');

renameSync(worker, join(dir, '_app_worker.js'));
writeFileSync(
	worker,
	`${MARK}
import app from './_app_worker.js';
import { scheduled } from '../../src/worker/scheduled.ts';

export default { fetch: app.fetch, scheduled };
`
);
// このフォルダは公開ファイルの置き場でもある。入れないとサーバーの入口が公開される
appendFileSync(join(dir, '.assetsignore'), '\n_app_worker.js\n');
