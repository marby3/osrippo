// この課題から生まれた法案の一覧（Issue #125）。数え方は src/lib/server/issue-bills.ts
import { error, redirect } from '@sveltejs/kit';
import { env } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/d1';
import { lapsedBefore } from '#lib/domain/bills.ts';
import { parseIssueId } from '#lib/domain/issues.ts';
import { isHidden } from '#lib/domain/reports.ts';
import { staffRoleOf } from '#lib/server/chairs.ts';
import { nowOf, sessionsAt } from '#lib/server/client.ts';
import { issueBills } from '#lib/server/issue-bills.ts';
import { getIssue } from '#lib/server/issues.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals, request, url }) => {
	const id = parseIssueId(params.id);
	if (id === null) error(404);
	const db = drizzle(env.DB);
	const userId = locals.user?.id ?? null;
	const issue = await getIssue(db, id, userId);
	if (!issue) error(404);
	// 統合された課題は統合先の一覧へ（解決策は統合先へ移っている）
	if (issue.status === 'merged' && issue.mergedInto !== null) redirect(308, `/kadai/${issue.mergedInto}/houan`);
	const now = nowOf({ url, request });
	const { previous, minutes } = sessionsAt(now);
	// 書いた本人と運営以外には、非表示の課題の題名を渡さない（課題のページと同じ。docs/spec/28.md 決めたこと4）
	if (isHidden(issue.status) && userId !== issue.userId && (userId === null || (await staffRoleOf(db, userId, now, minutes)) === null)) {
		return { view: 'hidden' as const, id, status: issue.status, statusReason: issue.statusReason };
	}
	return {
		view: 'full' as const,
		issue: { id, title: issue.title },
		hidden: isHidden(issue.status),
		// 法案の一覧の「終わった」と同じ切れ目で、下書き・審議中・終わったに分ける
		bills: await issueBills(db, id, lapsedBefore(previous))
	};
};
