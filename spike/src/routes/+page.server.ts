import { env } from 'cloudflare:workers';
import type { PageServerLoad } from './$types';

// 3文字以上は trigram、2文字以下は bigram の表で引く（trigram は2文字語を引けない）
function bigramQuery(q: string) {
	const t = q.replace(/\s+/g, '');
	if (t.length <= 2) return `"${t}"`;
	const g: string[] = [];
	for (let i = 0; i < t.length - 1; i++) g.push(t.slice(i, i + 2));
	return `"${g.join(' ')}"`;
}

export const load: PageServerLoad = async ({ url }) => {
	const db = env.DB;
	const laws = (
		await db
			.prepare('SELECT law_id, title, count(*) n, max(enforcement_date) latest FROM law_revisions GROUP BY law_id ORDER BY title')
			.all<{ law_id: string; title: string; n: number; latest: string }>()
	).results;
	const q = (url.searchParams.get('q') ?? '').trim().replaceAll('"', '');
	if (!q) return { laws, q, hits: [] };
	// 検索は各法令の最新の版だけ
	const latest = `(SELECT revision_id FROM law_revisions r WHERE r.enforcement_date = (SELECT max(enforcement_date) FROM law_revisions s WHERE s.law_id = r.law_id))`;
	const sql =
		q.length >= 3
			? `SELECT law_title, article_title, snippet(unit_fts, 2, '【', '】', '…', 16) snippet, revision_id FROM unit_fts WHERE unit_fts MATCH ?1 AND revision_id IN ${latest} ORDER BY rank LIMIT 30`
			: `SELECT f.law_title, f.article_title, f.text snippet, b.revision_id FROM unit_bigram b JOIN unit_fts f ON f.rowid = b.rowid WHERE unit_bigram MATCH ?1 AND b.revision_id IN ${latest} ORDER BY b.rank LIMIT 30`;
	const t0 = Date.now();
	const res = await db.prepare(sql).bind(q.length >= 3 ? `"${q}"` : bigramQuery(q)).all<{ law_title: string; article_title: string; snippet: string; revision_id: string }>();
	return { laws, q, hits: res.results, ms: Date.now() - t0 };
};
