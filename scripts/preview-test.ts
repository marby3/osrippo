// 画面のテストのサーバー。ビルド済みの Worker を、ダミーの秘密の値で起動する（設計書 docs/spec/23.md）
//   tsx scripts/preview-test.ts --port 4173 --test-login   … テスト用のログインを有効にする
//   tsx scripts/preview-test.ts --port 4174 --persist-to .wrangler/state-nologin … 無効（404 を確かめる）
// シェルの機能に頼らず Node だけで動かす（PowerShell と Linux で同じ）
import { execFileSync, spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
	options: {
		port: { type: 'string' },
		'test-login': { type: 'boolean', default: false },
		'persist-to': { type: 'string' }
	}
});
const port = values.port ?? '4173';
const root = join(import.meta.dirname, '..');

const vars: Record<string, string> = {
	BETTER_AUTH_URL: `http://localhost:${port}`,
	BETTER_AUTH_SECRET: 'test-secret-not-for-production-0123456789',
	GOOGLE_CLIENT_ID: 'test-google-client',
	GOOGLE_CLIENT_SECRET: 'test-google-secret',
	LINE_CLIENT_ID: 'test-line-client',
	LINE_CLIENT_SECRET: 'test-line-secret',
	// 画面のテストのサーバーでは siteverify を呼ばない（設計書 docs/spec/25.md 決めたこと8）
	TURNSTILE_SECRET_KEY: 'test-turnstile-secret',
	IP_HASH_SECRET: 'test-ip-hash-secret',
	// 公開ミラーの書き出しの入口（Issue #155）
	MIRROR_TOKEN: 'test-mirror-token',
	...(values['test-login'] ? { TEST_LOGIN: '1' } : {})
};

// 別に置いた D1 にも表を作る（ホームは開くたびに DB を読む。Issue #128）。
// 毎回空から作る（課題のないサーバーとして使うテストがある。Issue #130）
if (values['persist-to']) {
	rmSync(join(root, values['persist-to'], 'v3/d1'), { recursive: true, force: true });
	execFileSync(process.execPath, [join(root, 'node_modules/wrangler/bin/wrangler.js'), 'd1', 'migrations', 'apply', 'DB', '--local', '--persist-to', values['persist-to']], {
		cwd: root,
		stdio: ['ignore', 'inherit', 'inherit']
	});
}

const args = [
	join(root, 'node_modules/wrangler/bin/wrangler.js'),
	'dev',
	'.svelte-kit/cloudflare/_worker.js',
	'--port',
	port,
	...Object.entries(vars).flatMap(([k, v]) => ['--var', `${k}:${v}`]),
	...(values['persist-to'] ? ['--persist-to', values['persist-to']] : []),
	// Cron の入口を /cdn-cgi/handler/scheduled から呼べるようにする（Issue #71。本番にこの入口はない）
	...(values['test-login'] ? ['--test-scheduled'] : [])
];
spawn(process.execPath, args, { cwd: root, stdio: 'inherit' }).on('exit', (code) => process.exit(code ?? 0));
