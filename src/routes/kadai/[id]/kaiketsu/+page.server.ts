// 解決策の一覧（設計書 docs/spec/34.md 決めたこと4・5）
import { error, redirect } from '@sveltejs/kit';
import { env } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/d1';
import { PAGE_SIZE, parseIssueId, parsePage } from '#lib/domain/issues.ts';
import { isHidden } from '#lib/domain/reports.ts';
import { getIssue } from '#lib/server/issues.ts';
import { roleOf } from '#lib/server/reports.ts';
import { reactAction } from '#lib/server/solution-actions.ts';
import { listSolutions } from '#lib/server/solutions.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals, request, url }) => {
	const id = parseIssueId(params.id);
	if (id === null) error(404);
	const db = drizzle(env.DB);
	const userId = locals.user?.id ?? null;
	const issue = await getIssue(db, id, userId);
	if (!issue) error(404);
	// 統合された課題は統合先の一覧へ（フォームの操作を断ったあとの画面では転送しない）
	if (issue.status === 'merged' && issue.mergedInto !== null) {
		if (request.method === 'GET' || request.method === 'HEAD') redirect(308, `/kadai/${issue.mergedInto}/kaiketsu`);
		return { view: 'merged' as const, id, mergedInto: issue.mergedInto };
	}
	const page = parsePage(url.searchParams.get('page'));
	if (page === null) error(404);
	const hidden = isHidden(issue.status);
	const staff = userId !== null && (await roleOf(db, userId)) !== null;
	// 書いた本人と運営以外には、非表示の課題の解決策を渡さない（docs/spec/28.md 決めたこと4）
	if (hidden && userId !== issue.userId && !staff) {
		return { view: 'hidden' as const, id, status: issue.status, statusReason: issue.statusReason };
	}
	const rows = await listSolutions(db, id, userId, PAGE_SIZE + 1, (page - 1) * PAGE_SIZE);
	if (page > 1 && rows.length === 0) error(404);
	return {
		view: 'full' as const,
		issue: { id, title: issue.title },
		hidden,
		loggedIn: userId !== null,
		page,
		solutions: rows.slice(0, PAGE_SIZE),
		hasNext: rows.length > PAGE_SIZE
	};
};

export const actions: Actions = {
	react: (event) =>
		reactAction(event, (id) => {
			// ログインのあとは同じページへ戻る
			const page = event.url.searchParams.get('page');
			return page ? `/kadai/${id}/kaiketsu?page=${encodeURIComponent(page)}` : `/kadai/${id}/kaiketsu`;
		})
};
