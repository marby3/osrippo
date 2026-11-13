// 負荷試験の入口（Issue #201。手順は docs/load-test.md）。Docker の grafana/k6 で load/load.js を流す。
// シェルの機能に頼らず Node だけで動かす（PowerShell と Linux で同じ）
//   pnpm test:load -- --base <URL> [--duration 5m] [--vus 100] [--page <画面の名前>]
// 終了コード：0 合格、1 不合格（k6 の thresholds を満たさない）、2 流せなかった（引数、Docker がない、k6 のエラー）。
// 要約の JSON は load/out/summary-<日時>.json（.gitignore）
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

/** k6 の版を固定する（版が変わると要約の形や閾値の書き方が変わることがある） */
const K6_IMAGE = 'grafana/k6:2.4.0';
/** k6 が thresholds を満たさなかったときの終了コード */
const K6_THRESHOLDS_FAILED = 99;

const root = join(import.meta.dirname, '..');
const loadDir = join(root, 'load');
const pages = (JSON.parse(readFileSync(join(loadDir, 'pages.json'), 'utf8')) as { name: string }[]).map((p) => p.name);

function fail(message: string): never {
	console.error(message);
	process.exit(2);
}

// pnpm の「--」が残っていても読めるように
const args = process.argv.slice(2).filter((a, i) => !(i === 0 && a === '--'));
let values: { base?: string; duration: string; vus: string; page?: string };
try {
	values = parseArgs({
		args,
		options: { base: { type: 'string' }, duration: { type: 'string', default: '5m' }, vus: { type: 'string', default: '100' }, page: { type: 'string' } }
	}).values;
} catch (e) {
	fail(`${(e as Error).message}\n使い方：pnpm test:load -- --base <URL> [--duration 5m] [--vus 100] [--page <${pages.join('|')}>]`);
}

const base = (() => {
	try {
		const url = new URL(values.base ?? '');
		return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
	} catch {
		return null;
	}
})();
const vus = Number(values.vus);
if (!base) fail('--base に向ける先の URL（http:// か https://）を書いてください');
if (!/^[1-9]\d*[smh]$/.test(values.duration)) fail('--duration は 30s、1m、5m のように書いてください');
if (!Number.isInteger(vus) || vus < 1 || vus > 1000) fail('--vus は 1〜1000 の整数にしてください');
if (values.page !== undefined && !pages.includes(values.page)) fail(`--page は次のどれかにしてください：${pages.join(', ')}`);

// Docker があり、デーモンにつながるか
const probe = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], { encoding: 'utf8' });
if (probe.error) fail(`Docker が見つかりません（${(probe.error as NodeJS.ErrnoException).code ?? probe.error.message}）。Docker を入れてからやり直してください`);
if (probe.status !== 0) fail(`Docker のデーモンにつながりません。Docker を起動してからやり直してください\n${probe.stderr.trim()}`);

// 手元のサーバーに向けるときは、コンテナから手元に届くようにする（Linux はホストのネットワーク、ほかは host.docker.internal）
const network: string[] = [];
if (['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)) {
	if (process.platform === 'linux') network.push('--network', 'host');
	else base.hostname = 'host.docker.internal';
}

const outDir = join(loadDir, 'out');
mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const summaryName = `summary-${stamp}${values.page ? `-${values.page}` : ''}.json`;
// コンテナの k6 は root 以外で動くので、書き出しのフォルダに書けるよう手元の利用者で動かす（Windows と macOS の Docker Desktop では要らない）
const user = process.getuid && process.getgid ? ['--user', `${process.getuid()}:${process.getgid()}`] : [];

const env = {
	BASE_URL: base.origin,
	VUS: String(vus),
	DURATION: values.duration,
	SUMMARY_FILE: `/scripts/out/${summaryName}`,
	...(values.page ? { PAGE: values.page } : {})
};
const dockerArgs = [
	'run',
	'--rm',
	...network,
	...user,
	'-v',
	`${loadDir}:/scripts`,
	...Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`]),
	K6_IMAGE,
	'run',
	'--quiet',
	'/scripts/load.js'
];
console.error(`${base.origin} に ${vus}人で ${values.duration} 流します${values.page ? `（画面 ${values.page} だけ）` : ''}`);
// 始まりと終わりの時刻（UTC）。D1 の読んだ行数を、この間で集めるのに使う（docs/load-test.md）
console.error(`始まり：${new Date().toISOString()}`);
const run = spawnSync('docker', dockerArgs, { stdio: 'inherit' });
console.error(`終わり：${new Date().toISOString()}`);

const summary = join(outDir, summaryName);
if (existsSync(summary)) console.error(`要約：${summary}`);
if (run.error) fail(`docker を動かせませんでした：${run.error.message}`);
if (run.status === 0) {
	console.error('合格しました');
	process.exit(0);
}
if (run.status === K6_THRESHOLDS_FAILED) {
	console.error('不合格です（合否の条件を満たしませんでした）');
	process.exit(1);
}
fail(`k6 を流せませんでした（終了コード ${run.status ?? run.signal}）`);
