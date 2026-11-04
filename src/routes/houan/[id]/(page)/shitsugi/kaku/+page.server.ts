// 質疑を書く（Issue #66）。下書きとない法案は 404。3週目の外と登録から7日未満は、欄を出さず理由を出す
import { env } from 'cloudflare:workers';
import { billWaitUntil } from '#lib/domain/limits.ts';
import { postWindowOpen } from '#lib/domain/posts.ts';
import { nowOf } from '#lib/server/client.ts';
import { postableBill, progressOf, questionAction } from '#lib/server/post-actions.ts';
import { requireUser } from '#lib/server/require-user.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const { bill } = await postableBill(event);
	const user = requireUser(event);
	const now = nowOf(event);
	return {
		open: postWindowOpen('question', progressOf(bill, now).progress),
		waitUntil: billWaitUntil(user.createdAt.getTime(), now),
		siteKey: env.TURNSTILE_SITE_KEY
	};
};

export const actions: Actions = { default: questionAction };
