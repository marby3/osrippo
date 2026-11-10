// 全体のメニューのベル（Issue #85）。未読の数はページを移るたびに求め直す
import { env } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/d1';
import { nowOf, sessionsAt } from '#lib/server/client.ts';
import { unreadCount } from '#lib/server/notification-page.ts';
import { legislatorNameAt } from '#lib/server/verifications.ts';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async (event) => {
	// url を読むと、ページを移るたびにこの load が走り直す（読まないと、通知を読んだあとも古い数が残る）
	const { pathname, searchParams } = event.url;
	const user = event.locals.user;
	// 表示の設定（Issue #129）。法令のページの「表示の設定」が今の値を選んだ状態で出すために使う
	const display = event.locals.display;
	if (!user) return { display, legislator: false, legislatorName: null, menu: { unread: null } };
	const db = drizzle(env.DB);
	const now = nowOf(event);
	// 議員か（設計書 docs/spec/158.md の 3）。議員には参加のボタンの代わりに文言を出し、ヘッダーに「議員用」と氏名を出す（docs/spec/149.md の 1）
	const legislatorName = await legislatorNameAt(db, user.id, now);
	const legislator = legislatorName !== null;
	// 通知の1ページ目（page なし。?page=1 は 404）は開くと既読になる。ページの load と並んで走るので、ここでは 0 として出す
	if (pathname === '/tsuchi' && searchParams.get('page') === null) return { display, legislator, legislatorName, menu: { unread: 0 } };
	return { display, legislator, legislatorName, menu: { unread: await unreadCount(db, user.id, now, sessionsAt(now).minutes) } };
};
