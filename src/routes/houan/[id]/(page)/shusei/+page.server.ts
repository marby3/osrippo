// 法案の修正案のタブ（Issue #68。設計書 docs/spec/68.md 決めたこと13）。画面の案はなく、質疑のタブにそろえる
import { error } from '@sveltejs/kit';
import { env } from 'cloudflare:workers';
import { acceptOpen, amendmentOpen, amendmentVoteOpen } from '#lib/domain/amendments.ts';
import { parsePage } from '#lib/domain/issues.ts';
import { billWaitUntil } from '#lib/domain/limits.ts';
import { acceptAction, amendableBill, amendmentSupportAction, amendmentVoteAction, priorRequirementAt, reportAmendmentAction } from '#lib/server/amendment-actions.ts';
import { hiddenAmendmentsFor, reportedAmendmentIds, staffOnAmendments } from '#lib/server/amendment-moderation.ts';
import { amendmentCount, listAmendments } from '#lib/server/amendments.ts';
import { nowOf, sessionsAt } from '#lib/server/client.ts';
import { progressOf } from '#lib/server/post-actions.ts';
import { isEligibleVoter } from '#lib/server/votes.ts';
import { isBillSide } from '#lib/server/cosponsors.ts';
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
	// 共同提出者と抜けた共同提出者も、修正案を出せず、先議の賛同もできない（docs/spec/76.md の決定F・G）
	const isSide = user ? await isBillSide(db, bill, user.id) : false;
	const userId = user?.id ?? null;
	// 運営として見られるか（権限があり、関わっていない。どれも法案の単位で決まる。docs/spec/103.md の決定O）
	const staffHere = userId !== null && (await staffOnAmendments(db, bill.id, userId, now, sessionsAt(now).minutes));
	return {
		amendments: rows,
		hasNext,
		page,
		total: await amendmentCount(db, bill.id),
		progress,
		isAuthor,
		isSide,
		loggedIn: Boolean(user),
		waitUntil: user ? billWaitUntil(user.createdAt.getTime(), now) : null,
		canPost: amendmentOpen(progress) && !isSide,
		canAccept: isAuthor && acceptOpen(progress, now, session.voteAt),
		required,
		eligible: voting && user ? await isEligibleVoter(db, user.id, session) : null,
		siteKey: env.TURNSTILE_SITE_KEY,
		staffHere,
		reportedIds: await reportedAmendmentIds(db, userId, bill.id),
		// 本人と運営に見せる非表示の修正案は、1ページ目の最後に出す
		hiddenAmendments: page === 1 ? await hiddenAmendmentsFor(db, bill.id, userId, staffHere) : []
	};
};

export const actions: Actions = {
	accept: acceptAction,
	support: amendmentSupportAction,
	vote: amendmentVoteAction,
	reportAmendment: reportAmendmentAction
};
