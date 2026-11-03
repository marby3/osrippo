// 画面のテストのサーバー。ビルド済みの Worker を、ダミーの秘密の値で起動する（設計書 docs/spec/23.md）
//   tsx scripts/preview-test.ts --port 4173 --test-login   … テスト用のログインを有効にする
//   tsx scripts/preview-test.ts --port 4174 --persist-to .wrangler/state-nologin … 無効（404 を確かめる）
// シェルの機能に頼らず Node だけで動かす（PowerShell と Linux で同じ）
import { spawn } from 'node:child_process';
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
	...(values['test-login'] ? { TEST_LOGIN: '1' } : {})
};

const args = [
	join(root, 'node_modules/wrangler/bin/wrangler.js'),
	'dev',
	'.svelte-kit/cloudflare/_worker.js',
	'--port',
	port,
	...Object.entries(vars).flatMap(([k, v]) => ['--var', `${k}:${v}`]),
	...(values['persist-to'] ? ['--persist-to', values['persist-to']] : [])
];
spawn(process.execPath, args, { cwd: root, stdio: 'inherit' }).on('exit', (code) => process.exit(code ?? 0));
