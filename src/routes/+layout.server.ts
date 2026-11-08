// 全体のメニューのベル（Issue #85）。未読の数はページを移るたびに求め直す
import { env } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/d1';
import { nowOf, sessionsAt } from '#lib/server/client.ts';
import { unreadCount } from '#lib/server/notification-page.ts';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async (event) => {
	// url を読むと、ページを移るたびにこの load が走り直す（読まないと、通知を読んだあとも古い数が残る）
	const { pathname, searchParams } = event.url;
	const user = event.locals.user;
	if (!user) return { menu: { unread: null } };
	// 通知の1ページ目は開くと既読になる。ページの load と並んで走るので、ここでは 0 として出す
	if (pathname === '/tsuchi' && (searchParams.get('page') ?? '1') === '1') return { menu: { unread: 0 } };
	const now = nowOf(event);
	return { menu: { unread: await unreadCount(drizzle(env.DB), user.id, now, sessionsAt(now).minutes) } };
};
