// 負荷試験の β の規模のデータ（Issue #201。手順は docs/load-test.md）。シェルの機能に頼らず Node だけで動かす（PowerShell と Linux で同じ）
//   pnpm beta:data -- --out .wrangler/beta.sql [--now 2026-11-24T12:00:00+09:00]
//     … 入れる SQL（beta.sql）、消す SQL（beta.delete.sql）、作る行の数（beta.expected.json）を書く。時刻は「いま」に合わせる
//   pnpm beta:data -- --check .wrangler/beta.sql --env staging --remote
//     … D1 の β の行を数え、beta.expected.json と比べる（違えば終了コード1）。--env と --remote を外すと手元の D1
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { betaCountSql, betaData, betaDeleteStatements, type BetaCounts } from '../src/lib/db/beta-data';

const root = join(import.meta.dirname, '..');
// pnpm の「--」が残っていても読めるように
const args = process.argv.slice(2).filter((a, i) => !(i === 0 && a === '--'));
function usage(message?: string): never {
	if (message) console.error(message);
	console.error('使い方：pnpm beta:data -- --out <file.sql> [--now <日時>]');
	console.error('　　　　pnpm beta:data -- --check <file.sql> [--env staging --remote]');
	process.exit(2);
}
let values: { out?: string; now?: string; check?: string; env?: string; remote: boolean; 'persist-to'?: string };
try {
	values = parseArgs({
		args,
		options: {
			out: { type: 'string' },
			now: { type: 'string' },
			check: { type: 'string' },
			env: { type: 'string' },
			remote: { type: 'boolean', default: false },
			'persist-to': { type: 'string' }
		}
	}).values;
} catch (e) {
	usage((e as Error).message);
}
type Expected = { now: number; counts: BetaCounts };
const base = (file: string) => resolve(file).replace(/\.sql$/, '');

if (values.out) {
	const now = values.now === undefined ? Date.now() : Date.parse(values.now);
	if (!Number.isFinite(now)) usage();
	const { statements, expected } = betaData(now);
	const out = resolve(values.out);
	/** 作った時刻と行の数。--check で使う（時刻は、入れたあとに固定された今月の参加者の数を見分けるため） */
	const record: Expected = { now, counts: expected };
	mkdirSync(dirname(out), { recursive: true });
	writeFileSync(out, statements.join('\n') + '\n');
	writeFileSync(`${base(values.out)}.delete.sql`, betaDeleteStatements(now).join('\n') + '\n');
	writeFileSync(`${base(values.out)}.expected.json`, JSON.stringify(record, null, '\t') + '\n');
	console.log(`いま：${new Date(now).toISOString()}`);
	console.log(`入れる SQL：${out}（${statements.length}文）`);
	console.log(`消す SQL：${base(values.out)}.delete.sql`);
	console.log(`作る行の数：${JSON.stringify(expected)}`);
} else if (values.check) {
	const { now, counts: expected } = JSON.parse(readFileSync(`${base(values.check)}.expected.json`, 'utf8')) as Expected;
	const where = [
		...(values.env ? ['--env', values.env] : []),
		values.remote ? '--remote' : '--local',
		...(values['persist-to'] ? ['--persist-to', values['persist-to']] : [])
	];
	const output = execFileSync(
		process.execPath,
		[join(root, 'node_modules/wrangler/bin/wrangler.js'), 'd1', 'execute', 'DB', ...where, '--json', '--command', betaCountSql(now).replace(/\s+/g, ' ')],
		{ cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }
	);
	const actual = (JSON.parse(output) as { results: BetaCounts[] }[])[0].results[0];
	let ok = true;
	for (const key of Object.keys(expected) as (keyof BetaCounts)[]) {
		const same = actual[key] === expected[key];
		ok &&= same;
		console.log(`${same ? '　' : '×'} ${key}: ${actual[key]}（作った数 ${expected[key]}）`);
	}
	console.log(ok ? '作った数と同じです' : '作った数と違います');
	process.exitCode = ok ? 0 : 1;
} else {
	usage();
}
