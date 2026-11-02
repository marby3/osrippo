import { building } from '$app/env';
import { env } from 'cloudflare:workers';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import type { Handle } from '@sveltejs/kit/hooks';
import { createAuth, hasSessionCookie } from '#lib/server/auth.ts';

/**
 * Better Auth の経路のうち、外から呼べるのは提供元から戻るところだけ。
 * ほかの操作（ログイン・ログアウト）はサーバーから auth.api で呼ぶ。
 * 標準で開いている /update-user（表示名や画像を書き換えられる）や /sign-in/social（safeNext を通らない）を塞ぐ
 */
const PUBLIC_AUTH_PATHS = new Set(['/api/auth/callback/google', '/api/auth/callback/line']);

export const handle: Handle = async ({ event, resolve }) => {
	if (event.url.pathname.startsWith('/api/auth/') && !PUBLIC_AUTH_PATHS.has(event.url.pathname)) {
		return new Response('Not Found', { status: 404 });
	}
	const auth = createAuth(env);
	event.locals.auth = auth;
	event.locals.user = null;
	// セッションの Cookie がないときは D1 を引かない
	if (hasSessionCookie(event.request.headers.get('cookie'))) {
		const session = await auth.api.getSession({ headers: event.request.headers });
		event.locals.user = session?.user ?? null;
	}
	return svelteKitHandler({ event, resolve, auth, building });
};
