// 運営の記録（設計書 docs/spec/28.md 決めたこと6）。だれでも見られる
import { error } from '@sveltejs/kit';
import { env } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/d1';
import { parsePage } from '#lib/domain/issues.ts';
import { billModerationLogPage } from '#lib/server/post-moderation.ts';
import { moderationLogPage } from '#lib/server/reports.ts';
import { reviewLogPage } from '#lib/server/results.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const page = parsePage(url.searchParams.get('page'));
	const reviewPage = parsePage(url.searchParams.get('kakunin'));
	const postPage = parsePage(url.searchParams.get('shitsugi'));
	if (page === null || reviewPage === null || postPage === null) error(404);
	const db = drizzle(env.DB);
	const { rows, hasNext } = await moderationLogPage(db, page);
	if (page > 1 && rows.length === 0) error(404);
	const reviews = await reviewLogPage(db, reviewPage);
	if (reviewPage > 1 && reviews.rows.length === 0) error(404);
	const postLogs = await billModerationLogPage(db, postPage);
	if (postPage > 1 && postLogs.rows.length === 0) error(404);
	return { page, rows, hasNext, reviewPage, reviews: reviews.rows, reviewsHasNext: reviews.hasNext, postPage, postLogs: postLogs.rows, postLogsHasNext: postLogs.hasNext };
};
