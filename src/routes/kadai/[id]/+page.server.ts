// 課題のページと「わかる」（設計書 docs/spec/25.md 決めたこと5・6）
import { error, fail, redirect } from '@sveltejs/kit';
import { env } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/d1';
import { parseIssueId } from '#lib/domain/issues.ts';
import { refusalMessage, writeGuard } from '#lib/server/client.ts';
import { getIssue, issueExists, setSupport } from '#lib/server/issues.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	const id = parseIssueId(params.id);
	if (id === null) error(404);
	const issue = await getIssue(drizzle(env.DB), id, locals.user?.id ?? null);
	if (!issue) error(404);
	return { issue };
};

export const actions: Actions = {
	support: async (event) => {
		const { params, locals, request } = event;
		// 番号の形と課題があるかを、ログインより先に確かめる
		const id = parseIssueId(params.id);
		if (id === null) error(404);
		const db = drizzle(env.DB);
		if (!(await issueExists(db, id))) error(404);
		if (!locals.user) redirect(303, `/login?next=${encodeURIComponent(`/kadai/${id}`)}`);

		const now = Date.now();
		const guard = await writeGuard(event, db, locals.user, now);
		if (!guard.ok) return guard.failure;
		const op = (await request.formData()).get('op');
		if (op !== 'add' && op !== 'remove') error(400);
		const result = await setSupport(db, guard.actor, id, op, now);
		if (!result.ok) return fail(429, { message: refusalMessage(result.refusal) });
		return { supported: result.supported };
	}
};
