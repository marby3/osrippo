// 課題を書く（設計書 docs/spec/25.md 決めたこと2・3・12）
import { fail, redirect } from '@sveltejs/kit';
import { env } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/d1';
import { ja } from '#lib/copy/ja.ts';
import { validateIssue, type IssueField } from '#lib/domain/issues.ts';
import { checkTurnstile, refusalMessage, writeGuard } from '#lib/server/client.ts';
import { createIssue, currentTopic } from '#lib/server/issues.ts';
import { requireUser } from '#lib/server/require-user.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	requireUser(event);
	return { topic: await currentTopic(drizzle(env.DB)), siteKey: env.TURNSTILE_SITE_KEY };
};

const FIELDS: IssueField[] = ['title', 'affected', 'example', 'topic'];

export const actions: Actions = {
	default: async (event) => {
		const user = requireUser(event);
		const db = drizzle(env.DB);
		const now = Date.now();
		const form = await event.request.formData();
		// 断ったときも入力は残す
		const values = Object.fromEntries(FIELDS.map((f) => [f, String(form.get(f) ?? '')])) as Record<IssueField, string>;

		const guard = await writeGuard(event, db, user, now);
		if (!guard.ok) return fail(guard.failure.status, { ...guard.failure.data, values });
		if (!(await checkTurnstile(event, String(form.get('cf-turnstile-response') ?? ''), guard.ip))) {
			return fail(400, { message: ja.guard.turnstileFailed, values });
		}
		const topic = await currentTopic(db);
		const checked = validateIssue(values, topic?.id ?? null);
		if (!checked.ok) return fail(400, { errors: checked.errors, values });
		const result = await createIssue(db, guard.actor, checked.value, now);
		if (!result.ok) return fail(429, { message: refusalMessage(result.refusal), values });
		redirect(303, `/kadai/${result.id}`);
	}
};
