// 通知の一覧（Issue #78。設計書 docs/spec/78.md 決めたこと8・9）。1ページ目を開くと既読になる
import { error } from '@sveltejs/kit';
import { env } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/d1';
import { parsePage } from '#lib/domain/issues.ts';
import { nowOf, sessionsAt } from '#lib/server/client.ts';
import { notificationPage } from '#lib/server/notification-page.ts';
import { requireUser } from '#lib/server/require-user.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const user = requireUser(event);
	const page = parsePage(event.url.searchParams.get('page'));
	if (page === null) error(404);
	const now = nowOf(event);
	const { items, hasNext } = await notificationPage(drizzle(env.DB), user.id, now, sessionsAt(now).minutes, page);
	return { items, hasNext, page };
};
