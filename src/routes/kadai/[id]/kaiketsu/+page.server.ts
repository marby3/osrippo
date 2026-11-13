// 解決策の一覧（設計書 docs/spec/34.md 決めたこと4・5）
import { error, redirect } from '@sveltejs/kit';
import { env } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/d1';
import { PAGE_SIZE, parseIssueId, parsePage } from '#lib/domain/issues.ts';
import { isHidden } from '#lib/domain/reports.ts';
import { getIssue } from '#lib/server/issues.ts';
import { staffRoleOf } from '#lib/server/chairs.ts';
import { nowOf, sessionsAt } from '#lib/server/client.ts';
import { reactAction, reportSolutionAction } from '#lib/server/solution-actions.ts';
import { listHiddenSolutions, listSolutions, reportedSolutionIds } from '#lib/server/solutions.ts';
import { lawRefsFor } from '#lib/server/law-refs.ts';
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
	const now = nowOf({ url, request });
	const staff = userId !== null && (await staffRoleOf(db, userId, now, sessionsAt(now).minutes)) !== null;
	// 書いた本人と運営以外には、非表示の課題の解決策を渡さない（docs/spec/28.md 決めたこと4）
	if (hidden && userId !== issue.userId && !staff) {
		return { view: 'hidden' as const, id, status: issue.status, statusReason: issue.statusReason };
	}
	const rows = await listSolutions(db, id, userId, PAGE_SIZE + 1, (page - 1) * PAGE_SIZE);
	if (page > 1 && rows.length === 0) error(404);
	const solutions = rows.slice(0, PAGE_SIZE);
	// 本人・運営に見せる非表示の解決策は、1ページ目の最後に出す（設計書 docs/spec/36.md 決めたこと4）
	const hiddenSolutions = page === 1 ? await listHiddenSolutions(db, id, userId, staff) : [];
	return {
		view: 'full' as const,
		issue: { id, title: issue.title },
		hidden,
		loggedIn: userId !== null,
		page,
		solutions,
		hasNext: rows.length > PAGE_SIZE,
		staff,
		reportedSolutions: await reportedSolutionIds(
			db,
			userId,
			solutions.map((s) => s.id)
		),
		hiddenSolutions,
		// 本文の「特商法9条」を条へのリンクにする（Issue #165）
		lawRefs: await lawRefsFor(db, [...solutions, ...hiddenSolutions].map((s) => s.body))
	};
};

/** ログインのあとは同じページへ戻る */
const backTo = (url: URL, id: number) => {
	const page = url.searchParams.get('page');
	return page ? `/kadai/${id}/kaiketsu?page=${encodeURIComponent(page)}` : `/kadai/${id}/kaiketsu`;
};

export const actions: Actions = {
	react: (event) => reactAction(event, (id) => backTo(event.url, id)),
	reportSolution: (event) => reportSolutionAction(event, (id) => backTo(event.url, id))
};
