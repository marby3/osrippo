// ホーム（Issue #44：今の会期）
import { env } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/d1';
import { nowOf, sessionsAt } from '#lib/server/client.ts';
import { unreadCount } from '#lib/server/notification-page.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const now = nowOf(event);
	const { session, minutes } = sessionsAt(now);
	const user = event.locals.user;
	return { session, unread: user ? await unreadCount(drizzle(env.DB), user.id, now, minutes) : null };
};
