// β版のお約束と同意（Issue #200。受入基準と決めたことは Issue #198 の「β版のお約束と同意」の節）。
// 読むだけならだれでも開ける。同意のボタンは、ログインしていて、いまの版に同意していない人にだけ出す
import { fail, redirect } from '@sveltejs/kit';
import { env } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/d1';
import { ja } from '#lib/copy/ja.ts';
import { AGREEMENT_VERSION, isCurrentAgreement } from '#lib/domain/agreement.ts';
import { safeNext } from '#lib/domain/auth.ts';
import { agreedAt, recordAgreement } from '#lib/server/agreements.ts';
import { requireUser } from '#lib/server/require-user.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const user = locals.user;
	return {
		// 戻り先は、このサイトの中だけ（外への URL はホームにする）
		next: safeNext(url.searchParams.get('next'), url.origin),
		version: AGREEMENT_VERSION,
		loggedIn: user !== null,
		agreedAt: user ? await agreedAt(drizzle(env.DB), user.id) : null
	};
};

export const actions: Actions = {
	default: async (event) => {
		const user = requireUser(event);
		const form = await event.request.formData();
		// 読んだ版といまの版が違う（読んでいるあいだに版が上がった、または形の違う値）なら、記録しない
		if (!isCurrentAgreement(form.get('version'))) return fail(400, { message: ja.yakusoku.unknownVersion });
		await recordAgreement(drizzle(env.DB), user.id, AGREEMENT_VERSION, Date.now());
		redirect(303, safeNext(String(form.get('next') ?? ''), event.url.origin));
	}
};
