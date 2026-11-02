// フィクスチャから D1 に流す SQL を作る（自宅サーバーのバッチに相当）
import { readFileSync, writeFileSync } from 'node:fs';
import { parseLaw, expandDeletedRanges } from '../src/lib/law/parse';
import { assignIds, type IdedProvision } from '../src/lib/law/identity';

const bigrams = (s: string) => {
	const t = s.replace(/[\s。、，（）「」]/g, '');
	const g: string[] = [];
	for (let i = 0; i < t.length - 1; i++) g.push(t.slice(i, i + 2));
	return g.join(' ');
};
const q = (s: string) => `'${s.replaceAll("'", "''")}'`;
const [out, ...groups] = process.argv.slice(2);
const sql: string[] = [];
// 引数は "法令ごとの版をカンマ区切り"。同じ法令の版は古い順に内部IDを引き継ぐ
for (const g of groups) {
	let prev: IdedProvision[] | null = null;
	for (const f of g.split(',')) {
		const law = parseLaw(JSON.parse(readFileSync(f, 'utf8')));
		const { provisions } = assignIds(prev, expandDeletedRanges(law.provisions));
		prev = provisions;
		const r = law.revisionId;
		sql.push(`INSERT INTO law_revisions VALUES (${q(r)}, ${q(law.lawId)}, ${q(law.title)}, ${q(law.enforcementDate)});`);
		provisions.forEach((p, i) => {
			sql.push(`INSERT INTO provision_versions VALUES (${q(r)}, ${q(p.id)}, ${i}, ${q(p.key)}, ${q(p.kind)}, ${q(p.num)}, ${q(p.title)}, ${q(p.caption)}, ${p.deleted ? 1 : 0});`);
			p.units.forEach((u, j) => {
				sql.push(`INSERT INTO unit_versions VALUES (${q(r)}, ${q(u.id)}, ${q(p.id)}, ${j}, ${q(u.path)}, ${q(u.label)}, ${q(u.text)});`);
				// 検索は項・号の単位で持つ（条ごとだと附則・別表がD1の1文100KBの上限を超える）
				if (!u.text) return;
				sql.push(`INSERT INTO unit_fts VALUES (${q(law.title)}, ${q(p.title + p.caption)}, ${q(u.text)}, ${q(r)}, ${q(p.id)});`);
				sql.push(`INSERT INTO unit_bigram VALUES (${q(bigrams(u.text))}, ${q(r)}, ${q(p.id)});`);
			});
		});
	}
}
writeFileSync(out, sql.join('\n') + '\n');
console.log(`${sql.length} statements -> ${out}`);
