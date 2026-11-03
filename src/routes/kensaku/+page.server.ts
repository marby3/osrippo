// 全文検索（設計書 docs/spec/38.md 決めたこと2〜6）
import { error } from '@sveltejs/kit';
import { env } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/d1';
import { PAGE_SIZE, parsePage } from '#lib/domain/issues.ts';
import { parseQuery, snippet } from '#lib/domain/search.ts';
import { PROVISION_CAP, searchIssues, searchLaws, searchProvisions, searchSolutions } from '#lib/server/search.ts';
import type { PageServerLoad } from './$types';

const SHURUI = ['jobun', 'kadai', 'kaiketsu'] as const;
type Shurui = (typeof SHURUI)[number];
/** まとめて見せるときの各欄の件数 */
const OVERVIEW = 20;

export const load: PageServerLoad = async ({ url }) => {
	const raw = url.searchParams.get('q');
	const shuruiRaw = url.searchParams.get('shurui');
	// shurui と page は形が違えば 404（信頼の境界）。言葉の形が違うときは 200 で理由を出す
	if (shuruiRaw !== null && !(SHURUI as readonly string[]).includes(shuruiRaw)) error(404);
	const shurui = shuruiRaw as Shurui | null;
	const page = parsePage(url.searchParams.get('page'));
	if (page === null || (page > 1 && shurui === null)) error(404);
	const query = parseQuery(raw);
	const q = raw ?? '';
	if (!query.ok) return { q, shurui, page, error: query.error, results: null };
	if (query.words.length === 0) return { q, shurui, page, error: null, results: null };

	const db = drizzle(env.DB);
	const words = query.words;
	const limit = shurui ? PAGE_SIZE : OVERVIEW;
	const offset = (page - 1) * PAGE_SIZE;
	const want = (s: Shurui) => shurui === null || shurui === s;

	const provisions = want('jobun') ? await searchProvisions(db, words) : null;
	const jobun = provisions && {
		total: provisions.total,
		capped: provisions.total > PROVISION_CAP,
		rows: provisions.rows.slice(offset, offset + limit).map((r) => ({ ...r, parts: snippet(r.text, words) }))
	};
	const issues = want('kadai') ? await searchIssues(db, words, limit, offset) : null;
	const kadai = issues && {
		total: issues.total,
		rows: issues.rows.map((r) => ({
			id: r.id,
			title: r.title,
			supports: r.supports,
			parts: snippet(`${r.title}　${r.affected}　${r.example}`, words)
		}))
	};
	const solutions = want('kaiketsu') ? await searchSolutions(db, words, limit, offset) : null;
	const kaiketsu = solutions && {
		total: solutions.total,
		rows: solutions.rows.map((r) => ({ ...r, parts: snippet(r.body, words) }))
	};
	// 種類だけを見るとき：その種類の行がないページ（2ページ目以降）は 404
	if (shurui && page > 1) {
		const shown = { jobun: jobun?.rows.length, kadai: kadai?.rows.length, kaiketsu: kaiketsu?.rows.length }[shurui];
		if (!shown) error(404);
	}
	const hasNext = shurui
		? {
				jobun: Math.min(jobun?.total ?? 0, PROVISION_CAP),
				kadai: kadai?.total ?? 0,
				kaiketsu: kaiketsu?.total ?? 0
			}[shurui] > page * PAGE_SIZE
		: false;
	return {
		q,
		shurui,
		page,
		error: null,
		results: { laws: shurui === null ? await searchLaws(db, words) : null, jobun, kadai, kaiketsu, hasNext }
	};
};
