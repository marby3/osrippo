// 版を古い順に読み、内部IDの付け替えで条・号の移動を拾えるか見る
import { readFileSync } from 'node:fs';
import { parseLaw, expandDeletedRanges } from '../src/lib/law/parse';
import { assignIds, type IdedProvision } from '../src/lib/law/identity';

const files = process.argv.slice(2).sort((a, b) => a.split('_')[1].localeCompare(b.split('_')[1]));
let prev: IdedProvision[] | null = null;
for (const f of files) {
	const t0 = performance.now();
	const raw = readFileSync(f, 'utf8');
	const law = parseLaw(JSON.parse(raw));
	const t1 = performance.now();
	const provs = expandDeletedRanges(law.provisions);
	const { provisions, moves } = assignIds(prev, provs);
	const t2 = performance.now();
	const arts = provisions.filter((p) => p.kind === 'article');
	const branch = arts.filter((p) => p.num.includes('_')).map((p) => p.num);
	const deleted = arts.filter((p) => p.deleted).map((p) => p.num);
	const added = prev ? provisions.filter((p) => !prev!.some((q) => q.id === p.id)).map((p) => p.key) : [];
	const units = provisions.reduce((n, p) => n + p.units.length, 0);
	console.log(`\n${law.revisionId} ${law.enforcementDate} size=${(raw.length / 1024) | 0}KB arts=${arts.length} units=${units} parse=${(t1 - t0).toFixed(1)}ms ids=${(t2 - t1).toFixed(1)}ms`);
	console.log(`  branch=${branch.join(',')} deleted=${deleted.length} [${deleted.slice(0, 6).join(',')}${deleted.length > 6 ? '…' : ''}]`);
	if (added.length) console.log(`  new provisions: ${added.slice(0, 12).join(', ')}${added.length > 12 ? ` …(+${added.length - 12})` : ''}`);
	for (const m of moves.slice(0, 15)) console.log(`  moved ${m.level}: ${m.from} -> ${m.to} (sim ${m.similarity})`);
	if (moves.length > 15) console.log(`  … ${moves.length - 15} more moves`);
	prev = provisions;
}
