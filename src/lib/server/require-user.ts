import { redirect, type RequestEvent } from '@sveltejs/kit';

/** ログインが要るページ：ログインしていなければ /login?next=<元のパスと検索文字列> へ送る */
export function requireUser(event: Pick<RequestEvent, 'locals' | 'url'>) {
	if (!event.locals.user) {
		redirect(303, `/login?next=${encodeURIComponent(event.url.pathname + event.url.search)}`);
	}
	return event.locals.user;
}
