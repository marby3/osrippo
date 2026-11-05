// 法案の修正案のタブ（Issue #68。設計書 docs/spec/68.md 決めたこと13）。画面の案はなく、質疑のタブにそろえる
import { error } from '@sveltejs/kit';
import { env } from 'cloudflare:workers';
import { acceptOpen, amendmentOpen, amendmentVoteOpen } from '#lib/domain/amendments.ts';
import { parsePage } from '#lib/domain/issues.ts';
import { billWaitUntil } from '#lib/domain/limits.ts';
import { acceptAction, amendableBill, amendmentSupportAction, amendmentVoteAction, priorRequirementAt } from '#lib/server/amendment-actions.ts';
import { amendmentCount, listAmendments } from '#lib/server/amendments.ts';
import { nowOf } from '#lib/server/client.ts';
import { progressOf } from '#lib/server/post-actions.ts';
import { isEligibleVoter } from '#lib/server/votes.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const { db, bill } = await amendableBill(event);
	const page = parsePage(event.url.searchParams.get('page'));
	if (page === null) error(404);
	const now = nowOf(event);
	const user = event.locals.user;
	const { progress, session } = progressOf(bill, now);
	const voting = amendmentVoteOpen(progress);
	// 賛同の要件はその会期に固定した今月の参加者から求める。3週目と4週目のときだけ読む
	const required = amendmentOpen(progress) || voting ? await priorRequirementAt(db, bill.committeeId, now) : null;
	const { rows, hasNext } = await listAmendments(db, bill, user?.id ?? null, session.key, required, page);
	if (page > 1 && rows.length === 0) error(404);
	const isAuthor = user?.id === bill.userId;
	return {
		amendments: rows,
		hasNext,
		page,
		total: await amendmentCount(db, bill.id),
		progress,
		isAuthor,
		loggedIn: Boolean(user),
		waitUntil: user ? billWaitUntil(user.createdAt.getTime(), now) : null,
		canPost: amendmentOpen(progress) && !isAuthor,
		canAccept: isAuthor && acceptOpen(progress, now, session.voteAt),
		required,
		eligible: voting && user ? await isEligibleVoter(db, user.id, session) : null,
		siteKey: env.TURNSTILE_SITE_KEY
	};
};

export const actions: Actions = {
	accept: acceptAction,
	support: amendmentSupportAction,
	vote: amendmentVoteAction
};
