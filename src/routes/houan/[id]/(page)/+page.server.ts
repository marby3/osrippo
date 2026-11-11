// 賛同と発議（Issue #49）、出し直し（Issue #75）、共同提出者と撤回と統合案（Issue #76）、専門家の解説（Issue #152）の受け付け
import { env } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/d1';
import { cosponsorAction, mergeAction, proposeAction, resubmitAction, supportAction, withdrawAction } from '#lib/server/bill-actions.ts';
import { nowOf } from '#lib/server/client.ts';
import { commentariesOf, myCommentary, reportedCommentaryIds } from '#lib/server/commentaries.ts';
import { COMMENTARY_MAX, commentaryAction, commentaryOpen, reportCommentaryAction } from '#lib/server/commentary-actions.ts';
import { expertStateAt } from '#lib/server/verifications.ts';
import type { Actions, PageServerLoad } from './$types';

/** 概要のタブの「専門家の解説」（Issue #152）。法案は上の階層が読む */
export const load: PageServerLoad = async (event) => {
	const { bill, progress } = await event.parent();
	const db = drizzle(env.DB);
	const now = nowOf(event);
	const userId = event.locals.user?.id ?? null;
	const expert = userId === null ? null : await expertStateAt(db, userId, now);
	return {
		commentary: {
			list: await commentariesOf(db, bill.id, userId, now),
			open: commentaryOpen(progress),
			expert,
			mine: userId !== null && expert !== null ? await myCommentary(db, bill.id, userId) : null,
			reported: await reportedCommentaryIds(db, userId, bill.id),
			max: COMMENTARY_MAX,
			siteKey: env.TURNSTILE_SITE_KEY
		}
	};
};

export const actions: Actions = {
	support: supportAction,
	propose: proposeAction,
	resubmit: resubmitAction,
	cosponsor: cosponsorAction,
	withdraw: withdrawAction,
	merge: mergeAction,
	commentary: commentaryAction,
	reportCommentary: reportCommentaryAction
};
