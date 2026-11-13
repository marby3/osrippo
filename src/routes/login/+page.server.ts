import { error, fail, redirect } from '@sveltejs/kit';
import { env } from 'cloudflare:workers';
import { ja } from '#lib/copy/ja.ts';
import { safeNext, type Provider } from '#lib/domain/auth.ts';
import { AGREEMENT_VERSION, isCurrentAgreement } from '#lib/domain/agreement.ts';
import { isInviteCode, normalizeInviteCode } from '#lib/domain/invites.ts';
import { AGREEMENT_COOKIE, INVITE_COOKIE } from '#lib/server/auth.ts';
import { allowedCountry, checkTurnstile, clientOf } from '#lib/server/client.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, url }) => {
	const next = safeNext(url.searchParams.get('next'), url.origin);
	// すでにログインしていれば、戻り先へ送る
	if (locals.user) redirect(303, next);
	// 提供元から戻ったときの理由（docs/spec/199.md 決めたこと3）。招待コードとお約束（Issue #200）で断ったときだけ別の文
	const reason = url.searchParams.get('error');
	return {
		next,
		failed: reason === null ? null : reason === 'invite_required' ? ('invite' as const) : reason === 'agreement_required' ? ('agreement' as const) : ('other' as const),
		agreementVersion: AGREEMENT_VERSION,
		siteKey: env.TURNSTILE_SITE_KEY
	};
};

const signIn =
	(provider: Provider) =>
	async (event: Parameters<Actions[string]>[0]) => {
		const { cookies, locals, request, url } = event;
		// 日本からのアクセスだけ、Turnstile が通ったときだけ（設計書 docs/spec/25.md 決めたこと7・8）
		const { country, ip } = clientOf(event);
		if (!allowedCountry(country) || !ip) return fail(403, { message: ja.guard.outsideJapan });
		const form = await request.formData();
		if (!(await checkTurnstile(event, String(form.get('cf-turnstile-response') ?? ''), ip))) {
			return fail(400, { message: ja.guard.turnstileFailed });
		}
		// 招待コード（docs/spec/199.md 決めたこと2）。ここでは形だけ確かめる（使えるかを外から試せないように）
		const rawInvite = String(form.get('invite') ?? '');
		const invite = rawInvite.trim() ? normalizeInviteCode(rawInvite) : null;
		if (invite !== null && !isInviteCode(invite)) {
			cookies.delete(INVITE_COOKIE, { path: '/' });
			return fail(400, { message: ja.login.inviteInvalid, invite: true as const });
		}
		// β版のお約束への同意（Issue #200）。チェックの値は、いまの版そのものだけを同意とする。
		// 招待コードを入れた人（新規登録）は、同意がなければ断る。すでにアカウントのある人は、チェックがなくても入れる
		const agreed = isCurrentAgreement(form.get('agree'));
		if (invite !== null && !agreed) {
			cookies.delete(INVITE_COOKIE, { path: '/' });
			cookies.delete(AGREEMENT_COOKIE, { path: '/' });
			return fail(400, { message: ja.login.agreeRequired, agree: true as const });
		}
		// 欄が空・チェックなしなら、前に入れた Cookie を残さない（共用のブラウザで、ほかの人が入れたもので登録しないように）
		if (invite !== null) cookies.set(INVITE_COOKIE, invite, { path: '/', httpOnly: true, secure: true, sameSite: 'lax', maxAge: 600 });
		else cookies.delete(INVITE_COOKIE, { path: '/' });
		// 同意は、登録の hook まで短い期限の Cookie で運び、登録したときに記録する
		if (agreed) cookies.set(AGREEMENT_COOKIE, AGREEMENT_VERSION, { path: '/', httpOnly: true, secure: true, sameSite: 'lax', maxAge: 600 });
		else cookies.delete(AGREEMENT_COOKIE, { path: '/' });
		const next = safeNext(String(form.get('next') ?? ''), url.origin);
		const { url: authorize } = await locals.auth().api.signInSocial({
			// 同意画面でキャンセルしたときなどは、Better Auth のエラーページではなくログインの画面へ戻す
			body: { provider, callbackURL: next, errorCallbackURL: '/login', disableRedirect: true },
			headers: request.headers
		});
		if (!authorize) error(500, ja.login.failed);
		// 外へのリダイレクトは、提供元の認可のサイトだけを許す
		redirect(303, authorize, { external: ['https://accounts.google.com', 'https://access.line.me'] });
	};

export const actions: Actions = { google: signIn('google'), line: signIn('line') };
