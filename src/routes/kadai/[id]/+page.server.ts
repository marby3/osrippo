// 課題のページと「わかる」（設計書 docs/spec/25.md 決めたこと5・6）、通報と非表示（docs/spec/28.md 決めたこと1〜4）
import { error, fail, redirect } from '@sveltejs/kit';
import { env } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/d1';
import { ja } from '#lib/copy/ja.ts';
import { parseIssueId } from '#lib/domain/issues.ts';
import { isHidden, validateReport } from '#lib/domain/reports.ts';
import { nowOf, refusalMessage, sessionsAt, writeGuard } from '#lib/server/client.ts';
import { getIssue, issueMeta, setSupport } from '#lib/server/issues.ts';
import { hasReported, mergedSources, reportIssue } from '#lib/server/reports.ts';
import { staffRoleOf } from '#lib/server/chairs.ts';
import { reactAction, reportSolutionAction } from '#lib/server/solution-actions.ts';
import { hasHiddenSolutions, listSolutions, reportedSolutionIds, solutionCount } from '#lib/server/solutions.ts';
import type { Db } from '#lib/server/law.ts';
import type { Actions, PageServerLoad, RequestEvent } from './$types';

/** 課題のページに出す解決策の数（設計書 docs/spec/34.md 決めたこと3） */
const TOP_SOLUTIONS = 3;

export const load: PageServerLoad = async ({ params, locals, request, url }) => {
	const id = parseIssueId(params.id);
	if (id === null) error(404);
	const db = drizzle(env.DB);
	const userId = locals.user?.id ?? null;
	const issue = await getIssue(db, id, userId);
	if (!issue) error(404);
	// 統合された課題は、だれが開いても統合先へ転送する（設計書 docs/spec/30.md 決めたこと8）。
	// フォームの操作を断ったあとの画面（POST）では転送せず、統合されたことと断った理由を出す
	if (issue.status === 'merged' && issue.mergedInto !== null) {
		if (request.method === 'GET' || request.method === 'HEAD') redirect(308, `/kadai/${issue.mergedInto}`);
		return { view: 'merged' as const, id, mergedInto: issue.mergedInto };
	}
	const { userId: authorId, mergedInto: _, ...rest } = issue;
	const now = nowOf({ url, request });
	const staff = userId !== null && (await staffRoleOf(db, userId, now, sessionsAt(now).minutes)) !== null;
	const mine = userId === authorId;
	const hidden = isHidden(issue.status);
	// 書いた本人と運営以外には、非表示の課題の題名も本文も渡さない（ページのデータにも載せない）
	if (hidden && !mine && !staff) {
		return { view: 'hidden' as const, id, status: issue.status, statusReason: issue.statusReason };
	}
	return {
		view: 'full' as const,
		issue: rest,
		hidden,
		mine,
		staff,
		loggedIn: userId !== null,
		reported: userId !== null && (await hasReported(db, id, userId)),
		sources: await mergedSources(db, id),
		...(await solutionsFor(db, id, userId, staff)),
		// 似た課題から「わかる」で来た人だけに、解決策を書く案内を出す（URL を共有された人には出さない）
		fromSimilar: url.searchParams.get('from') === 'nita' && userId !== null && !hidden && issue.supported
	};
};

/** 課題のページの解決策：表示中の上位3件と数、見る人が通報した解決策、本人・運営に見せられる非表示の解決策があるか */
async function solutionsFor(db: Db, id: number, userId: string | null, staff: boolean) {
	const solutions = await listSolutions(db, id, userId, TOP_SOLUTIONS);
	return {
		solutions,
		solutionCount: await solutionCount(db, id),
		reportedSolutions: await reportedSolutionIds(
			db,
			userId,
			solutions.map((s) => s.id)
		),
		hasHiddenSolutions: await hasHiddenSolutions(db, id, userId, staff)
	};
}

/** 番号の形と課題があるかを、ログインより先に確かめる。そのあとログイン → 国 → 締め出し */
async function prepare(event: RequestEvent) {
	const id = parseIssueId(event.params.id);
	if (id === null) error(404);
	const db = drizzle(env.DB);
	const meta = await issueMeta(db, id);
	if (!meta) error(404);
	const user = event.locals.user;
	if (!user) redirect(303, `/login?next=${encodeURIComponent(`/kadai/${id}`)}`);
	const now = nowOf(event);
	const guard = await writeGuard(event, db, user, now);
	return { id, db, meta, user, now, guard };
}

export const actions: Actions = {
	react: (event) => reactAction(event, (id) => `/kadai/${id}`),
	reportSolution: (event) => reportSolutionAction(event, (id) => `/kadai/${id}`),
	support: async (event) => {
		const { id, db, meta, now, guard } = await prepare(event);
		if (!guard.ok) return guard.failure;
		const op = (await event.request.formData()).get('op');
		if (op !== 'add' && op !== 'remove') error(400);
		if (meta.status === 'merged') return fail(403, { message: ja.merge.mergedOp });
		if (isHidden(meta.status)) return fail(403, { message: ja.report.hiddenIssue });
		const result = await setSupport(db, guard.actor, id, op, now);
		if (!result.ok) return fail(429, { message: refusalMessage(result.refusal) });
		return { supported: result.supported };
	},
	report: async (event) => {
		const { id, db, meta, user, now, guard } = await prepare(event);
		if (!guard.ok) return guard.failure;
		const form = await event.request.formData();
		const checked = validateReport({
			reason: form.has('reason') ? String(form.get('reason')) : null,
			note: form.has('note') ? String(form.get('note')) : null
		});
		if (!checked.ok || meta.userId === user.id) error(400);
		if (meta.status === 'merged') return fail(403, { message: ja.merge.mergedOp });
		if (isHidden(meta.status)) return fail(403, { message: ja.report.hiddenIssue });
		const result = await reportIssue(db, guard.actor, id, checked.value, now);
		if (!result.ok) return fail(429, { message: refusalMessage(result.refusal) });
		return { reportMessage: result.already ? ja.report.already : ja.report.done };
	}
};
