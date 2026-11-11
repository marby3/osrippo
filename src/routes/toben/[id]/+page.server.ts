// 答弁イベントのページと取り消し（Issue #153）
import { error, fail } from '@sveltejs/kit';
import { env } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/d1';
import { ja } from '#lib/copy/ja.ts';
import { parseIssueId } from '#lib/domain/issues.ts';
import { nowOf, writeGuard } from '#lib/server/client.ts';
import { cancelToben, tobenOf } from '#lib/server/toben.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const id = parseIssueId(event.params.id);
	if (id === null) error(404);
	const e = await tobenOf(drizzle(env.DB), id, nowOf(event), event.locals.user?.id ?? null);
	if (!e) error(404);
	return { e };
};

export const actions: Actions = {
	/** 取り消す。告知した議員だけ（選挙期間中の議員は writeGuard の legislator で断る） */
	cancel: async (event) => {
		const id = parseIssueId(event.params.id);
		if (id === null) error(404);
		const user = event.locals.user;
		if (!user) error(403);
		const db = drizzle(env.DB);
		const now = nowOf(event);
		const guard = await writeGuard(event, db, user, now, 'legislator');
		if (!guard.ok) return guard.failure;
		const refused = await cancelToben(db, id, user.id, now);
		if (refused === 'missing') error(404);
		if (refused === 'forbidden') return fail(403, { message: ja.toben.errors.forbidden });
		if (refused === 'started' || refused === 'cancelled') return fail(409, { message: ja.toben.errors[refused] });
		return { cancelled: true };
	}
};
