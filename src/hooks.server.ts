import { building } from '$app/env';
import { env } from 'cloudflare:workers';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import type { Handle } from '@sveltejs/kit/hooks';
import { createAuth, hasSessionCookie } from '#lib/server/auth.ts';

export const handle: Handle = async ({ event, resolve }) => {
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
