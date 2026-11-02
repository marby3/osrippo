// Issue #8 基準1：pnpm db:reset でローカル D1 を作り直せる（webServer の起動前に pnpm db:reset が走る）
import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('../', import.meta.url));

test('基準1：pnpm db:reset のあと、ローカル D1 に3法が入っている', () => {
	// pnpm やシェルの違いに頼らず、Node から直接 wrangler を動かす（PowerShell と Linux で同じ）
	const out = execFileSync(
		process.execPath,
		[join(cwd, 'node_modules/wrangler/bin/wrangler.js'), 'd1', 'execute', 'DB', '--local', '--json', '--command', 'SELECT COUNT(*) AS n FROM laws'],
		{ cwd, encoding: 'utf8', stdio: 'pipe' }
	);
	expect(JSON.parse(out)[0].results[0].n).toBe(3);
});
