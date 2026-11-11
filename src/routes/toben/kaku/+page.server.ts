// 答弁イベントの告知（Issue #153）。議員だけ。ほかの人には 404（送っても writeGuard の legislator で 403）
import { error, fail, redirect } from '@sveltejs/kit';
import { env } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/d1';
import { ja } from '#lib/copy/ja.ts';
import { parseToben } from '#lib/domain/toben.ts';
import { nowOf, writeGuard } from '#lib/server/client.ts';
import { createToben, overlapsElection, tobenTargetExists } from '#lib/server/toben.ts';
import { legislatorAt } from '#lib/server/verifications.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const user = event.locals.user;
	if (!user || !(await legislatorAt(drizzle(env.DB), user.id, nowOf(event)))) error(404);
	return {};
};

export const actions: Actions = {
	default: async (event) => {
		const user = event.locals.user;
		if (!user) error(403);
		const db = drizzle(env.DB);
		const now = nowOf(event);
		const guard = await writeGuard(event, db, user, now, 'legislator');
		if (!guard.ok) return guard.failure;
		const form = await event.request.formData();
		const field = (name: string) => (form.has(name) ? String(form.get(name)) : null);
		const values = { kind: field('kind'), target: field('target'), title: field('title'), starts: field('starts'), ends: field('ends') };
		const parsed = parseToben(values, now);
		if (!parsed.ok) return fail(400, { message: ja.toben.errors[parsed.error], values });
		const v = parsed.value;
		if (!(await tobenTargetExists(db, v.kind, v.targetId))) return fail(400, { message: ja.toben.errors.missing, values });
		if (await overlapsElection(db, v.startsAt, v.endsAt)) return fail(400, { message: ja.toben.errors.election, values });
		const id = await createToben(db, { userId: user.id, ...v }, now);
		redirect(303, `/toben/${id}`);
	}
};
