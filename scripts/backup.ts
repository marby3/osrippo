// D1 のバックアップの入口（Issue #202。手順は docs/backup.md）。自宅サーバーで毎晩動かす。
//   pnpm backup --env staging --bucket <R2 のバケット> [--database DB] [--work-dir <一時フォルダ>]
// D1 を書き出し（wrangler d1 export --compatibility sqlite3_cli_only）、全文検索の表を除いた SQL にして、R2 の d1/<環境>/<日本時間の日付>.sql に置く。
// 資格情報（CLOUDFLARE_API_TOKEN・CLOUDFLARE_ACCOUNT_ID）は環境変数で渡す（引数にしない）。失敗したら終了コード1
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { runBackup, versionAtLeast, WRANGLER_MIN } from '../src/lib/backup/batch';

const { values } = parseArgs({
	options: { env: { type: 'string' }, bucket: { type: 'string' }, database: { type: 'string', default: 'DB' }, 'work-dir': { type: 'string' } }
});
if (!values.env || !values.bucket) {
	console.error('使い方：pnpm backup --env <wrangler の環境> --bucket <R2 のバケット> [--database DB] [--work-dir <一時フォルダ>]');
	process.exit(2);
}
const { env, bucket, database } = values;

/** wrangler を呼ぶ（pnpm の入口から動かすので、このリポジトリの wrangler が PATH にある）。0 以外で終わったら例外 */
function wrangler(args: string[]): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn('wrangler', args, { stdio: ['ignore', 'inherit', 'inherit'] });
		child.on('error', reject);
		child.on('exit', (code, signal) => (code === 0 ? resolve() : reject(new Error(`wrangler ${args.slice(0, 3).join(' ')} が ${code ?? signal} で終わりました`))));
	});
}

// 書き出しの --compatibility sqlite3_cli_only は wrangler 4.162.0 から。古ければ書き出す前に止める
const wranglerVersion = (() => {
	try {
		return execFileSync('wrangler', ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
	} catch {
		return '';
	}
})();
if (!versionAtLeast(wranglerVersion, WRANGLER_MIN)) {
	console.error(`wrangler を ${WRANGLER_MIN} 以上に上げてください（docs/backup.md）。いまの版：${wranglerVersion || '読めませんでした'}`);
	process.exit(1);
}

const workDir = mkdtempSync(join(values['work-dir'] ?? tmpdir(), 'osrippo-backup-'));
const started = Date.now();
try {
	const result = await runBackup({
		env,
		bucket,
		now: new Date(),
		workDir,
		exportDb: (path) => wrangler(['d1', 'export', database, '--remote', '--env', env, '--compatibility', 'sqlite3_cli_only', '--output', path, '--skip-confirmation']),
		upload: (key, path) => wrangler(['r2', 'object', 'put', `${bucket}/${key}`, '--file', path, '--remote', '--content-type', 'application/sql'])
	});
	const rows = result.tables.reduce((n, t) => n + t.rows, 0);
	const seconds = Math.round((Date.now() - started) / 1000);
	console.log(`${bucket}/${result.key} に置きました（${result.bytes} バイト、表 ${result.tables.length} 個、${rows} 行、マイグレーション ${result.migrations.length} 件、${seconds} 秒）`);
} catch (e) {
	console.error('バックアップに失敗しました', e);
	process.exitCode = 1;
} finally {
	rmSync(workDir, { recursive: true, force: true });
}
