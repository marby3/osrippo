// Issue #8 基準1：pnpm db:reset でローカル D1 を作り直せる
import { expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const cwd = new URL('../../../', import.meta.url).pathname;
// pnpm やシェルの違いに頼らず、Node から直接動かす（PowerShell と Linux で同じ）
const wrangler = join(cwd, 'node_modules/wrangler/bin/wrangler.js');
const run = (args: string[]) => execFileSync(process.execPath, args, { cwd, encoding: 'utf8', stdio: 'pipe' });

test('基準1：pnpm db:reset のあと、ローカル D1 に3法が入っている', () => {
	execFileSync(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['db:reset'], { cwd, stdio: 'pipe', shell: process.platform === 'win32' });
	const out = run([wrangler, 'd1', 'execute', 'DB', '--local', '--json', '--command', 'SELECT COUNT(*) AS n FROM laws']);
	expect(JSON.parse(out)[0].results[0].n).toBe(3);
}, 180_000);
