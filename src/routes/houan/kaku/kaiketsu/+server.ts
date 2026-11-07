// 書く画面の「ほかの課題の解決策を探す」（Issue #53。設計書 docs/spec/53.md 決めたこと7）。/kensaku と同じ探し方で、公開の情報なのでログインは要らない。
// 回数の制限は /kensaku と同じく WAF で掛ける。言葉の形の誤りは 200 で理由を返す
import { json } from '@sveltejs/kit';
import { env } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/d1';
import { parseQuery } from '#lib/domain/search.ts';
import { searchSolutions } from '#lib/server/search.ts';
import type { RequestHandler } from './$types';

/** 出す件数。当てはまる数がこれより多ければ、続きがあることを返す */
const ROWS = 20;

export const GET: RequestHandler = async ({ url }) => {
	const query = parseQuery(url.searchParams.get('q'));
	if (!query.ok) return json({ error: query.error });
	if (!query.words.length) return json({ rows: [], more: false });
	const { total, rows } = await searchSolutions(drizzle(env.DB), query.words, ROWS);
	return json({
		rows: rows.map((r) => ({ id: r.id, body: r.body, issueId: r.issueId, issueTitle: r.issueTitle })),
		more: total > ROWS
	});
};
