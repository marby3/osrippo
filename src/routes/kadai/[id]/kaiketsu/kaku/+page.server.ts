// 解決策を書く（設計書 docs/spec/34.md 決めたこと1・2）
import { error, fail, redirect } from '@sveltejs/kit';
import { env } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/d1';
import { ja } from '#lib/copy/ja.ts';
import { parseIssueId } from '#lib/domain/issues.ts';
import { LISTED } from '#lib/domain/reports.ts';
import { validateSolution } from '#lib/domain/solutions.ts';
import { checkTurnstile, nowOf, refusalMessage, writeGuard } from '#lib/server/client.ts';
import { getIssue, issueMeta } from '#lib/server/issues.ts';
import { requireUser } from '#lib/server/require-user.ts';
import { createSolution } from '#lib/server/solutions.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const id = parseIssueId(event.params.id);
	if (id === null) error(404);
	const issue = await getIssue(drizzle(env.DB), id, null);
	if (!issue) error(404);
	// ページを開くときだけ：統合済みは統合先の書く画面へ、非表示は 404（投稿を断ったあとの画面では、断った理由を出す）
	if (event.request.method === 'GET' || event.request.method === 'HEAD') {
		if (issue.status === 'merged' && issue.mergedInto !== null) redirect(308, `/kadai/${issue.mergedInto}/kaiketsu/kaku`);
		if (!LISTED.includes(issue.status)) error(404);
	}
	requireUser(event);
	return { issue: { id, title: issue.title }, siteKey: env.TURNSTILE_SITE_KEY };
};

export const actions: Actions = {
	default: async (event) => {
		// 課題の番号と課題があるか（ログインより先）→ ログイン → 国 → 締め出し → Turnstile → 入力 → 課題の状態 → レート制限 → 保存
		const id = parseIssueId(event.params.id);
		if (id === null) error(404);
		const db = drizzle(env.DB);
		const meta = await issueMeta(db, id);
		if (!meta) error(404);
		const user = requireUser(event);
		const now = nowOf(event);
		const form = await event.request.formData();
		const body = String(form.get('body') ?? '');

		const guard = await writeGuard(event, db, user, now);
		if (!guard.ok) return fail(guard.failure.status, { ...guard.failure.data, body });
		if (!(await checkTurnstile(event, String(form.get('cf-turnstile-response') ?? ''), guard.ip))) {
			return fail(400, { message: ja.guard.turnstileFailed, body });
		}
		const checked = validateSolution(body);
		if (!checked.ok) return fail(400, { error: checked.error, body });
		if (!LISTED.includes(meta.status)) return fail(403, { message: ja.solution.cannotWrite, body });
		const result = await createSolution(db, guard.actor, id, checked.body, now);
		if (!result.ok) return fail(429, { message: refusalMessage(result.refusal), body });
		// 確かめたあとに統合・非表示になっていたら、保存しない
		if (!result.created) return fail(403, { message: ja.solution.cannotWrite, body });
		redirect(303, `/kadai/${id}`);
	}
};
