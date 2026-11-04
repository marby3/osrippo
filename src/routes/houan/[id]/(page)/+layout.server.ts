// 法案のページ（概要と変更点のタブ）。下書きもだれでも見られる（Issue #46）
import { error } from '@sveltejs/kit';
import { env } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/d1';
import { proposalRequirement } from '#lib/domain/bills.ts';
import { parseIssueId } from '#lib/domain/issues.ts';
import { billWaitUntil } from '#lib/domain/limits.ts';
import { FIRST_COMMITTEE } from '#lib/server/bill-form.ts';
import { billById, billSupportState, billView, sessionParticipants } from '#lib/server/bills.ts';
import { nowOf, sessionsOf } from '#lib/server/client.ts';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async (event) => {
	const { params, locals } = event;
	const id = parseIssueId(params.id);
	const db = drizzle(env.DB);
	// 作りかけ（rev = 0）は billById が返さない
	const bill = id === null ? undefined : await billById(db, id);
	if (!bill) error(404);
	const now = nowOf(event);
	const user = locals.user;
	const isAuthor = user?.id === bill.userId;
	const draft = bill.status === 'draft';
	const { supports, mine } = await billSupportState(db, bill.id, bill.rev, user?.id ?? null);
	// 発議要件を読むのは提出者が下書きを見るときだけ（その会期で最初に読まれたときに固定する。docs/spec/49.md 決めたこと3）
	let required: number | null = null;
	if (draft && isAuthor) {
		const { session, previous } = sessionsOf(event);
		required = proposalRequirement(await sessionParticipants(db, FIRST_COMMITTEE, session, previous, now));
	}
	return {
		bill: await billView(db, bill),
		canEdit: isAuthor && draft,
		support: {
			rev: bill.rev,
			count: supports,
			mine,
			open: draft && !isAuthor,
			loggedIn: Boolean(user),
			waitUntil: user && draft && !isAuthor ? billWaitUntil(user.createdAt.getTime(), now) : null,
			required
		}
	};
};
