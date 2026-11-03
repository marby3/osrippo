// 課題の一覧（設計書 docs/spec/25.md 決めたこと4）
import { error } from '@sveltejs/kit';
import { env } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/d1';
import { parseListQuery } from '#lib/domain/issues.ts';
import { currentTopic, listIssues } from '#lib/server/issues.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const query = parseListQuery(url.searchParams);
	if (!query) error(404);
	const db = drizzle(env.DB);
	const topic = await currentTopic(db);
	const { rows, hasNext } = await listIssues(db, query, topic?.id ?? null, Date.now());
	// 2ページ目以降で課題がなければ 404
	if (query.page > 1 && rows.length === 0) error(404);
	return { query, topic, rows, hasNext };
};
