// 表示の設定を保存する（Issue #129）。フォームの POST を受けて Cookie に書き、元のページへ戻す（スクリプトなしでも動く）
import { redirect } from '@sveltejs/kit';
import { safeNext } from '#lib/domain/auth.ts';
import { DISPLAY_COOKIES, TEXT_SIZES } from '#lib/domain/display.ts';
import type { RequestHandler } from './$types';

const YEAR = 60 * 60 * 24 * 365;

export const POST: RequestHandler = async ({ request, cookies, url }) => {
	const form = await request.formData();
	const size = String(form.get('size') ?? '');
	const ruby = String(form.get('ruby') ?? '');
	const options = { path: '/', maxAge: YEAR, httpOnly: true, sameSite: 'lax' as const };
	if ((TEXT_SIZES as readonly string[]).includes(size)) cookies.set(DISPLAY_COOKIES.size, size, options);
	if (ruby === 'on' || ruby === 'off') cookies.set(DISPLAY_COOKIES.ruby, ruby, options);
	// 戻り先はログインのあとと同じ決まりで、サイトの中だけ（制御文字や // で外へ出さない）
	const back = form.get('back');
	redirect(303, safeNext(typeof back === 'string' ? back : null, url.origin));
};
