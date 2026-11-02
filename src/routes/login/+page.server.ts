import { error, redirect } from '@sveltejs/kit';
import { ja } from '#lib/copy/ja.ts';
import { safeNext, type Provider } from '#lib/domain/auth.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, url }) => {
	const next = safeNext(url.searchParams.get('next'), url.origin);
	// すでにログインしていれば、戻り先へ送る
	if (locals.user) redirect(303, next);
	return { next, failed: url.searchParams.has('error') };
};

const signIn =
	(provider: Provider) =>
	async ({ locals, request, url }: Parameters<Actions[string]>[0]) => {
		const form = await request.formData();
		const next = safeNext(String(form.get('next') ?? ''), url.origin);
		const { url: authorize } = await locals.auth().api.signInSocial({
			// 同意画面でキャンセルしたときなどは、Better Auth のエラーページではなくログインの画面へ戻す
			body: { provider, callbackURL: next, errorCallbackURL: '/login?error=1', disableRedirect: true },
			headers: request.headers
		});
		if (!authorize) error(500, ja.login.failed);
		// 外へのリダイレクトは、提供元の認可のサイトだけを許す
		redirect(303, authorize, { external: ['https://accounts.google.com', 'https://access.line.me'] });
	};

export const actions: Actions = { google: signIn('google'), line: signIn('line') };
