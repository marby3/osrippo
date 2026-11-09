// 課題の一覧（設計書 docs/spec/25.md 決めたこと4）
import { error } from '@sveltejs/kit';
import { env } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/d1';
import { parseListQuery } from '#lib/domain/issues.ts';
import { parseQuery } from '#lib/domain/search.ts';
import { nowOf } from '#lib/server/client.ts';
import { currentTopic, listIssues } from '#lib/server/issues.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const { url } = event;
	const query = parseListQuery(url.searchParams);
	if (!query) error(404);
	const db = drizzle(env.DB);
	const topic = await currentTopic(db);
	// 「課題を探す」：言葉の形が違えば探さず、理由を出して一覧を空にする（設計書 docs/spec/38.md 決めたこと5）
	const search = parseQuery(query.q);
	const { rows, hasNext } = search.ok
		? await listIssues(db, query, topic?.id ?? null, nowOf(event), search.words)
		: { rows: [], hasNext: false };
	// 2ページ目以降で課題がなければ 404
	if (query.page > 1 && rows.length === 0) error(404);
	// スマホの「＋課題を書く」は下のタブの上に留める（Issue #120）
	return { spBottomBar: true as const, query, topic, rows, hasNext, searchError: search.ok ? null : search.error, searching: search.ok && search.words.length > 0 };
};
