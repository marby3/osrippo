// 法案の質疑のタブ（SpBillQA・PcBillQA。Issue #66）。下書きには質疑がないので 404
import { error } from '@sveltejs/kit';
import { env } from 'cloudflare:workers';
import { parsePage } from '#lib/domain/issues.ts';
import { billWaitUntil } from '#lib/domain/limits.ts';
import { answererRole, postWindowOpen, stanceOpen } from '#lib/domain/posts.ts';
import { nowOf } from '#lib/server/client.ts';
import { answerAction, postableBill, progressOf, stanceAction, supplementAction } from '#lib/server/post-actions.ts';
import { isSupporter, listQuestions, questionCounts, stanceOf } from '#lib/server/posts.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const { db, bill } = await postableBill(event);
	const mati = event.url.searchParams.get('mati');
	const page = parsePage(event.url.searchParams.get('page'));
	// 同じ内容の URL を2つ作らない
	if (page === null || (mati !== null && mati !== '1')) error(404);
	const onlyWaiting = mati === '1';
	const user = event.locals.user;
	const { rows, hasNext } = await listQuestions(db, bill.id, user?.id ?? null, onlyWaiting, page);
	if (page > 1 && rows.length === 0) error(404);

	const now = nowOf(event);
	const { progress, session } = progressOf(bill, now);
	const userId = user?.id ?? null;
	const role = answererRole(bill, userId, userId !== null && (await isSupporter(db, bill.id, userId)));
	return {
		questions: rows,
		counts: await questionCounts(db, bill.id),
		hasNext,
		page,
		onlyWaiting,
		role,
		loggedIn: user !== undefined && user !== null,
		waitUntil: user ? billWaitUntil(user.createdAt.getTime(), now) : null,
		canQuestion: postWindowOpen('question', progress),
		canAnswer: postWindowOpen('answer', progress),
		canSupplement: postWindowOpen('supplement', progress),
		stanceShown: stanceOpen(progress),
		// 立場は本人の行だけを読む（docs/spec/66.md 決めたこと7）
		stance: user && stanceOpen(progress) ? await stanceOf(db, session.key, bill.id, user.id) : null,
		siteKey: env.TURNSTILE_SITE_KEY
	};
};

export const actions: Actions = {
	answer: answerAction,
	supplement: supplementAction,
	stance: stanceAction
};
