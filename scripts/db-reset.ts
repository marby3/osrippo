// ローカル D1 を作り直す：消す → マイグレーション → 対象3法の取り込み（設計書 docs/spec/8.md）
// シェルの機能に頼らず Node だけで動かす（PowerShell と Linux で同じ）
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { seedStatements, TARGET_LAWS } from '../src/lib/db/seed';

const root = join(import.meta.dirname, '..');
const wrangler = (...args: string[]) =>
	execFileSync(process.execPath, [join(root, 'node_modules/wrangler/bin/wrangler.js'), ...args], {
		cwd: root,
		// 標準入力を渡さない：端末から流したときに、マイグレーションの確認（Y/n）で止まらないようにする
		stdio: ['ignore', 'inherit', 'inherit']
	});

try {
	rmSync(join(root, '.wrangler/state/v3/d1'), { recursive: true, force: true });
} catch (e) {
	console.error('ローカル D1 を消せませんでした。開発サーバーを止めてからやり直してください。');
	throw e;
}

wrangler('d1', 'migrations', 'apply', 'DB', '--local');

const fixture = (name: string) => JSON.parse(readFileSync(join(root, 'tests/fixtures/egov', `${name}.json`), 'utf8'));
const seed = join(root, '.wrangler/seed.sql');
mkdirSync(join(root, '.wrangler'), { recursive: true });
writeFileSync(seed, seedStatements(TARGET_LAWS, fixture).join('\n'));
wrangler('d1', 'execute', 'DB', '--local', '--file', seed);
