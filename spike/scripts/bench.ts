// Workers の CPU 時間の見積もり。workerd と同じ V8 なので Node で測る（I/O 待ちは CPU 時間に入らない）
import { readFileSync } from 'node:fs';
import { parseLaw, expandDeletedRanges } from '../src/lib/law/parse';
import { assignIds } from '../src/lib/law/identity';
import { diffLaw, type ProvisionRow, type UnitRow } from '../src/lib/law/diff';

const median = (f: () => void, n = 5) => {
	f(); // 1回目はJITの暖機
	const t: number[] = [];
	for (let i = 0; i < n; i++) {
		const s = process.cpuUsage();
		f();
		const d = process.cpuUsage(s);
		t.push((d.user + d.system) / 1000);
	}
	return `${t.sort((a, b) => a - b)[Math.floor(n / 2)].toFixed(1)}ms`;
};

const F = '../tests/fixtures/egov/';
const pairs: [string, string, string][] = [
	['消費者契約法', 'law_data_412AC0000000061_20171001_429AC0000000043.json', 'law_data_412AC0000000061_20190615_430AC0000000054.json'],
	['民法', 'law_data_129AC0000000089_20200301_429AC0000000044.json', 'law_data_129AC0000000089_20200401_501AC0000000034.json']
];
for (const [name, a, b] of pairs) {
	const ra = readFileSync(F + a, 'utf8'), rb = readFileSync(F + b, 'utf8');
	const pa = expandDeletedRanges(parseLaw(JSON.parse(ra)).provisions), pb = expandDeletedRanges(parseLaw(JSON.parse(rb)).provisions);
	const ia = assignIds(null, pa).provisions;
	const ib = assignIds(ia, pb).provisions;
	const rows = (ps: typeof ia) => ({
		provisions: ps.map((p, i): ProvisionRow => ({ provision_id: p.id, ord: i, key: p.key, kind: p.kind, title: p.title, caption: p.caption, deleted: +p.deleted })),
		units: ps.flatMap((p) => p.units.map((u, j): UnitRow => ({ provision_id: p.id, unit_id: u.id, ord: j, path: u.path, label: u.label, text: u.text })))
	});
	const [xa, xb] = [rows(ia), rows(ib)];
	console.log(`${name} (${(rb.length / 1024) | 0}KB)`);
	console.log(`  JSON.parse            ${median(() => JSON.parse(rb))}`);
	console.log(`  条・項・号に分ける     ${median(() => expandDeletedRanges(parseLaw(JSON.parse(rb)).provisions))}`);
	console.log(`  内部IDの引き継ぎ       ${median(() => assignIds(ia, pb))}`);
	console.log(`  2時点の差分（画面1回） ${median(() => diffLaw(xa, xb))}`);
}

// 会期終了時の処理：採決の集計 → 可決法案の反映 → 現実の改正の反映 → 衝突の検出
// 規模は β の上限寄りに置く：参加者 2,000人、法案 100本、1人あたり10本に投票、可決30本×3か所の変更
const law = assignIds(null, expandDeletedRanges(parseLaw(JSON.parse(readFileSync(F + pairs[1][1], 'utf8'))).provisions)).provisions;
const units = law.flatMap((p) => p.units.map((u) => ({ pid: p.id, ...u })));
let seed = 1;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const votes = Array.from({ length: 20_000 }, (_, i) => ({ voter: i % 2000, bill: Math.floor(rnd() * 100), yes: rnd() < 0.55, at: 1e9 + rnd() * 2.4e6, eligible: rnd() < 0.9 }));
const bills = Array.from({ length: 100 }, (_, b) => ({ id: b, changes: Array.from({ length: 3 }, () => units[Math.floor(rnd() * units.length)]) }));
const real = new Set(Array.from({ length: 422 }, () => law[Math.floor(rnd() * law.length)].id)); // 民法2020年改正と同じ422条
const sessionEnd = () => {
	const tally = new Map<number, { yes: number; no: number; ref: number; times: number[] }>();
	for (const v of votes) {
		const t = tally.get(v.bill) ?? { yes: 0, no: 0, ref: 0, times: [] };
		if (!v.eligible) t.ref++;
		else if (v.yes) t.yes++;
		else t.no++;
		t.times.push(v.at);
		tally.set(v.bill, t);
	}
	// 異常検知の代わり：1時間あたりの票の偏り
	for (const t of tally.values()) {
		const buckets = new Map<number, number>();
		for (const x of t.times) buckets.set(Math.floor(x / 3600), (buckets.get(Math.floor(x / 3600)) ?? 0) + 1);
		Math.max(...buckets.values());
	}
	const passed = bills.filter((b) => { const t = tally.get(b.id)!; return t.yes > t.no; });
	const ifText = new Map(units.map((u) => [u.id, u.text]));
	const touched = new Set<string>();
	for (const b of passed) for (const c of b.changes) { ifText.set(c.id, ifText.get(c.id)! + '（改正）'); touched.add(c.pid); }
	const conflicts = [...real].filter((id) => touched.has(id));
	return { passed: passed.length, conflicts: conflicts.length };
};
console.log(`会期終了時の処理（民法1本、票2万、法案100本）: ${median(sessionEnd)} → ${JSON.stringify(sessionEnd())}`);
