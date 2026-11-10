import { building } from '$app/env';
import { env } from 'cloudflare:workers';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import type { Handle } from '@sveltejs/kit/hooks';
import { displayAttributes, parseDisplay } from '#lib/domain/display.ts';
import { createAuth, hasSessionCookie } from '#lib/server/auth.ts';
import { withNoindex } from '#lib/server/robots.ts';

/**
 * Better Auth の経路のうち、外から呼べるのは提供元から戻るところだけ。
 * ほかの操作（ログイン・ログアウト）はサーバーから auth.api で呼ぶ。
 * 標準で開いている /update-user（表示名や画像を書き換えられる）や /sign-in/social（safeNext を通らない）を塞ぐ
 */
const PUBLIC_AUTH_PATHS = new Set(['/api/auth/callback/google', '/api/auth/callback/line']);

/** ステージングでは、すべての応答に X-Robots-Tag を付ける（Issue #156） */
export const handle: Handle = async (input) => withNoindex(await handleRequest(input), env.NOINDEX);

const handleRequest: Handle = async ({ event, resolve }) => {
	if (event.url.pathname.startsWith('/api/auth/') && !PUBLIC_AUTH_PATHS.has(event.url.pathname)) {
		return new Response('Not Found', { status: 404 });
	}
	// auth は使うときに初めて作る。ログインに関係のない閲覧（法令ページなど）は、ログインの設定がなくても動く
	let auth: ReturnType<typeof createAuth> | undefined;
	const getAuth = () => (auth ??= createAuth(env));
	event.locals.auth = getAuth;
	event.locals.user = null;
	// セッションの Cookie がないときは D1 も auth も使わない
	if (hasSessionCookie(event.request.headers.get('cookie'))) {
		const session = await getAuth().api.getSession({ headers: event.request.headers });
		event.locals.user = session?.user ?? null;
	}
	// 表示の設定（Issue #129）。html に属性で入れるので、開いた直後から設定の大きさとふりがなで描く
	const display = parseDisplay((name) => event.cookies.get(name));
	event.locals.display = display;
	if (PUBLIC_AUTH_PATHS.has(event.url.pathname)) return svelteKitHandler({ event, resolve, auth: getAuth(), building });
	return resolve(event, { transformPageChunk: ({ html }) => html.replace(/<html\b([^>]*)>/, `<html$1 ${displayAttributes(display)}>`) });
};
