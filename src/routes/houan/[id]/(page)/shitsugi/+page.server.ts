// 法案の質疑のタブ（SpBillQA・PcBillQA。Issue #66）。下書きには質疑がないので 404
import { billRoleOf } from '#lib/server/cosponsors.ts';
import { error } from '@sveltejs/kit';
import { env } from 'cloudflare:workers';
import { parsePage } from '#lib/domain/issues.ts';
import { billWaitUntil } from '#lib/domain/limits.ts';
import { evaluationOpen } from '#lib/domain/evaluations.ts';
import { postRoleOf, postWindowOpen, stanceOpen } from '#lib/domain/posts.ts';
import { nowOf } from '#lib/server/client.ts';
import { answerAction, evaluationAction, postableBill, progressOf, readAction, stanceAction, supplementAction } from '#lib/server/post-actions.ts';
import { listQuestions, questionTotal, stanceOf, waitingQuestions } from '#lib/server/posts.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const { db, bill } = await postableBill(event);
	const mati = event.url.searchParams.get('mati');
	const kanren = event.url.searchParams.get('kanren');
	const page = parsePage(event.url.searchParams.get('page'));
	// 同じ内容の URL を2つ作らない
	if (page === null || (mati !== null && mati !== '1') || (kanren !== null && kanren !== '1') || (mati !== null && kanren !== null)) error(404);
	const onlyWaiting = mati === '1';
	const withRelated = kanren === '1';
	// 関連法案を使うときだけレイアウトの値を読む（ほかの絞り込みやページ送りでレイアウトの問い合わせを走らせない）
	const relatedShown = withRelated ? (await event.parent()).related : [];
	if (withRelated && relatedShown.length === 0) error(404);
	const relatedIds = relatedShown.map((r) => r.id);
	const user = event.locals.user;
	const now = nowOf(event);
	const { progress, session } = progressOf(bill, now);
	const { rows, hasNext } = await listQuestions(db, bill.id, user?.id ?? null, onlyWaiting, page, relatedIds, session.key);
	if (page > 1 && rows.length === 0) error(404);

	const userId = user?.id ?? null;
	const writerRole = await billRoleOf(db, bill, userId);
	// 抜けた共同提出者は答弁できず、補足を書ける（docs/spec/76.md の決定G）
	const role = postRoleOf(writerRole);
	const waiting = await waitingQuestions(db, bill.id, session.key);
	const waitUntil = user ? billWaitUntil(user.createdAt.getTime(), now) : null;
	return {
		questions: rows,
		// 前の会期の質疑は読むだけ（要調整を直した法案。docs/spec/72.md の C）
		sessionKey: session.key,
		waitingCount: waiting,
		totalCount: onlyWaiting ? waiting : await questionTotal(db, bill.id, relatedIds),
		hasNext,
		page,
		onlyWaiting,
		withRelated,
		relatedShown,
		role,
		loggedIn: user !== undefined && user !== null,
		waitUntil,
		// 評価のボタン。登録から7日未満の人と時期の外には出さない（docs/spec/67.md 決めたこと1）
		evaluationShown: evaluationOpen(progress) && waitUntil === null,
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
	stance: stanceAction,
	evaluate: evaluationAction,
	read: readAction
};
