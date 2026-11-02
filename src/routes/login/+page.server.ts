import { redirect } from '@sveltejs/kit';
import { safeNext } from '#lib/domain/auth.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, url }) => {
	const next = safeNext(url.searchParams.get('next'), url.origin);
	// すでにログインしていれば、戻り先へ送る
	if (locals.user) redirect(303, next);
	return { next };
};

const signIn =
	(provider: 'google' | 'line') =>
	async ({ locals, request, url }: Parameters<Actions[string]>[0]) => {
		const form = await request.formData();
		const next = safeNext(String(form.get('next') ?? ''), url.origin);
		const { url: authorize } = await locals.auth.api.signInSocial({
			body: { provider, callbackURL: next, disableRedirect: true },
			headers: request.headers
		});
		// 外へのリダイレクトは、提供元の認可のサイトだけを許す
		redirect(303, authorize!, { external: ['https://accounts.google.com', 'https://access.line.me'] });
	};

export const actions: Actions = { google: signIn('google'), line: signIn('line') };
