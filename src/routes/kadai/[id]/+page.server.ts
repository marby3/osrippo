// 課題のページと「わかる」（設計書 docs/spec/25.md 決めたこと5・6）、通報と非表示（docs/spec/28.md 決めたこと1〜4）
import { error, fail, redirect } from '@sveltejs/kit';
import { env } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/d1';
import { ja } from '#lib/copy/ja.ts';
import { parseIssueId } from '#lib/domain/issues.ts';
import { isHidden, validateReport } from '#lib/domain/reports.ts';
import { refusalMessage, writeGuard } from '#lib/server/client.ts';
import { getIssue, issueMeta, setSupport } from '#lib/server/issues.ts';
import { hasReported, reportIssue, roleOf } from '#lib/server/reports.ts';
import type { Actions, PageServerLoad, RequestEvent } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	const id = parseIssueId(params.id);
	if (id === null) error(404);
	const db = drizzle(env.DB);
	const userId = locals.user?.id ?? null;
	const issue = await getIssue(db, id, userId);
	if (!issue) error(404);
	const { userId: authorId, ...rest } = issue;
	const staff = userId !== null && (await roleOf(db, userId)) !== null;
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
		reported: userId !== null && (await hasReported(db, id, userId))
	};
};

/** 番号の形と課題があるかを、ログインより先に確かめる。そのあとログイン → 国 → 締め出し */
async function prepare(event: RequestEvent) {
	const id = parseIssueId(event.params.id);
	if (id === null) error(404);
	const db = drizzle(env.DB);
	const meta = await issueMeta(db, id);
	if (!meta) error(404);
	const user = event.locals.user;
	if (!user) redirect(303, `/login?next=${encodeURIComponent(`/kadai/${id}`)}`);
	const now = Date.now();
	const guard = await writeGuard(event, db, user, now);
	return { id, db, meta, user, now, guard };
}

export const actions: Actions = {
	support: async (event) => {
		const { id, db, meta, now, guard } = await prepare(event);
		if (!guard.ok) return guard.failure;
		const op = (await event.request.formData()).get('op');
		if (op !== 'add' && op !== 'remove') error(400);
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
		if (isHidden(meta.status)) return fail(403, { message: ja.report.hiddenIssue });
		const result = await reportIssue(db, guard.actor, id, checked.value, now);
		if (!result.ok) return fail(429, { message: refusalMessage(result.refusal) });
		return { reportMessage: result.already ? ja.report.already : ja.report.done };
	}
};
