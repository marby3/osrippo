// 運営の記録（設計書 docs/spec/28.md 決めたこと6）。だれでも見られる
import { error } from '@sveltejs/kit';
import { env } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/d1';
import { parsePage } from '#lib/domain/issues.ts';
import { billModerationLogPage } from '#lib/server/post-moderation.ts';
import { moderationLogPage } from '#lib/server/reports.ts';
import { reviewLogPage } from '#lib/server/results.ts';
import { tokyoDate } from '#lib/domain/law/display.ts';
import { verificationLogPage } from '#lib/server/verifications.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const page = parsePage(url.searchParams.get('page'));
	const reviewPage = parsePage(url.searchParams.get('kakunin'));
	const postPage = parsePage(url.searchParams.get('shitsugi'));
	const verifyPage = parsePage(url.searchParams.get('ninsho'));
	if (page === null || reviewPage === null || postPage === null || verifyPage === null) error(404);
	const db = drizzle(env.DB);
	const { rows, hasNext } = await moderationLogPage(db, page);
	if (page > 1 && rows.length === 0) error(404);
	const reviews = await reviewLogPage(db, reviewPage);
	if (reviewPage > 1 && reviews.rows.length === 0) error(404);
	const postLogs = await billModerationLogPage(db, postPage);
	if (postPage > 1 && postLogs.rows.length === 0) error(404);
	// 認証の記録（設計書 docs/spec/157.md の 4）。日付は操作した日（日本時間）
	const verifyLogs = await verificationLogPage(db, verifyPage);
	if (verifyPage > 1 && verifyLogs.rows.length === 0) error(404);
	return {
		page,
		rows,
		hasNext,
		reviewPage,
		reviews: reviews.rows,
		reviewsHasNext: reviews.hasNext,
		postPage,
		postLogs: postLogs.rows,
		postLogsHasNext: postLogs.hasNext,
		verifyPage,
		verifyLogs: verifyLogs.rows.map(({ createdAt, ...r }) => ({ ...r, date: tokyoDate(createdAt) })),
		verifyLogsHasNext: verifyLogs.hasNext
	};
};
