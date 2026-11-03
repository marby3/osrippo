// 運営の記録（設計書 docs/spec/28.md 決めたこと6）。だれでも見られる
import { error } from '@sveltejs/kit';
import { env } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/d1';
import { parsePage } from '#lib/domain/issues.ts';
import { moderationLogPage } from '#lib/server/reports.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const page = parsePage(url.searchParams.get('page'));
	if (page === null) error(404);
	const { rows, hasNext } = await moderationLogPage(drizzle(env.DB), page);
	if (page > 1 && rows.length === 0) error(404);
	return { page, rows, hasNext };
};
