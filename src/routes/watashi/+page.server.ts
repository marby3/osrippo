import { env } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/d1';
import { nowOf, sessionsAt } from '#lib/server/client.ts';
import { unreadCount } from '#lib/server/notification-page.ts';
import { requireUser } from '#lib/server/require-user.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const user = requireUser(event);
	const now = nowOf(event);
	return { name: user.name, unread: await unreadCount(drizzle(env.DB), user.id, now, sessionsAt(now).minutes) };
};
